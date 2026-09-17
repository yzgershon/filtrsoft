import {db,now} from "./index.ts";
import {pricingSignature} from "./revisions.ts";
import {checkStored,ENGINE_VERSION} from "../engine/index.ts";
import {storeVerdict,type VerdictPayload} from "./verdicts.ts";
import {clearMeasuredMultiplierCache} from "../valuation/condition.ts";

/** Per-listing checkpoints are the resumable cursor: success advances only that
 * row; failures back off without blocking later IDs or declaring the run done.
 * September 17 production verification found 9,000+ historical rows ahead of
 * corrected recommendations after deployment. Read new evidence and live
 * BUY/VERIFY first, then other feed rows, without dropping the historical work.
 */
export function scorePending(limit=400,score:(id:number)=>VerdictPayload=id=>checkStored(id).verdict,maxMs=250) {
  const started=performance.now();
  const d=db(),signature=pricingSignature(d),at=now(),target=`${ENGINE_VERSION}|${signature}`;
  const rows=d.query(`SELECT l.id,q.requested_at FROM listings l
    LEFT JOIN scoring_state s ON s.listing_id=l.id
    LEFT JOIN listing_rechecks q ON q.listing_id=l.id
    LEFT JOIN verdicts v ON v.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id)
    WHERE (s.signature IS NOT ? OR s.engine IS NOT ? OR v.engine_version IS NOT ? OR q.listing_id IS NOT NULL)
      AND (s.attempt_signature IS NOT ? OR s.retry_at IS NULL OR s.retry_at<=?)
    ORDER BY CASE
      WHEN l.delisted_at IS NOT NULL THEN 4
      WHEN q.listing_id IS NOT NULL OR v.id IS NULL THEN 0
      WHEN v.call IN ('BUY','VERIFY') THEN 1
      WHEN v.call!='OUT_OF_SCOPE' THEN 2
      ELSE 3 END,
      s.last_attempt ASC,l.id LIMIT ?`).all(signature,ENGINE_VERSION,ENGINE_VERSION,target,at,Math.max(1,limit)) as {id:number;requested_at:string|null}[];
  let checked=0,changed=0,failed=0;
  clearMeasuredMultiplierCache();
  for(const row of rows) {
    // Bun serves HTTP on this same thread. A count-only limit allowed expensive
    // comp matching to block requests for an entire 50-row pass. Finish the
    // current transaction, then yield; even a zero budget makes one-row progress.
    if(checked+failed>0 && performance.now()-started>=maxMs)break;
    try {
      // Each listing is a short transaction: facts cannot change between the
      // computation and its acknowledgement in another local process.
      d.transaction(()=>{
        const result=storeVerdict(row.id,ENGINE_VERSION,score(row.id));
        if(result.inserted) changed++;
        d.run(`INSERT INTO scoring_state(listing_id,signature,engine,attempt_signature,attempts,last_attempt)
          VALUES(?,?,?,?,0,?) ON CONFLICT(listing_id) DO UPDATE SET signature=excluded.signature,engine=excluded.engine,
          attempt_signature=excluded.attempt_signature,attempts=0,retry_at=NULL,last_error=NULL,last_attempt=excluded.last_attempt`,[row.id,signature,ENGINE_VERSION,target,at]);
        d.run("DELETE FROM listing_rechecks WHERE listing_id=? AND requested_at IS ?",[row.id,row.requested_at]);
      })();
      checked++;
    } catch(e) {
      failed++;
      const prior=d.query("SELECT attempts,attempt_signature FROM scoring_state WHERE listing_id=?").get(row.id) as {attempts:number;attempt_signature:string}|null;
      const attempts=prior?.attempt_signature===target?prior.attempts+1:1;
      d.run(`INSERT INTO scoring_state(listing_id,attempt_signature,attempts,retry_at,last_error,last_attempt) VALUES(?,?,?,?,?,?)
        ON CONFLICT(listing_id) DO UPDATE SET attempt_signature=excluded.attempt_signature,attempts=excluded.attempts,
        retry_at=excluded.retry_at,last_error=excluded.last_error,last_attempt=excluded.last_attempt`,
        [row.id,target,attempts,new Date(Date.now()+Math.min(3_600_000,30_000*2**Math.min(attempts-1,8))).toISOString(),String(e).slice(0,500),at]);
    }
  }
  return {checked,changed,failed,...scoringStatus()};
}

export function scoringStatus() {
  const d=db(),signature=pricingSignature(d);
  const row=d.query(`SELECT COUNT(*) pending,SUM(CASE WHEN s.last_error IS NOT NULL THEN 1 ELSE 0 END) failures
    FROM listings l LEFT JOIN scoring_state s ON s.listing_id=l.id
    LEFT JOIN verdicts v ON v.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id)
    WHERE s.signature IS NOT ? OR s.engine IS NOT ? OR v.engine_version IS NOT ?
      OR EXISTS(SELECT 1 FROM listing_rechecks q WHERE q.listing_id=l.id)`).get(signature,ENGINE_VERSION,ENGINE_VERSION) as {pending:number;failures:number|null};
  return {signature,pending:row.pending,failures:row.failures??0,complete:row.pending===0};
}
