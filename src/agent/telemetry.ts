import {randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import type {Database} from 'bun:sqlite';
import {STATE_DIR} from './state.ts';
import {maintenanceState} from './maintenance.ts';

/** Stable machine identity is separate from the run ID that owns job reports. */
export function nodeIdentity() {
  mkdirSync(STATE_DIR,{recursive:true});const path=join(STATE_DIR,'node-id');
  try {const id=readFileSync(path,'utf8').trim();if(/^[a-f0-9-]{36}$/.test(id))return id;}catch{}
  const id=randomUUID();writeFileSync(path,id,{flag:'wx'});return id;
}
export function queuedChanges(d:Database,target:string) {
  if(!d.query("SELECT 1 FROM sqlite_master WHERE name='sync_outbox'").get())return null;
  return Object.fromEntries((d.query('SELECT source,COUNT(*) n FROM sync_outbox WHERE target=? GROUP BY source').all(target) as {source:string;n:number}[]).map(r=>[r.source,r.n]));
}
export function nodeTelemetry(d:Database,target:string,nodeId:string,revision:string,status:string,jobId:number|null) {
  return {nodeId,label:process.env.FILTRSOFT_AGENT_LABEL??hostname(),revision,status,jobId,pending:queuedChanges(d,target),maintenance:maintenanceState()};
}
