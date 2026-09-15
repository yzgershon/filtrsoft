/** Server claims coordinate hosts; the machine lease also excludes manual
 * daily runs and duplicate startup launchers. No browser login is automated. */
import {randomUUID} from 'node:crypto';
import {db,DB_PATH} from '../db/index.ts';
import {queueJobReport,flushJobReports} from '../agent/reports.ts';
import {collect,isSource} from '../agent/collection.ts';
import {claimRunner,advanceCursor,runnerVersion,writeRunnerState} from '../agent/state.ts';
import {runCommand} from '../agent/process.ts';
import {isPaused} from './pause.ts';

const API=(process.env.FILTRSOFT_API??'https://filtrsoft.com').replace(/\/$/,'');
const TOKEN=(process.env.FILTRSOFT_PUSH_TOKEN??'').trim();
if(!TOKEN){console.error('FILTRSOFT_PUSH_TOKEN is not configured; no work claimed.');process.exit(1);}
try {claimRunner();}catch(error){console.log(`collector already owned: ${String(error)}`);process.exit(0);}
const revision=runnerVersion(),agent=randomUUID();
const auth={authorization:`Bearer ${TOKEN}`,'x-filtrsoft-agent':agent,'x-filtrsoft-agent-version':revision};
let lastPollAt:string|null=null,lastError:string|null=null,progress='starting',jobId:number|null=null;
const state=(status:string)=>writeRunnerState({status,revision,api:API,database:DB_PATH,lastPollAt,lastError,progress,jobId});
async function report(id:number,body:Record<string,unknown>){queueJobReport(db(),API,agent,id,body);await flushJobReports(db(),API,auth.authorization);}
async function doJob(job:{id:number;sources:string[]}) {
  jobId=job.id;progress='starting';state('working');
  const heartbeat=setInterval(()=>{state('working');void report(job.id,{progress}).catch(error=>{lastError=String(error).slice(0,300);});},30_000);
  try {
    const sources=job.sources.filter(isSource);
    const summary=await collect(sources,{cursor:advanceCursor(2),paused:isPaused,
      run:step=>runCommand(process.execPath,step.args,{timeoutMs:step.timeoutMs,cancelled:step.kind==='sync'?undefined:isPaused,onOutput:text=>process.stdout.write(text)}),
      stage:async(step,status,error)=>{progress=step.name;state('working');await report(job.id,{progress,stage:{name:step.name,status,error}});}});
    for(const source of job.sources.filter(s=>!isSource(s)))summary[source]='unknown source';
    // Local and Railway databases have separate spend ledgers. Paid photo
    // analysis must be explicitly budgeted on this collector, not assumed shared.
    const visionLimit=Math.min(60,Math.max(0,Number(process.env.FILTRSOFT_AGENT_VISION_LIMIT)||0));
    if(visionLimit&&!isPaused()) {
      progress='vision';await report(job.id,{progress,stage:{name:'vision',status:'running'}});
      const result=await runCommand(process.execPath,['run','vision','--limit',String(visionLimit)],{timeoutMs:12*60_000,cancelled:isPaused});
      await report(job.id,{stage:{name:'vision',status:result.ok?'done':'failed',error:result.ok?undefined:result.tail.slice(-350)}});
      if(!result.ok)summary.vision='failed';
      for(const source of sources) {
        const sync=await runCommand(process.execPath,['run','push','--source',source],{timeoutMs:3*60_000});
        if(!sync.ok)summary[source]=`${summary[source]} | final sync failed`;
      }
    }
    const ok=Object.values(summary).length>0&&Object.values(summary).every(s=>s==='ok');
    await report(job.id,{status:ok?'done':'failed',result:summary,error:ok?undefined:'one or more stages failed; partial results preserved',progress:ok?'complete':'partial results; see source stages'});
    console.log(`job #${job.id}: ${JSON.stringify(summary)}`);
    lastError=ok?null:JSON.stringify(summary).slice(0,500);
  } finally {clearInterval(heartbeat);jobId=null;progress='waiting';}
}

console.log(`Filtrsoft collector ${revision} watching ${API}; database ${DB_PATH}`);
state('starting');
while(true) {
  if(isPaused()){state('paused');await Bun.sleep(15_000);continue;}
  try {
    await flushJobReports(db(),API,auth.authorization);
    const response=await fetch(`${API}/v1/jobs/next`,{headers:auth,signal:AbortSignal.timeout(15_000)});
    if(!response.ok)throw new Error(`poll HTTP ${response.status}`);
    lastPollAt=new Date().toISOString();
    const body=await response.json() as {job?:{id:number;sources:string[]}};
    state('online');if(body.job)await doJob(body.job);
  } catch(error){lastError=String(error).slice(0,500);console.error(`[${new Date().toISOString()}] ${lastError}`);state('offline');}
  await Bun.sleep(15_000);
}
