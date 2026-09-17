import {createHash} from 'node:crypto';
import {extractAttributes} from '../catalog/match.ts';
import {detectCategory} from '../signals/index.ts';

export type RecoveryJob='text'|'photos'|'identity'|'comps'|'availability'|'unresolved';
export interface RecoveryBlocker {field:string;job:RecoveryJob;reason:string}
export interface ReadReceipt {fingerprint:string;complete:boolean;unchanged:number;observedAt:string;durationMs:number;reason:string}
const object=(v:any)=>{try{return typeof v==='string'?JSON.parse(v):v??{};}catch{return {};}};
/** Observation time is not content. Duplicate cards must not reopen work. */
export function recoveryFingerprint(row:any):string {
  return createHash('sha256').update(JSON.stringify([row.title,row.description??'',row.asking_price_cents??row.askingPriceCents,
    object(row.raw_json??row.raw).attributes??{},object(row.photos??row.photoUrls??'[]')])).digest('hex');
}
/** Shared by server repair targets and collector details. A headline is not a
 * complete account of the missing evidence. Preserve every actionable blocker. */
export function recoveryPlan(row:any,at=Date.now()):{blockers:RecoveryBlocker[];jobs:RecoveryJob[];textDue:boolean} {
  const v=object(row.payload??row.verdict),p=v.provenance??{};
  const a={...extractAttributes(`${row.title}\n${row.description??''}`),...p.match?.attributes};
  const category=p.signals?.category??detectCategory(row.title,row.description??'');
  const receipt:ReadReceipt|null=row.recovery?object(row.recovery):null;
  const same=receipt?.fingerprint===recoveryFingerprint(row),complete=same&&receipt?.complete;
  const blockers:RecoveryBlocker[]=[];
  const add=(field:string,job:RecoveryJob,reason:string)=>{if(!blockers.some(b=>b.field===field&&b.job===job))blockers.push({field,job,reason});};
  if(!complete)add('seller text','text','Full current seller text has not been confirmed complete.');
  const missing=new Set<string>(p.signals?.missingValueFields??[]);
  const required=category==='prebuilt'?['cpu','gpu','ram_gb','storage_gb']:category==='laptop'?['cpu','ram_gb','storage_gb']:
    ['phone','tablet'].includes(category)?['storage_gb']:[];
  for(const field of required)if(!a[field])missing.add(field.replace('_gb',''));
  for(const field of missing)add(field,complete?'photos':'text',`${field} is not established by available seller evidence.`);
  const custom=category==='prebuilt'&&Boolean(a.cpu&&a.gpu);
  if(!p.match?.skuId&&!custom)add('exact identity',complete?'identity':'text','Exact model or variant has not resolved to a catalog identity.');
  if(row.call==='INSUFFICIENT_DATA'||v.call==='INSUFFICIENT_DATA') {
    if(custom)add('matching whole build / component sold evidence','comps','Known components need exact sold evidence; a component sum cannot establish the whole machine price.');
    else if(p.match?.skuId)add('exact configuration sold evidence','comps','Generic SKU coverage does not prove configuration coverage.');
    if(v.decidingUnknown)add(v.decidingUnknown,/comp|sold|price/i.test(v.decidingUnknown)?'comps':missing.size?'photos':'unresolved',v.headline??v.decidingUnknown);
  }
  if(['BUY','VERIFY'].includes(row.call??v.call))add('current availability','availability','Recommendations need a fresh availability observation.');
  // Unchanged complete pages move to other evidence. A weekly revisit catches
  // seller edits not visible on cards; relevant changed facts reopen immediately.
  const periodic=complete&&at-Date.parse(receipt!.observedAt)>=7*86400000;
  const lastAttempt=row.attempt_fingerprint??receipt?.fingerprint;
  const eligible=!row.next_attempt_at||Date.parse(row.next_attempt_at)<=at||Boolean(lastAttempt&&lastAttempt!==recoveryFingerprint(row));
  return {blockers,jobs:[...new Set(blockers.map(b=>b.job))],textDue:eligible&&(!complete||periodic)};
}
