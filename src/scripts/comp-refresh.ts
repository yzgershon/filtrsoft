/** Bounded free browser collection. New comps upload through a durable queue. */
import {db} from '../db/index.ts';
import {captureNewComps,flushComps} from '../sync/comps.ts';
import {runCommand} from '../agent/process.ts';
const target=new URL(process.env.FILTRSOFT_API??'https://filtrsoft.com').origin;
const token=process.env.FILTRSOFT_PUSH_TOKEN;if(!token)throw new Error('Collector environment is not configured');
const d=db(),start=(d.query('SELECT COALESCE(MAX(id),0) id FROM comps').get() as {id:number}).id;
// Establish the cursor before collection, so a killed process cannot strand
// newly saved rows. A later invocation queues them before any further visits.
captureNewComps(d,target,start);await flushComps(d,target,`Bearer ${token}`);
let ok=false;
try {const result=await runCommand(process.execPath,['run','ebay:comps','--skus','1'],{timeoutMs:180000});console.log(result.tail);ok=result.ok;}
finally {captureNewComps(d,target,start);console.log(`Acknowledged ${await flushComps(d,target,`Bearer ${token}`)} comp transfers`);}
if(!ok)process.exitCode=1;
