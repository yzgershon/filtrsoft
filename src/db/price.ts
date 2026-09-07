import type {Database} from "bun:sqlite";

/** One observation updates history, the displayed ask, and the scoring input.
 * A durable recheck survives failure or shutdown between observation and score.
 */
export function observePrice(d: Database, id: number, price: number | null, observedAt: string): boolean {
  return d.transaction(()=>{
    const row=d.query("SELECT asking_price_cents,last_price_cents,last_seen FROM listings WHERE id=?").get(id) as {asking_price_cents:number|null;last_price_cents:number|null;last_seen:string|null}|null;
    if (!row || !Number.isFinite(Date.parse(observedAt)) || (row.last_seen && Date.parse(row.last_seen)>Date.parse(observedAt))) return false;
    const valid=typeof price==='number' && Number.isFinite(price) && price>0 ? Math.round(price) : null;
    const prior=row.last_price_cents??row.asking_price_cents;
    const changed=valid!==null && row.asking_price_cents!==valid;
    if(valid!==null && prior!==valid)d.run("INSERT INTO listing_prices(listing_id,price_cents,observed_at) VALUES(?,?,?)",[id,valid,observedAt]);
    d.run("UPDATE listings SET asking_price_cents=COALESCE(?,asking_price_cents),last_price_cents=COALESCE(?,last_price_cents),last_seen=? WHERE id=?",[valid,valid,observedAt,id]);
    if(changed)d.run("INSERT INTO listing_rechecks(listing_id,reason,requested_at) VALUES(?,'price',?) ON CONFLICT(listing_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at",[id,observedAt]);
    return changed;
  })();
}
