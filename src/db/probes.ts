import {db} from "./index.ts";
export function recordProbe(id:number,outcome:'alive'|'gone'|'unknown',at=Date.now()) {
  const d=db();
  d.transaction(()=>{
    const row=d.query('SELECT probe_failures FROM listings WHERE id=?').get(id) as {probe_failures:number}|null;
    if(!row)return;
    const failures=outcome==='unknown'?row.probe_failures+1:0;
    const delay=outcome==='unknown'?Math.min(86_400_000,15*60_000*2**Math.min(failures-1,8)):6*60*60_000;
    d.run('UPDATE listings SET last_probed_at=?,next_probe_at=?,probe_failures=? WHERE id=?',
      [new Date(at).toISOString(),new Date(at+delay).toISOString(),failures,id]);
  })();
}

export function dueProbes(source:string,limit:number,at=Date.now()) {
  return db().query(`SELECT l.id,l.url FROM listings l
    LEFT JOIN verdicts v ON v.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id)
    WHERE l.source=? AND l.delisted_at IS NULL AND l.url IS NOT NULL AND (l.next_probe_at IS NULL OR l.next_probe_at<=?)
    ORDER BY CASE v.call WHEN 'BUY' THEN 0 WHEN 'VERIFY' THEN 1 WHEN 'FAIR' THEN 2 ELSE 3 END,
      COALESCE(l.last_probed_at,'') ASC,COALESCE(l.last_seen,l.captured_at),l.id LIMIT ?`)
    .all(source,new Date(at).toISOString(),Math.max(1,limit)) as {id:number;url:string}[];
}
