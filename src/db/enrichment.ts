import {db} from './index.ts';
import {resolveProductType} from '../signals/product-type.ts';
import {recoveryFingerprint,recoveryPlan,type ReadReceipt} from '../agent/recovery.ts';

export function ensureEnrichment(d=db()) {
  d.exec(`CREATE TABLE IF NOT EXISTS listing_enrichment(
    listing_id INTEGER PRIMARY KEY REFERENCES listings(id), attempted_at TEXT NOT NULL,
    next_attempt_at TEXT NOT NULL, failures INTEGER NOT NULL DEFAULT 0, outcome TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS collector_priorities(listing_id INTEGER PRIMARY KEY,call TEXT NOT NULL,expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS listing_availability(listing_id INTEGER PRIMARY KEY,observed_at TEXT NOT NULL,outcome TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS listing_recovery(listing_id INTEGER PRIMARY KEY REFERENCES listings(id),observed_at TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS listing_recovery_attempts(listing_id INTEGER PRIMARY KEY REFERENCES listings(id),fingerprint TEXT NOT NULL,attempted_at TEXT NOT NULL)`);
}

export function recordDetailAttempt(id:number,outcome:'read'|'empty'|'failed'|'gone',at=Date.now(),evidence?:{complete:boolean;durationMs?:number;reason?:string}) {
  ensureEnrichment();
  const prev=db().query('SELECT failures FROM listing_enrichment WHERE listing_id=?').get(id) as {failures:number}|null;
  const failures=outcome==='failed'?(prev?.failures??0)+1:0;
  const current=db().query("SELECT l.*,(SELECT json_group_array(url) FROM listing_photos WHERE listing_id=l.id) photos FROM listings l WHERE id=?").get(id) as any;
  db().run('INSERT INTO listing_recovery_attempts VALUES(?,?,?) ON CONFLICT(listing_id) DO UPDATE SET fingerprint=excluded.fingerprint,attempted_at=excluded.attempted_at',[id,recoveryFingerprint(current),new Date(at).toISOString()]);
  let delay=outcome==='failed'?Math.min(86400000,30*60000*2**Math.min(failures-1,6))
    :outcome==='empty'?24*3600000:6*3600000;
  if(outcome==='read'||outcome==='empty'){
    const row=db().query("SELECT l.*,(SELECT json_group_array(url) FROM listing_photos WHERE listing_id=l.id ORDER BY position) photos FROM listings l WHERE id=?").get(id) as any;
    const previous=db().query('SELECT payload FROM listing_recovery WHERE listing_id=?').get(id) as {payload:string}|null;
    const old:ReadReceipt|null=previous?JSON.parse(previous.payload):null;
    const fingerprint=recoveryFingerprint(row),unchanged=old?.fingerprint===fingerprint?old.unchanged+1:0;
    const complete=evidence?.complete??outcome==='read';
    if(complete)delay=7*86400000;
    const receipt:ReadReceipt={fingerprint,complete,unchanged,observedAt:new Date(at).toISOString(),durationMs:evidence?.durationMs??0,reason:evidence?.reason??(complete?'complete':'incomplete')};
    db().run('INSERT INTO listing_recovery VALUES(?,?,?) ON CONFLICT(listing_id) DO UPDATE SET observed_at=excluded.observed_at,payload=excluded.payload',[id,receipt.observedAt,JSON.stringify(receipt)]);
  }
  db().run(`INSERT INTO listing_enrichment VALUES(?,?,?,?,?) ON CONFLICT(listing_id) DO UPDATE SET
    attempted_at=excluded.attempted_at,next_attempt_at=excluded.next_attempt_at,failures=excluded.failures,outcome=excluded.outcome`,
    [id,new Date(at).toISOString(),new Date(at+delay).toISOString(),failures,outcome]);
}

export function readReceipt(id:number):ReadReceipt|null {
  const d=db();
  if(!d.query("SELECT 1 FROM sqlite_master WHERE name='listing_recovery'").get())return null;
  const row=d.query('SELECT payload FROM listing_recovery WHERE listing_id=?').get(id) as {payload:string}|null;
  return row?JSON.parse(row.payload):null;
}

/** Missing descriptions and stale actionable details both need visits. A good
 * thumbnail used to make OfferUp skip seller text forever. Old failed rows now
 * back off, and oldest attempts win within a priority band, preventing starvation. */
export function dueDetails(source:string,limit=20,at=Date.now(),all=false):any[] {
  ensureEnrichment();
  const rows=db().query(`SELECT l.*,COALESCE(p.call,v.call) call,v.payload,e.attempted_at,e.next_attempt_at,r.payload recovery,a.fingerprint attempt_fingerprint,
    (SELECT url FROM listing_photos WHERE listing_id=l.id ORDER BY position LIMIT 1) thumb,
    COALESCE((SELECT json_group_array(url) FROM listing_photos WHERE listing_id=l.id),'[]') photos
    FROM listings l LEFT JOIN verdicts v ON v.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id)
    LEFT JOIN listing_enrichment e ON e.listing_id=l.id
    LEFT JOIN listing_recovery r ON r.listing_id=l.id
    LEFT JOIN listing_recovery_attempts a ON a.listing_id=l.id
    LEFT JOIN collector_priorities p ON p.listing_id=l.id AND p.expires_at>?
    WHERE l.source=? AND l.delisted_at IS NULL AND l.url IS NOT NULL
      AND COALESCE(l.posted_at,l.last_seen,l.captured_at)>=?
    ORDER BY CASE COALESCE(p.call,v.call) WHEN 'BUY' THEN 0 WHEN 'VERIFY' THEN 1 WHEN 'INSUFFICIENT_DATA' THEN 2 ELSE 3 END,
      COALESCE(e.attempted_at,''),l.captured_at DESC,l.id DESC`).all(new Date(at).toISOString(),source,new Date(at-28*86400000).toISOString()) as any[];
  return rows.filter(r=>{
    if(['furniture','accessory'].includes(resolveProductType(r.title).kind) || r.call==='OUT_OF_SCOPE')return false;
    return (all&&(!r.next_attempt_at||Date.parse(r.next_attempt_at)<=at))||recoveryPlan(r,at).textDue;
  }).slice(0,Math.max(1,Math.min(40,limit)));
}
