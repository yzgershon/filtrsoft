import {db,now} from '../db/index.ts';
import {runWorker,detailToListing,type FbCard} from '../sources/facebook.ts';
import {checkFetched} from '../engine/index.ts';
import {resolveProductType} from '../signals/product-type.ts';
const i=process.argv.indexOf('--limit'),limit=Math.max(1,Math.min(20,Number(process.argv[i+1])||4));
const work=(db().query(`SELECT l.*,(SELECT url FROM listing_photos WHERE listing_id=l.id ORDER BY position LIMIT 1) thumb
  FROM listings l LEFT JOIN verdicts v ON v.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id)
  WHERE l.source='facebook' AND l.delisted_at IS NULL AND length(COALESCE(l.description,''))<40
  ORDER BY CASE v.call WHEN 'BUY' THEN 0 WHEN 'VERIFY' THEN 1 WHEN 'INSUFFICIENT_DATA' THEN 2 ELSE 3 END,l.id DESC`).all() as any[])
  .filter(l=>resolveProductType(l.title).kind==='tech').slice(0,limit);
if(!work.length){console.log('No Facebook descriptions awaiting enrichment');process.exit(0);}
let done=0,failures=0;
for await(const event of runWorker('crawl',{detailsOnly:true,scrolls:0,detailUrls:work.map(l=>l.url)})) {
  if(event.type==='error'){failures++;console.error(event.msg);continue;}
  if(event.type!=='detail')continue;
  const row=work.find(l=>l.url===event.url);if(!row){failures++;continue;}
  const card:FbCard={sourceId:row.source_id,url:row.url,title:row.title,askingPriceCents:row.asking_price_cents,location:row.location,thumb:row.thumb};
  const listing=detailToListing(event,card);
  if(listing.description.trim().length<40||/log in to continue|temporarily blocked|confirm you're human/i.test(listing.description)){failures++;continue;}
  try{await checkFetched({...listing,updatedAt:now()},{persist:true,vision:false});done++;}catch{failures++;}
}
console.log(`${done}/${work.length} Facebook descriptions refreshed`);
if(failures||done<work.length)process.exitCode=1;
