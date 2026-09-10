import type {Context} from 'hono';
import {db} from '../db/index.ts';
import {currentUser} from './auth.ts';
import {loadAccountOverrides} from './overrides.ts';
import {comparisonSide,compareSides,comparisonCategories,type StoredCompareRow} from '../comparison/core.ts';
import {PART_KINDS,type BenchmarkSnapshot,type PartKind,type CompareCandidate,type Workload} from '../comparison/types.ts';
import snapshot from '../../data/hardware-benchmarks.json';
const benchmarks=snapshot as BenchmarkSnapshot;
const base=`SELECT l.id,l.title,l.description,l.url,l.source,l.asking_price_cents,l.location,l.posted_at,l.last_seen,l.captured_at,l.delisted_at,v.payload,v.created_at AS assessed_at,
 EXISTS(SELECT 1 FROM listing_rechecks q WHERE q.listing_id=l.id) AS pending_recheck,
 EXISTS(SELECT 1 FROM listing_dismissals d WHERE d.listing_id=l.id AND d.user_id=$user) AS dismissed
 FROM listings l LEFT JOIN verdicts v ON v.id=(SELECT MAX(v2.id) FROM verdicts v2 WHERE v2.listing_id=l.id)`;
const parseKind=(c:Context):PartKind|null=>PART_KINDS.includes(c.req.query('kind') as PartKind)?c.req.query('kind') as PartKind:c.req.query('kind')?null:'gpu';
function withPhotos(row:StoredCompareRow):StoredCompareRow{
  return {...row,photoUrls:(db().query('SELECT url FROM listing_photos WHERE listing_id=? ORDER BY position LIMIT 4').all(row.id) as Array<{url:string}>).map(p=>p.url)};
}
export function handleComparison(c:Context){
  const kind=parseKind(c),raw=c.req.query('ids')??'',workload=c.req.query('workload')??'gaming';
  if(!kind||!['gaming','rendering'].includes(workload)||!/^\d+(?:,\d+)?$/.test(raw))return c.json({error:'Choose one or two listing IDs, a supported part type and workload.'},400);
  const ids=raw.split(',').map(Number);if(ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length)return c.json({error:'Choose distinct positive listing IDs.'},400);
  const user=currentUser(c)!.id,overrides=loadAccountOverrides(user);
  const rows=ids.map(id=>db().query(base+' WHERE l.id=$id').get({$id:id,$user:user}) as StoredCompareRow|null);
  if(rows.some(r=>!r))return c.json({error:'A selected listing is no longer available.',missing:ids.filter((_,i)=>!rows[i])},404);
  const sides=rows.map(row=>comparisonSide(withPhotos(row!),kind,benchmarks));
  for(const side of sides){const own=overrides.get(side.id);if(own)side.call=own.call;}
  c.header('Cache-Control','private, no-store');
  return c.json(compareSides(sides,kind,workload as Workload,benchmarks));
}
export function handleComparisonCandidates(c:Context){
  const kind=parseKind(c),q=(c.req.query('q')??'').trim().toLowerCase(),before=c.req.query('before');
  if(!kind||q.length>100||(before!=null&&(!/^\d+$/.test(before)||!Number.isSafeInteger(Number(before))||Number(before)<1)))return c.json({error:'Invalid comparison search.'},400);
  const user=currentUser(c)!.id,overrides=loadAccountOverrides(user),items:CompareCandidate[]=[];let cursor=before?Number(before):Number.MAX_SAFE_INTEGER,scanned=0,exhausted=false;
  // Apply scope, recency and personal removals before paging. Continue scanning
  // when a component category contains other kinds; a short page is not EOF.
  const query=db().query(base+` WHERE l.id<$before AND l.delisted_at IS NULL
    AND COALESCE(l.posted_at,l.last_seen,l.captured_at)>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-28 days')
    AND COALESCE(v.call,'')<>'OUT_OF_SCOPE'
    AND NOT EXISTS(SELECT 1 FROM listing_dismissals d WHERE d.listing_id=l.id AND d.user_id=$user)
    AND ($q='' OR instr(lower(l.title),$q)>0 OR instr(lower(CASE WHEN json_valid(v.payload) THEN COALESCE(json_extract(v.payload,'$.provenance.facts.description'),'') ELSE '' END),$q)>0)
    ORDER BY l.id DESC LIMIT 100`);
  while(items.length<20&&scanned<1000&&!exhausted){
    const rows=query.all({$before:cursor,$user:user,$q:q}) as StoredCompareRow[];
    if(!rows.length){exhausted=true;break;}
    for(const row of rows){cursor=row.id;scanned++;const side=comparisonSide(row,kind,benchmarks,Date.now(),false);
      if(!comparisonCategories[kind].includes(side.category)||!side.hardware.evidence.length)continue;
      const photos=withPhotos(row).photoUrls??[];
      const hasThumb=!!db().query('SELECT 1 FROM listing_thumbs WHERE listing_id=?').get(row.id);
      items.push({id:row.id,title:side.title,priceCents:side.priceCents,source:side.source,location:side.location,thumb:hasThumb?'/v1/thumb/'+row.id:photos[0]??null,photoUrls:photos,identity:side.hardware.identity,state:side.hardware.state,call:overrides.get(row.id)?.call??side.call,wholeSystem:!side.standalone});
      if(items.length===20)break;
    }
    if(rows.length<100&&cursor===rows.at(-1)!.id)exhausted=true;
  }
  c.header('Cache-Control','private, no-store');return c.json({items,nextCursor:exhausted?null:cursor,kind});
}
