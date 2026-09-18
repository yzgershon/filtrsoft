/** Bounded free browser collection. New comps upload through a durable queue. */
import {db} from '../db/index.ts';
import {captureNewComps,flushComps} from '../sync/comps.ts';
import {runCommand} from '../agent/process.ts';
import {recoverIdentities} from '../catalog/recovery.ts';
import {flushCatalog} from '../sync/catalog.ts';
const target=new URL(process.env.FILTRSOFT_API??'https://filtrsoft.com').origin;
const token=process.env.FILTRSOFT_PUSH_TOKEN;if(!token)throw new Error('Collector environment is not configured');
const d=db(),start=(d.query('SELECT COALESCE(MAX(id),0) id FROM comps').get() as {id:number}).id;
console.log('Identity recovery',JSON.stringify(recoverIdentities(40)));
console.log(`Acknowledged ${await flushCatalog(target,`Bearer ${token}`)} catalog identities`);
// Establish the cursor before collection, so a killed process cannot strand
// newly saved rows. A later invocation queues them before any further visits.
captureNewComps(d,target,start);await flushComps(d,target,`Bearer ${token}`);
let ok=false;
try {const result=await runCommand(process.execPath,['run','ebay:comps','--skus','3'],{timeoutMs:300000});console.log(result.tail);ok=result.ok;}
finally {
 // The query planner can resolve further identities. Synchronize those catalog
 // keys before their newly collected sales reach the server's strict receiver.
 console.log(`Acknowledged ${await flushCatalog(target,`Bearer ${token}`)} catalog identities`);
 captureNewComps(d,target,start);console.log(`Acknowledged ${await flushComps(d,target,`Bearer ${token}`)} comp transfers`);
}
if(!ok)process.exitCode=1;
