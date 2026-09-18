/** Small targeted maintenance chunks run under the existing agent lease. */
import {dueDetails} from '../db/enrichment.ts';import {runCommand} from '../agent/process.ts';import {sourceCooldown} from '../agent/backoff.ts';
import {db} from '../db/index.ts';import {flushCatalog} from '../sync/catalog.ts';import {captureNewComps,flushComps} from '../sync/comps.ts';
for(const [source,script] of [['facebook','fb:detail'],['offerup','ou:photos'],['mercari','mc:detail']] as const){
 if(sourceCooldown(source)||!dueDetails(source,40).some(r=>r.recovery_requested_at))continue;
 const read=await runCommand(process.execPath,['run',script,'--limit','5'],{timeoutMs:90000,onOutput:s=>process.stdout.write(s)});
 const sync=await runCommand(process.execPath,['run','push','--source',source],{timeoutMs:30000,onOutput:s=>process.stdout.write(s)});
 if(!read.ok||!sync.ok)process.exitCode=1;
}
// A transport failure must retry durable transfers without waiting for another
// browser sale search. Catalog acknowledgements always precede related comps.
const target=new URL(process.env.FILTRSOFT_API??'https://filtrsoft.com').origin,token=process.env.FILTRSOFT_PUSH_TOKEN;
if(token){const d=db();captureNewComps(d,target,(d.query('SELECT COALESCE(MAX(id),0) id FROM comps').get() as {id:number}).id);console.log(`Acknowledged ${await flushCatalog(target,'Bearer '+token)} catalog identities`);console.log(`Acknowledged ${await flushComps(d,target,'Bearer '+token)} comp transfers`);}
