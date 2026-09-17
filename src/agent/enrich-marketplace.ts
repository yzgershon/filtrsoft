import {db,now} from '../db/index.ts';
import {dueDetails,recordDetailAttempt} from '../db/enrichment.ts';
import {recordProbe} from '../db/probes.ts';
import {runMarketWorker,parseMercariDetail,mercariDescription,mercariPhotos,parseOfferUpDetail,offerUpDescription,bestPhotos,probeVerdict} from '../sources/marketplace.ts';
import {sameMarketplaceItem} from '../sources/item-url.ts';
import {syncPhotoUrls} from '../vision/merge.ts';
import {observePrice} from '../db/price.ts';

export async function enrichMarketplace(source:'offerup'|'mercari',opts:{limit:number;dry?:boolean;all?:boolean;headless?:boolean}) {
  const work=dueDetails(source,opts.limit,Date.now(),opts.all);
  console.log(`${source}: ${work.length} descriptions/availability checks due`);
  if(opts.dry || !work.length)return {read:0,gone:0,failed:0};
  for(const row of work)recordDetailAttempt(row.id,'failed');
  const pending=new Set(work.map(r=>r.id));let read=0,gone=0,failed=0;
  for await(const ev of runMarketWorker(source,{photosFor:work.map(r=>({id:r.id,url:r.url})),headless:opts.headless??false})) {
    if(ev.type==='log'){console.log(ev.msg);continue;}
    if(ev.type==='error'){console.error(ev.msg);failed++;continue;}
    if(ev.type!=='photos')continue;
    const row=work.find(r=>r.id===ev.id);if(!row)continue;
    pending.delete(row.id);
    const availability=probeVerdict({...ev,text:ev.text??''});
    if(availability?.gone){
      db().transaction(()=>{recordProbe(row.id,'gone');db().run("UPDATE listings SET delisted_at=?,delist_reason='gone' WHERE id=?",[now(),row.id]);recordDetailAttempt(row.id,'gone');})();
      gone++;continue;
    }
    if(ev.error || !sameMarketplaceItem(row.url,ev.finalUrl) || /just a moment|attention required|security verification|log in to continue/i.test(`${ev.title}\n${ev.text??''}`.slice(0,500))) {
      failed++;continue;
    }
    const detail=source==='mercari'?parseMercariDetail(ev.text??''):parseOfferUpDetail(ev.text??'');
    const desc=source==='mercari'?mercariDescription(detail):offerUpDescription(detail);
    const photos=source==='mercari'?mercariPhotos(ev.urls,row.url):bestPhotos(ev.urls);
    if(!desc && !photos.length){recordDetailAttempt(row.id,'empty');continue;}
    db().transaction(()=>{
      const at=now();
      if(desc)db().run('UPDATE listings SET description=?,updated_at=? WHERE id=?',[desc,at,row.id]);
      if(photos.length){syncPhotoUrls(row.id,photos);db().run('UPDATE listings SET photo_count=? WHERE id=?',[photos.length,row.id]);}
      if(availability && !availability.gone){
        recordProbe(row.id,'alive');
        // Only the dedicated item price field, never a recommended card or
        // installment amount. A changed ask also keeps its price history.
        const price=ev.priceText?.trim().match(/^\$([\d,]+(?:\.\d{2})?)$/);
        observePrice(db(),row.id,price?Math.round(Number(price[1].replaceAll(',',''))*100):null,at);
      }else recordProbe(row.id,'unknown');
      db().run('DELETE FROM vision_misses WHERE listing_id=?',[row.id]);
      db().run("INSERT INTO listing_rechecks VALUES(?,'detail',?) ON CONFLICT(listing_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at",[row.id,at]);
      recordDetailAttempt(row.id,detail.description?'read':'empty');
    })();
    read++;console.log(`#${row.id}: ${desc.length} description characters, ${photos.length} photos`);
  }
  failed+=pending.size;console.log(`${source}: ${read} read, ${gone} unavailable, ${failed} failed`);
  return {read,gone,failed};
}
