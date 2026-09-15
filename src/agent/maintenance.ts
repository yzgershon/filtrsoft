import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {STATE_DIR} from './state.ts';
import {runCommand,type CommandResult} from './process.ts';
export type MaintenanceRecord={status:'running'|'done'|'failed';attemptedAt:string;finishedAt?:string;nextAt:string;note:string};
export function maintenanceState():Record<string,MaintenanceRecord> {try{return JSON.parse(readFileSync(join(STATE_DIR,'maintenance.json'),'utf8'));}catch{return {};}}
export function maintenanceDue(name:string,at=Date.now()) {const previous=maintenanceState()[name];return !previous||Date.parse(previous.nextAt)<=at;}
export async function maintenanceTask(name:string,args:string[],opts:{intervalMs:number;timeoutMs:number;cancelled?:()=>boolean;env?:NodeJS.ProcessEnv;run?:(args:string[])=>Promise<CommandResult>}) {
  if(!maintenanceDue(name))return false;
  const save=(row:MaintenanceRecord)=>{mkdirSync(STATE_DIR,{recursive:true});const file=join(STATE_DIR,'maintenance.json'),temp=file+'.tmp';writeFileSync(temp,JSON.stringify({...maintenanceState(),[name]:row}));renameSync(temp,file);};
  const attemptedAt=new Date().toISOString();
  // A crash leaves a bounded retry delay, not a permanent "running" flag.
  save({status:'running',attemptedAt,nextAt:new Date(Date.now()+3600_000).toISOString(),note:'In progress'});
  let result:CommandResult;try{result=await (opts.run?opts.run(args):runCommand(process.execPath,args,{timeoutMs:opts.timeoutMs,cancelled:opts.cancelled,env:opts.env}));}
  catch{result={ok:false,tail:'',timedOut:false,cancelled:false};}
  save({status:result.ok?'done':'failed',attemptedAt,finishedAt:new Date().toISOString(),nextAt:new Date(Date.now()+(result.ok?opts.intervalMs:3600_000)).toISOString(),
    note:result.ok?'Completed and verified':result.cancelled?'Yielded to collection':result.timedOut?'Timed out; retry scheduled':'Failed; retry scheduled. Check the local maintenance log.'});
  // File paths and raw command errors remain local, never included in telemetry.
  writeFileSync(join(STATE_DIR,`maintenance-${name}.log`),result.tail.slice(-12000));
  return result.ok;
}
export async function backupIfDue() {
  return maintenanceTask('backup',['run','backup','--local-only'],{intervalMs:24*3600_000,timeoutMs:180_000,
    env:{...process.env,FILTRSOFT_BACKUP_DIR:process.env.FILTRSOFT_BACKUP_DIR??join(STATE_DIR,'backups'),FILTRSOFT_BACKUP_KEEP:process.env.FILTRSOFT_BACKUP_KEEP??'3'}});
}
