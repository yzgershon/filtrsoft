import {db} from './index.ts';
import {resolveProductType} from '../signals/product-type.ts';
import {photoArea,OU_MIN_EDGE} from '../sources/marketplace.ts';

export function ensureEnrichment(d=db()) {
  d.exec(`CREATE TABLE IF NOT EXISTS listing_enrichment(
    listing_id INTEGER PRIMARY KEY REFERENCES listings(id), attempted_at TEXT NOT NULL,
    next_attempt_at TEXT NOT NULL, failures INTEGER NOT NULL DEFAULT 0, outcome TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS collector_priorities(listing_id INTEGER PRIMARY KEY,call TEXT NOT NULL,expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS listing_availability(listing_id INTEGER PRIMARY KEY,observed_at TEXT NOT NULL,outcome TEXT NOT NULL)`);
}

export function recordDetailAttempt(id:number,outcome:'read'|'empty'|'failed'|'gone',at=Date.now()) {
  ensureEnrichment();
  const prev=db().query('SELECT failures FROM listing_enrichment WHERE listing_id=?').get(id) as {failures:number}|null;
  const failures=outcome==='failed'?(prev?.failures??0)+1:0;
  const delay=outcome==='failed'?Math.min(86400000,30*60000*2**Math.min(failures-1,6))
    :outcome==='empty'?24*3600000:6*3600000;
  db().run(`INSERT INTO listing_enrichment VALUES(?,?,?,?,?) ON CONFLICT(listing_id) DO UPDATE SET
    attempted_at=excluded.attempted_at,next_attempt_at=excluded.next_attempt_at,failures=excluded.failures,outcome=excluded.outcome`,
    [id,new Date(at).toISOString(),new Date(at+delay).toISOString(),failures,outcome]);
}

/** Missing descriptions and stale actionable details both need visits. A good
 * thumbnail used to make OfferUp skip seller text forever. Old failed rows now
 * back off, and oldest attempts win within a priority band, preventing starvation. */
export function dueDetails(source:string,limit=20,at=Date.now(),all=false):any[] {
  ensureEnrichment();
  const rows=db().query(`SELECT l.*,COALESCE(p.call,v.call) call,e.attempted_at,e.next_attempt_at,
    (SELECT url FROM listing_photos WHERE listing_id=l.id ORDER BY position LIMIT 1) thumb,
    COALESCE((SELECT json_group_array(url) FROM listing_photos WHERE listing_id=l.id),'[]') photos
    FROM listings l LEFT JOIN verdicts v ON v.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id)
    LEFT JOIN listing_enrichment e ON e.listing_id=l.id
    LEFT JOIN collector_priorities p ON p.listing_id=l.id AND p.expires_at>?
    WHERE l.source=? AND l.delisted_at IS NULL AND l.url IS NOT NULL
      AND COALESCE(l.posted_at,l.last_seen,l.captured_at)>=?
      AND (e.next_attempt_at IS NULL OR e.next_attempt_at<=?)
    ORDER BY CASE COALESCE(p.call,v.call) WHEN 'BUY' THEN 0 WHEN 'VERIFY' THEN 1 WHEN 'INSUFFICIENT_DATA' THEN 2 ELSE 3 END,
      COALESCE(e.attempted_at,''),l.captured_at DESC,l.id DESC`).all(new Date(at).toISOString(),source,new Date(at-28*86400000).toISOString(),new Date(at).toISOString()) as any[];
  return rows.filter(r=>{
    if(['furniture','accessory'].includes(resolveProductType(r.title).kind) || r.call==='OUT_OF_SCOPE')return false;
    if(all || ['BUY','VERIFY'].includes(r.call))return true;
    if(!r.description?.trim() || r.description.trim().length<40)return true;
    return source==='offerup' && !(JSON.parse(r.photos) as string[]).some(u=>photoArea(u)>=OU_MIN_EDGE*OU_MIN_EDGE*.4);
  }).slice(0,Math.max(1,Math.min(40,limit)));
}
