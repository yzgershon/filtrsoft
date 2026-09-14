import {SYNC_EVENT,validSyncValue,type SyncChange,type SyncEntries,type SyncReply} from '../../src/account-sync.ts';
export {SYNC_EVENT};
type Pending=SyncChange&{conflict?:boolean};
type Cache={entries:SyncEntries;pending:Record<string,Pending>;imported:boolean;lastSync:string|null};
export type SyncStatus={userId:number|null;phase:'loading'|'syncing'|'synced'|'offline'|'error'|'conflict';pending:number;conflicts:number;lastSync:string|null;error:string|null};
const EMPTY=():Cache=>({entries:{},pending:{},imported:false,lastSync:null});
const keys:Record<string,string>={'filtrsoft:settings':'setting','filtrsoft:watch':'saved','filtrsoft:history':'history','filtrsoft:notes':'note','filtrsoft:asked':'asked','filtrsoft:seen':'seen','filtrsoft:followup':'followup'};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function splitLocal(key:string,raw:string|null):Record<string,unknown>{
  const kind=keys[key],out:Record<string,unknown>={};if(!kind)return out;
  try{
    const value=JSON.parse(raw??'null');
    if(['setting','seen','followup'].includes(kind)){
      if(value&&typeof value==='object'&&!Array.isArray(value))for(const [id,v] of Object.entries(value))if(validSyncValue(`${kind}:${id}`,v))out[`${kind}:${id}`]=v;
    }else if(Array.isArray(value)){
      for(const [i,v] of value.entries()){
        const id=['saved','asked'].includes(kind)?v:v?.id;
        const entry=['saved','asked'].includes(kind)?Date.now()-i:v;
        if(validSyncValue(`${kind}:${id}`,entry))out[`${kind}:${id}`]=entry;
      }
    }
  }catch{}
  return out;
}
export function joinLocal(key:string,values:Record<string,unknown>):string|null{
  const kind=keys[key];if(!kind)return null;
  const rows=Object.entries(values).filter(([k,v])=>k.startsWith(kind+':')&&v!==null);
  if(['setting','seen','followup'].includes(kind))return JSON.stringify(Object.fromEntries(rows.map(([k,v])=>[k.slice(kind.length+1),v])));
  rows.sort((a,b)=>Number((b[1] as any)?.at??b[1])-Number((a[1] as any)?.at??a[1]));
  return JSON.stringify(rows.slice(0,kind==='history'?30:kind==='note'?60:200).map(([k,v])=>['saved','asked'].includes(kind)?Number(k.split(':')[1]):v));
}

/** A durable per-account outbox, never a shared localStorage snapshot. Writes
 * made during a request keep their newer token; a stale acknowledgement cannot
 * erase them. Conflicting edits are retained for explicit resolution. */
export class AccountSync {
  state:Cache=EMPTY();phase:SyncStatus['phase']='loading';error:string|null=null;
  private running=false;private stopped=false;
  readonly storageKey:string;
  constructor(readonly userId:number,private storage:Pick<Storage,'getItem'|'setItem'>,private send:(changes:SyncChange[])=>Promise<SyncReply>,private changed:()=>void){
    this.storageKey=`filtrsoft:account:${userId}`;
    this.restore();
  }
  restore(){try{
    const v=JSON.parse(this.storage.getItem(this.storageKey)??'null');
    if(!v||!v.entries||!v.pending||typeof v.imported!=='boolean')return;
    const entries:SyncEntries={},pending:Record<string,Pending>={};
    // A damaged cache must not crash the signed-in shell. Keep valid records
    // and queued work instead of trusting a parsed object's shape.
    for(const [key,row] of Object.entries(v.entries) as [string,any][])if(row&&validSyncValue(key,row.value)&&Number.isSafeInteger(row.revision)&&row.revision>0)entries[key]={value:row.value,revision:row.revision};
    for(const [key,row] of Object.entries(v.pending) as [string,any][])if(row&&row.key===key&&validSyncValue(key,row.value)&&Number.isSafeInteger(row.base)&&row.base>=0&&typeof row.token==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(row.token))pending[key]={key,value:row.value,base:row.base,token:row.token,...(row.importOnly===true?{importOnly:true}:{}),...(row.conflict===true?{conflict:true}:{})};
    this.state={entries,pending,imported:v.imported,lastSync:typeof v.lastSync==='string'&&Number.isFinite(Date.parse(v.lastSync))?v.lastSync:null};
  }catch{}}
  private persist(){try{this.storage.setItem(this.storageKey,JSON.stringify(this.state));}catch{this.error='Browser storage is unavailable. Keep this page open until sync finishes.';}this.changed();}
  values(){return {...Object.fromEntries(Object.entries(this.state.entries).map(([k,v])=>[k,v.value])),...Object.fromEntries(Object.entries(this.state.pending).map(([k,v])=>[k,v.value]))};}
  read(key:string){return joinLocal(key,this.values());}
  write(key:string,raw:string|null){
    this.restore();
    const kind=keys[key];if(!kind)return;
    const old=splitLocal(key,this.read(key)),next=splitLocal(key,raw),values=this.values();
    for(const k of new Set([...Object.keys(old),...Object.keys(next)])){
      // Saved ordering is cosmetic: refreshing a list must not rewrite every
      // bookmark and create conflicts with another device's removal.
      if((kind==='saved'||kind==='asked')&&k in old&&k in next)continue;
      const value=next[k]??null;if(same(values[k]??null,value))continue;
      const prior=this.state.pending[k];
      this.state.pending[k]={key:k,value,base:prior?.base??this.state.entries[k]?.revision??0,token:crypto.randomUUID()};
    }
    this.phase='syncing';this.persist();void this.flush();
  }
  async flush(){
    if(this.running||this.stopped)return;
    this.running=true;this.phase='syncing';this.changed();
    try{
      const batch=Object.values(this.state.pending).filter(x=>!x.conflict).slice(0,200);
      const response=await this.send(batch);if(this.stopped)return;
      if(response.userId!==this.userId||!response.entries||!Array.isArray(response.accepted)||!Array.isArray(response.conflicts))throw Error('Account changed. Sign in again before syncing.');
      this.restore();
      for(const [key,entry] of Object.entries(response.entries))if(entry.revision>=(this.state.entries[key]?.revision??0))this.state.entries[key]=entry;
      for(const sent of batch){
        const current=this.state.pending[sent.key];if(!current)continue;
        if(response.accepted.includes(sent.token)){
          if(current.token===sent.token)delete this.state.pending[sent.key];
          else current.base=response.entries[sent.key]?.revision??0;
        }else if(response.conflicts.includes(sent.token))current.conflict=true;
      }
      if(!this.state.imported){
        if(response.legacyAllowed){
          for(const key of Object.keys(keys))for(const [k,value] of Object.entries(splitLocal(key,this.storage.getItem(key)))){
            if(!this.state.entries[k]&&!this.state.pending[k])this.state.pending[k]={key:k,value,base:0,token:crypto.randomUUID(),importOnly:true};
          }
        }
        this.state.imported=true;
      }
      this.state.lastSync=response.at;this.error=null;
      this.phase=Object.values(this.state.pending).some(x=>x.conflict)?'conflict':Object.keys(this.state.pending).length?'syncing':'synced';
      this.persist();
    }catch(e){if(!this.stopped){this.phase=typeof navigator!=='undefined'&&!navigator.onLine?'offline':'error';this.error=e instanceof Error?e.message:'Sync failed';this.changed();}}
    finally{this.running=false;}
    if(!this.stopped&&this.phase!=='error'&&this.phase!=='offline'&&Object.values(this.state.pending).some(x=>!x.conflict))void this.flush();
  }
  resolve(useLocal:boolean,onlyKey?:string){
    this.restore();
    for(const [key,change] of Object.entries(this.state.pending))if(change.conflict&&(!onlyKey||key===onlyKey)){
      if(useLocal)this.state.pending[key]={...change,base:this.state.entries[key]?.revision??0,token:crypto.randomUUID(),conflict:false};
      else delete this.state.pending[key];
    }
    this.persist();void this.flush();
  }
  stop(){this.stopped=true;}
  status():SyncStatus{return {userId:this.userId,phase:this.phase,pending:Object.keys(this.state.pending).length,conflicts:Object.values(this.state.pending).filter(x=>x.conflict).length,lastSync:this.state.lastSync,error:this.error};}
}

let active:AccountSync|null=null;
const announce=()=>{if(typeof window!=='undefined')window.dispatchEvent(new Event(SYNC_EVENT));};
export const syncStatus=():SyncStatus=>active?.status()??{userId:null,phase:'loading',pending:0,conflicts:0,lastSync:null,error:null};
export function readAccountLocal(key:string){return active?active.read(key):null;}
export function writeAccountLocal(key:string,raw:string|null){active?.write(key,raw);}
export function onAccountData(fn:()=>void){window.addEventListener(SYNC_EVENT,fn);return()=>window.removeEventListener(SYNC_EVENT,fn);}
export const syncNow=()=>active?.flush();
export const resolveSync=(useLocal:boolean,key?:string)=>active?.resolve(useLocal,key);
export const syncConflicts=()=>Object.entries(active?.state.pending??{}).filter(([,p])=>p.conflict).map(([key,p])=>({key,local:p.value,cloud:active?.state.entries[key]?.value??null}));
export function clearSyncedCache(){
  if(!active||active.status().pending||active.phase!=='synced')return false;
  localStorage.removeItem(active.storageKey);
  localStorage.setItem(active.storageKey,JSON.stringify({...EMPTY(),imported:true}));
  return true;
}
export function beginAccountSync(userId:number,ref:string){
  active?.stop();
  const controller=new AbortController();
  const browserStorage={getItem:(key:string)=>{try{return localStorage.getItem(key);}catch{return null;}},setItem:(key:string,value:string)=>localStorage.setItem(key,value)};
  const engine=new AccountSync(userId,browserStorage,async changes=>{
    const timeout=AbortSignal.timeout(15000),signal=AbortSignal.any([controller.signal,timeout]);
    const r=await fetch(`/v1/account/sync?account=${userId}&legacyRef=${encodeURIComponent(ref)}`,{method:changes.length?'POST':'GET',cache:'no-store',signal,headers:changes.length?{'Content-Type':'application/json'}:undefined,body:changes.length?JSON.stringify({changes}):undefined});
    if(r.status===401||r.status===409)window.dispatchEvent(new Event('filtrsoft:sync-auth-changed'));
    if(!r.ok)throw Error(r.status===401?'Sign in again to sync this account.':`Sync could not finish (${r.status}). Your changes remain on this device.`);
    return r.json();
  },announce);
  active=engine;announce();void engine.flush();
  const tick=()=>{if(document.visibilityState==='visible')void engine.flush();};
  const timer=setInterval(tick,15000);
  const storage=(e:StorageEvent)=>{if(e.key===engine.storageKey){engine.restore();announce();}};
  window.addEventListener('online',tick);window.addEventListener('focus',tick);document.addEventListener('visibilitychange',tick);window.addEventListener('storage',storage);
  return()=>{clearInterval(timer);controller.abort();engine.stop();window.removeEventListener('online',tick);window.removeEventListener('focus',tick);document.removeEventListener('visibilitychange',tick);window.removeEventListener('storage',storage);if(active===engine)active=null;announce();};
}
