/** Shared wire contract. Per-item revisions let two devices edit unrelated data
 * without replacing an entire saved list, while tombstones stop stale restores. */
export type SyncEntry = {value:unknown;revision:number};
export type SyncEntries = Record<string,SyncEntry>;
export type SyncChange = {key:string;value:unknown;base:number;token:string;importOnly?:boolean};
export type SyncReply = {userId:number;entries:SyncEntries;accepted:string[];conflicts:string[];legacyAllowed:boolean;at:string};
export const SYNC_EVENT='filtrsoft:account-sync';
export const PASSWORD_MIN=8;
const bools=new Set(['hideGone','reduceMotion','askOutcomes','alerts','alertVerify','showAge','showCall','compact']);
const calls=new Set(['BUY','VERIFY','FAIR','PASS','RISK','INSUFFICIENT_DATA','OUT_OF_SCOPE']);
export function validSyncValue(key:string,value:unknown):boolean {
  const [kind,id,...rest]=key.split(':');if(rest.length||!id)return false;
  const numeric=/^[1-9]\d{0,12}$/.test(id);
  if(kind==='setting'){
    if(value===null)return bools.has(id)||['driveMinutes','driveVersion','theme'].includes(id);
    if(bools.has(id))return typeof value==='boolean';
    if(id==='theme')return ['dark','light','system'].includes(value as string);
    return id==='driveVersion'?value===2:id==='driveMinutes'&&Number.isInteger(value)&&Number(value)>=5&&Number(value)<=90;
  }
  if(kind==='seen')return ['review','all','ready','verify','risky','browse'].includes(id)&&(value===null||typeof value==='string'&&Number.isFinite(Date.parse(value)));
  if(kind==='followup')return id==='shown'&&(value===null||typeof value==='number'&&Number.isFinite(value)&&value>0);
  if(!numeric||!['saved','history','note','asked'].includes(kind))return false;
  if(value===null)return true;
  if(kind==='saved'||kind==='asked')return typeof value==='number'&&Number.isFinite(value)&&value>0;
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  if(v.id!==Number(id)||typeof v.title!=='string'||v.title.length>1500||!calls.has(v.call as string)||typeof v.at!=='number'||!Number.isFinite(v.at)||v.at<=0)return false;
  if(kind==='history')return Object.keys(v).every(k=>['id','title','call','at'].includes(k));
  return Object.keys(v).every(k=>['id','title','call','at','seen','askingPriceCents','thumb'].includes(k))
    &&(v.seen===undefined||typeof v.seen==='boolean')
    &&(v.askingPriceCents===null||Number.isSafeInteger(v.askingPriceCents)&&Number(v.askingPriceCents)>=0)
    &&(v.thumb===null||typeof v.thumb==='string'&&v.thumb.length<=2048&&/^https?:\/\//.test(v.thumb));
}
