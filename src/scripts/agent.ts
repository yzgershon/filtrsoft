/** Server claims coordinate hosts; the machine lease also excludes manual
 * daily runs and duplicate startup launchers. No browser login is automated. */
import {randomUUID} from 'node:crypto';
import {nodeIdentity,nodeTelemetry} from '../agent/telemetry.ts';
import {sourceCooldown,recordSourceAttempt} from '../agent/backoff.ts';
import {backupIfDue,maintenanceTask} from '../agent/maintenance.ts';
import {db,DB_PATH} from '../db/index.ts';
import {queueJobReport,flushJobReports} from '../agent/reports.ts';
import {collect,isSource} from '../agent/collection.ts';
import {acceptRepairTargets} from '../agent/targets.ts';
import {recoveryBudgets} from '../agent/recovery-budget.ts';
import {claimRunner,advanceCursor,runnerVersion,writeRunnerState} from '../agent/state.ts';
import {runCommand} from '../agent/process.ts';
import {isPaused} from './pause.ts';

const API=(process.env.FILTRSOFT_API??'https://filtrsoft.com').replace(/\/$/,'');
const TOKEN=(process.env.FILTRSOFT_PUSH_TOKEN??'').trim();
if(!TOKEN){console.error('FILTRSOFT_PUSH_TOKEN is not configured; no work claimed.');process.exit(1);}
try {claimRunner();}catch(error){console.log(`collector already owned: ${String(error)}`);process.exit(0);}
const revision=runnerVersion(),agent=randomUUID();
const nodeId=nodeIdentity();
const auth={authorization:`Bearer ${TOKEN}`,'x-filtrsoft-agent':agent,'x-filtrsoft-agent-version':revision,'x-filtrsoft-node':nodeId,'x-filtrsoft-work-version':'1'};
let ownsLease=true,lastLeaseConfirmed=Date.now(),workWaiting=false;
const interrupted=()=>isPaused()||!ownsLease||jobId!==null&&Date.now()-lastLeaseConfirmed>120_000;
let lastPollAt:string|null=null,lastError:string|null=null,progress='starting',jobId:number|null=null;
const state=(status:string)=>writeRunnerState({status,revision,api:API,database:DB_PATH,lastPollAt,lastError,progress,jobId});
async function heartbeat(status:string) {
  try {const response=await fetch(`${API}/v1/collector/heartbeat`,{method:'POST',headers:{...auth,'content-type':'application/json'},
    body:JSON.stringify(nodeTelemetry(db(),API,nodeId,revision,status,jobId)),signal:AbortSignal.timeout(10_000)});
    if(response.ok){const body=await response.json() as {ownsJob:boolean|null;workWaiting:boolean};workWaiting=body.workWaiting;if(body.ownsJob===false)ownsLease=false;if(body.ownsJob===true)lastLeaseConfirmed=Date.now();}
  }catch{}
}
async function report(id:number,body:Record<string,unknown>){queueJobReport(db(),API,agent,id,body);await flushJobReports(db(),API,auth.authorization);}
async function doJob(job:{id:number;sources:string[];repairTargets?:unknown}) {
  jobId=job.id;ownsLease=true;lastLeaseConfirmed=Date.now();progress='starting';state('working');
  await heartbeat('working');
  const heartbeatTimer=setInterval(()=>{state('working');void heartbeat('working');void report(job.id,{progress}).catch(error=>{lastError=String(error).slice(0,300);});},30_000);
  try {
    const sources=job.sources.filter(isSource);
    if(job.repairTargets)console.log(`Received ${acceptRepairTargets(job.repairTargets)} production listings to refresh`);
    const summary=await collect(sources,{cursor:advanceCursor(2),budgets:recoveryBudgets(),paused:interrupted,cooldown:s=>sourceCooldown(s)?.retryAt??null,
      run:step=>runCommand(process.execPath,step.args,{timeoutMs:step.timeoutMs,cancelled:step.kind==='sync'?undefined:interrupted,onOutput:text=>process.stdout.write(text)}),
      stage:async(step,status,error)=>{progress=step.name;state('working');
        if(step.kind!=='sync'&&status!=='running')recordSourceAttempt(step.source,status==='done',error);
        await report(job.id,{progress,stage:{name:step.name,status,error}});}});
    for(const source of job.sources.filter(s=>!isSource(s)))summary[source]='unknown source';
    // Local and Railway databases have separate spend ledgers. Paid photo
    // analysis must be explicitly budgeted on this collector, not assumed shared.
    const visionLimit=Math.min(60,Math.max(0,Number(process.env.FILTRSOFT_AGENT_VISION_LIMIT)||0));
    if(visionLimit&&!interrupted()) {
      progress='vision';await report(job.id,{progress,stage:{name:'vision',status:'running'}});
      const result=await runCommand(process.execPath,['run','vision','--limit',String(visionLimit)],{timeoutMs:12*60_000,cancelled:interrupted});
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
  } finally {clearInterval(heartbeatTimer);jobId=null;progress='waiting';}
}

console.log(`Filtrsoft collector ${revision} watching ${API}; database ${DB_PATH}`);
state('starting');
while(true) {
  if(isPaused()){state('paused');await heartbeat('paused');await Bun.sleep(15_000);continue;}
  try {
    await flushJobReports(db(),API,auth.authorization);
    await heartbeat('online');
    const response=await fetch(`${API}/v1/jobs/next`,{headers:auth,signal:AbortSignal.timeout(15_000)});
    if(!response.ok)throw new Error(`poll HTTP ${response.status}`);
    lastPollAt=new Date().toISOString();
    const body=await response.json() as {job?:{id:number;sources:string[]}};
    state('online');if(body.job)await doJob(body.job);
    else {
      const timer=setInterval(()=>void heartbeat('online'),15000);
      try{await backupIfDue();
        if(!workWaiting&&!isPaused())await maintenanceTask('cohort',['run','src/scripts/cohort-recovery.ts'],{intervalMs:60000,timeoutMs:300000,cancelled:()=>isPaused()||workWaiting});
        if(!workWaiting&&!isPaused()&&process.env.FILTRSOFT_AGENT_COMPS==='1')await maintenanceTask('comps',['run','comps:refresh'],{intervalMs:3600_000,timeoutMs:360_000,cancelled:()=>isPaused()||workWaiting});
      }finally{clearInterval(timer);}
    }
  } catch(error){lastError=String(error).slice(0,500);console.error(`[${new Date().toISOString()}] ${lastError}`);state('offline');}
  await Bun.sleep(15_000);
}
