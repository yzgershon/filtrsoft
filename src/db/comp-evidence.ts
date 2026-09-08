import type { Database } from "bun:sqlite";

/** Legacy eBay captures kept the parser's explicit soldAt. A recent capture time
 * alone is never sale evidence. Preserve rejected history, but isolate it from prices.
 */
export function soldEvidenceSql(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `${p}source='ebay' AND ${p}currency='USD' AND ${p}sold_price_cents>0
    AND (${p}shipping_cents IS NULL OR ${p}shipping_cents>=0)
    AND julianday(${p}sold_at)<=julianday('now')
    AND julianday(${p}sold_at)<=julianday(${p}captured_at)
    AND date(${p}sold_at,'+0 days')=substr(${p}sold_at,1,10)
    AND CASE WHEN json_valid(${p}raw_json) THEN
      COALESCE(json_extract(${p}raw_json,'$.provisional'),0)=0
      AND julianday(json_extract(${p}raw_json,'$.soldAt'))=julianday(${p}sold_at)
      ELSE 0 END`;
}
export function usableCompSql(alias = "", window = "'-90 days'"): string {
  const p = alias ? `${alias}.` : "";
  return `(${soldEvidenceSql(alias)}) AND julianday(${p}sold_at)>=julianday('now',${window})`;
}
export function soldEvidence(c: {source:string;currency?:string;sold_at?:string|null;sold_price_cents:number;shipping_cents?:number|null;raw_json?:string;raw?:unknown;captured_at?:string}, at=Date.now()): boolean {
  try {
    const raw:any = c.raw ?? JSON.parse(c.raw_json ?? '{}');
    const t=Date.parse(c.sold_at ?? '');
    return c.source==='ebay' && (c.currency ?? 'USD')==='USD' && Number.isFinite(t) && t<=at && t<=Date.parse(c.captured_at??new Date(at).toISOString())
      && new Date(t).toISOString().slice(0,10)===c.sold_at?.slice(0,10)
      && Date.parse(raw?.soldAt)===t && !raw?.provisional
      && Number.isSafeInteger(c.sold_price_cents) && c.sold_price_cents>0
      && (c.shipping_cents==null || Number.isSafeInteger(c.shipping_cents) && c.shipping_cents>=0);
  } catch { return false; }
}
export function installCompEvidence(d:Database) {
  d.exec(`CREATE TABLE IF NOT EXISTS comp_quarantine(id INTEGER PRIMARY KEY, source TEXT NOT NULL,
    query TEXT, captured_at TEXT NOT NULL, reason TEXT NOT NULL, raw_json TEXT NOT NULL,
    UNIQUE(source,query,raw_json));
    CREATE VIEW IF NOT EXISTS quarantined_comp_history AS SELECT * FROM comps WHERE NOT COALESCE((${soldEvidenceSql()}),0);
    CREATE TABLE IF NOT EXISTS comp_collection_attempts(id INTEGER PRIMARY KEY,sku_id INTEGER,query TEXT NOT NULL,
    started_at TEXT NOT NULL, finished_at TEXT, fetched INTEGER NOT NULL DEFAULT 0, parsed INTEGER NOT NULL DEFAULT 0,
    accepted INTEGER NOT NULL DEFAULT 0,saved INTEGER NOT NULL DEFAULT 0,error TEXT);
    CREATE INDEX IF NOT EXISTS comp_attempt_sku ON comp_collection_attempts(sku_id,id);`);
}
