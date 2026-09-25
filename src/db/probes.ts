import {db} from "./index.ts";
import {ensureEnrichment} from './enrichment.ts';
import {relevance} from '../signals/relevance.ts';
import {detectCategory} from '../signals/index.ts';
export function recordProbe(id:number,outcome:'alive'|'gone'|'unknown',at=Date.now()) {
  const d=db();
  ensureEnrichment(d);
  d.transaction(()=>{
    const row=d.query(`SELECT l.probe_failures,COALESCE(p.call,v.call) call FROM listings l
      LEFT JOIN verdicts v ON v.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id)
      LEFT JOIN collector_priorities p ON p.listing_id=l.id AND p.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE l.id=?`).get(id) as {probe_failures:number;call:string}|null;
    if(!row)return;
    const failures=outcome==='unknown'?row.probe_failures+1:0;
    const delay=outcome==='unknown'?Math.min(86_400_000,15*60_000*2**Math.min(failures-1,8))
      :['BUY','VERIFY'].includes(row.call)?30*60_000:6*60*60_000;
    d.run('UPDATE listings SET last_probed_at=?,next_probe_at=?,probe_failures=? WHERE id=?',
      [new Date(at).toISOString(),new Date(at+delay).toISOString(),failures,id]);
    d.run(`INSERT INTO listing_availability VALUES(?,?,?) ON CONFLICT(listing_id) DO UPDATE SET observed_at=excluded.observed_at,outcome=excluded.outcome`,[id,new Date(at).toISOString(),outcome]);
  // A deferred read snapshot cannot upgrade after another writer commits,
  // even with busy_timeout. Job 52 hit that race against agent bookkeeping.
  // Take the write reservation first, then read and persist one observation.
  }).immediate();
}

export function dueProbes(source:string,limit:number,at=Date.now()) {
  ensureEnrichment();
  const rows=db().query(`SELECT l.id,l.url,l.title,l.description FROM listings l
    LEFT JOIN verdicts v ON v.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id)
    LEFT JOIN collector_priorities p ON p.listing_id=l.id AND p.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE l.source=? AND l.delisted_at IS NULL AND l.url IS NOT NULL AND (l.next_probe_at IS NULL OR l.next_probe_at<=?)
      AND COALESCE(v.call,'')!='OUT_OF_SCOPE'
    ORDER BY CASE COALESCE(p.call,v.call) WHEN 'BUY' THEN 0 WHEN 'VERIFY' THEN 1 WHEN 'FAIR' THEN 2 ELSE 3 END,
      COALESCE(l.last_probed_at,'') ASC,COALESCE(l.last_seen,l.captured_at),l.id LIMIT ?`)
    .all(source,new Date(at).toISOString(),Math.max(1,limit)*4) as {id:number;url:string;title:string;description:string|null}[];
  // A stored verdict can predate Yish's 2026-09-24 scope; availability checks
  // are for listings he might buy.
  return rows.filter(r=>relevance({title:r.title,description:r.description,category:detectCategory(r.title,r.description??'')}).keep)
    .slice(0,Math.max(1,limit)).map(({id,url})=>({id,url}));
}
