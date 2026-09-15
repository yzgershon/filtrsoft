import {mkdirSync,writeFileSync,renameSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {homedir,hostname} from 'node:os';
import {execFileSync} from 'node:child_process';
import {acquireProfileLease} from '../browser/profile-lease.mjs';

export const STATE_DIR=process.env.FILTRSOFT_AGENT_STATE??join(homedir(),'.filtrsoft','runner');
// Ownership is machine-wide even when two checkouts choose different log dirs.
// The override is used by disposable tests; installers retain this shared default.
export const LOCK_DIR=process.env.FILTRSOFT_AGENT_LOCK_DIR??join(homedir(),'.filtrsoft','runner-locks');
export function claimRunner(name='collector') {mkdirSync(LOCK_DIR,{recursive:true});return acquireProfileLease(join(LOCK_DIR,name));}
export function runnerVersion() {
  try{return execFileSync('git',['-c',`safe.directory=${process.cwd().replaceAll('\\','/')}`,'rev-parse','--short=12','HEAD'],{encoding:'utf8',windowsHide:true,timeout:5000}).trim();}
  catch{return 'unknown';}
}
export function writeRunnerState(state:Record<string,unknown>) {
  mkdirSync(STATE_DIR,{recursive:true});
  const path=join(STATE_DIR,'status.json'),temp=path+`.${process.pid}.tmp`;
  writeFileSync(temp,JSON.stringify({pid:process.pid,host:hostname(),platform:process.platform,arch:process.arch,updatedAt:new Date().toISOString(),...state},null,2));
  renameSync(temp,path);
}
export function readCursor() {try{const n=Number(readFileSync(join(STATE_DIR,'cursor'),'utf8'));return Number.isSafeInteger(n)&&n>=0?n:0;}catch{return 0;}}
export function advanceCursor(queries:number) {
  if(!Number.isSafeInteger(queries)||queries<1)throw new Error('Invalid cursor step');
  const cursor=readCursor(),next=cursor+queries;
  if(!Number.isSafeInteger(next))throw new Error('Search cursor overflow');
  mkdirSync(STATE_DIR,{recursive:true});const path=join(STATE_DIR,'cursor'),temp=path+'.tmp';
  // Modulo five silently starved every new query beyond the original list and
  // reset maker/parts rotation. Each search family handles its own modulo.
  writeFileSync(temp,String(next));renameSync(temp,path);return cursor;
}
