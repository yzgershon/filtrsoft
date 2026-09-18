import {db,now} from '../db/index.ts';import {dueDetails,recordDetailAttempt} from '../db/enrichment.ts';
import {fetchListing,probeListing} from '../sources/craigslist.ts';import {checkFetched} from '../engine/index.ts';import {recordProbe} from '../db/probes.ts';
let running=false;
export async function recoverCraigslistCohort(limit=5){
 if(running)return;running=true;
 try {for(const row of dueDetails('craigslist',40).filter(r=>r.recovery_requested_at).slice(0,limit)){
  recordDetailAttempt(row.id,'failed');
  try{const listing=await fetchListing(row.url);await checkFetched(listing,{persist:true,vision:false});recordProbe(row.id,'alive');}
  catch{try{const result=await probeListing(row.url);if(!result.alive&&result.reason){recordProbe(row.id,'gone');db().run("UPDATE listings SET delisted_at=?,delist_reason=? WHERE id=?",[now(),result.reason,row.id]);recordDetailAttempt(row.id,'gone');}else recordProbe(row.id,'unknown');}catch{recordProbe(row.id,'unknown');}}
 }}finally{running=false;}
}
