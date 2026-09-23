import {db,now} from '../db/index.ts';
import {runWorker,detailToListing,detailItemText,type FbCard} from '../sources/facebook.ts';
import {checkFetched} from '../engine/index.ts';
import {probeVerdict} from '../sources/marketplace.ts';
import {sameMarketplaceItem} from '../sources/item-url.ts';
import {recordProbe} from '../db/probes.ts';
import {dueDetails,recordDetailAttempt} from '../db/enrichment.ts';
import {detailCompleteness} from '../sources/detail-evidence.ts';
const i=process.argv.indexOf('--limit'),limit=Math.max(1,Math.min(20,Number(process.argv[i+1])||4));
const work=dueDetails('facebook',limit);
if(!work.length){console.log('No Facebook descriptions awaiting enrichment');process.exit(0);}
let done=0,failures=0;
// Every unread item says why on stdout, which reaches agent.log. Until
// September 22 these were silent, and a whole batch reported only "0/6".
const fail=(id:number,reason:string)=>{failures++;console.log(`facebook detail ${id}: ${reason}`);};
const path=(u:string)=>{try{return new URL(u).pathname;}catch{return 'invalid url';}};
// Reserve a retry before the browser starts: a killed worker must not leave
// the same unreachable item at the head of every future pass.
for(const row of work)recordDetailAttempt(row.id,'failed');
for await(const event of runWorker('crawl',{detailsOnly:true,scrolls:0,detailUrls:work.map(l=>l.url)})) {
  if(event.type==='error'){failures++;console.error(event.msg);continue;}
  if(event.type!=='detail')continue;
  const row=work.find(l=>l.url===event.url);if(!row){failures++;continue;}
  const availability=probeVerdict({...event,text:event.bodyLines.join('\n'),finalUrl:event.finalUrl??'',itemText:detailItemText(event)});
  if(availability?.gone){db().transaction(()=>{recordProbe(row.id,'gone');db().run("UPDATE listings SET delisted_at=?,delist_reason='gone' WHERE id=?",[now(),row.id]);recordDetailAttempt(row.id,'gone');})();console.log(`facebook detail ${row.id}: gone (${availability.reason})`);done++;continue;}
  if(!sameMarketplaceItem(row.url,event.finalUrl??'')){recordProbe(row.id,'unknown');fail(row.id,`landed on ${path(event.finalUrl??'')}`);continue;}
  if(!event.heading){recordProbe(row.id,'unknown');fail(row.id,'no item heading rendered');continue;}
  if(!availability){recordProbe(row.id,'unknown');fail(row.id,'no availability evidence (price or message control)');continue;}
  const card:FbCard={sourceId:row.source_id,url:row.url,title:row.title,askingPriceCents:row.asking_price_cents,location:row.location,thumb:row.thumb};
  const listing=detailToListing(event,card);
  if(!listing.description.trim()||/log in to continue|temporarily blocked|confirm you're human/i.test(listing.description)){fail(row.id,'sign-in or block text instead of the item');continue;}
  const completion=detailCompleteness(listing.description,event.extraction);
  try{await checkFetched({...listing,updatedAt:listing.description!==row.description?now():row.updated_at},{persist:true,vision:false});recordProbe(row.id,'alive');recordDetailAttempt(row.id,'read',Date.now(),{...completion,durationMs:event.readMs});done++;}
  catch(e){fail(row.id,`engine error: ${String((e as Error)?.message??e).slice(0,160)}`);}
}
console.log(`${done}/${work.length} Facebook descriptions refreshed`);
if(!done && (failures||done<work.length))process.exitCode=1;
