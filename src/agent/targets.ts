import {z} from 'zod';
import {db} from '../db/index.ts';
import {ensureEnrichment,dueDetails} from '../db/enrichment.ts';
import {upsertListingFacts} from '../db/listings.ts';
import {marketplaceItemKey} from '../sources/item-url.ts';

const source=z.enum(['facebook','offerup','mercari']);
export const repairTargetSchema=z.object({source,sourceId:z.string().min(1).max(200),url:z.url(),title:z.string().min(1).max(2000),
  description:z.string().max(100000),askingPriceCents:z.number().int().positive().nullable(),location:z.string().max(2000).nullable(),
  postedAt:z.iso.datetime({offset:true}).nullable(),observedAt:z.iso.datetime({offset:true}),capturedAt:z.iso.datetime({offset:true}),
  updatedAt:z.iso.datetime({offset:true}).nullable(),call:z.enum(['BUY','VERIFY','FAIR','PASS','RISK','INSUFFICIENT_DATA']),
  photos:z.array(z.url()).max(20)}).refine(t=>marketplaceItemKey(t.url)===t.sourceId && new URL(t.url).hostname.replace(/^www\./,'')===`${t.source==='facebook'?'facebook':t.source}.com`);
export type RepairTarget=z.infer<typeof repairTargetSchema>;

/** Production knows which recommendations need attention. A replacement PC's
 * empty ingestion database cannot rediscover sold listings from search cards. */
export function repairTargets(sources:string[],limit=40):RepairTarget[] {
  ensureEnrichment();const d=db(),at=new Date().toISOString(),since=new Date(Date.now()-28*86400000).toISOString();
  return sources.filter(s=>source.safeParse(s).success).flatMap(s=>{
    const probes=d.query(`SELECT l.*,v.call FROM listings l
      JOIN verdicts v ON v.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id)
      LEFT JOIN listing_enrichment e ON e.listing_id=l.id
      WHERE l.source=? AND l.delisted_at IS NULL AND v.call!='OUT_OF_SCOPE'
        AND COALESCE(l.posted_at,l.last_seen,l.captured_at)>=?
        AND v.call IN ('BUY','VERIFY') AND (l.next_probe_at IS NULL OR l.next_probe_at<=?)
      ORDER BY CASE v.call WHEN 'BUY' THEN 0 WHEN 'VERIFY' THEN 1 ELSE 2 END,
        COALESCE(e.attempted_at,''),l.captured_at DESC LIMIT ?`).all(s,since,at,Math.min(6,limit)) as any[];
    const rows=[...new Map([...probes,...dueDetails(s,limit)].map(r=>[r.id,r])).values()].slice(0,Math.min(60,limit));
    return rows.flatMap(l=>{
      const parsed=repairTargetSchema.safeParse({source:l.source,sourceId:l.source_id,url:l.url,title:l.title,description:l.description??'',
        askingPriceCents:l.asking_price_cents,location:l.location,postedAt:l.posted_at,observedAt:l.last_seen??l.captured_at,
        capturedAt:l.captured_at,updatedAt:l.updated_at,call:l.call,
        photos:(d.query('SELECT url FROM listing_photos WHERE listing_id=? ORDER BY position LIMIT 20').all(l.id) as {url:string}[]).map(p=>p.url)});
      return parsed.success?[parsed.data]:[];
    });
  });
}

export function acceptRepairTargets(input:unknown) {
  const targets=z.array(repairTargetSchema).max(180).parse(input);ensureEnrichment();const d=db();
  return d.transaction(()=>{
    for(const t of targets) {
      // Do not replace fresher unsent local evidence with a server snapshot.
      const existing=d.query('SELECT id FROM listings WHERE source=? AND source_id=?').get(t.source,t.sourceId) as {id:number}|null;
      const id=existing?.id??upsertListingFacts(d,{...t,photoCount:t.photos.length,partial:true},t.observedAt).id;
      if(!existing){
        d.run('UPDATE listings SET captured_at=? WHERE id=?',[t.capturedAt,id]);
        t.photos.forEach((url,i)=>d.run('INSERT INTO listing_photos(listing_id,url,position,captured_at) VALUES(?,?,?,?)',[id,url,i,t.observedAt]));
      }
      d.run(`INSERT INTO collector_priorities VALUES(?,?,?) ON CONFLICT(listing_id) DO UPDATE SET call=excluded.call,expires_at=excluded.expires_at`,[id,t.call,new Date(Date.now()+6*3600000).toISOString()]);
    }
    return targets.length;
  })();
}
