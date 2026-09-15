import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {STATE_DIR} from './state.ts';
import type {Source} from './collection.ts';
type RecordValue={failures:number;retryAt:string;reason:string};
function read():Partial<Record<Source,RecordValue>> {try{return JSON.parse(readFileSync(join(STATE_DIR,'source-backoff.json'),'utf8'));}catch{return {};}}
export function sourceCooldown(source:Source,at=Date.now()) {const row=read()[source];return row&&Date.parse(row.retryAt)>at?row:null;}
export function recordSourceAttempt(source:Source,ok:boolean,error='',at=Date.now()) {
  const rows=read();
  if(ok)delete rows[source];
  else if(/challenge|captcha|blocked|429|log.?in|sign.?in|timeout|timed out/i.test(error)) {
    const failures=Math.min(8,(rows[source]?.failures??0)+1),delay=Math.min(6*3600_000,20*60_000*2**(failures-1));
    rows[source]={failures,retryAt:new Date(at+delay).toISOString(),reason:/log.?in|sign.?in/i.test(error)?'Sign-in needs attention':'Marketplace needs a pause'};
  } else return;
  mkdirSync(STATE_DIR,{recursive:true});const path=join(STATE_DIR,'source-backoff.json'),tmp=path+'.tmp';writeFileSync(tmp,JSON.stringify(rows));renameSync(tmp,path);
}
