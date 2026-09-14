import type {Context} from 'hono';
import {db,now} from '../db/index.ts';
import {currentUser,ownsDevice} from './auth.ts';
import {validSyncValue,type SyncEntries,type SyncChange} from '../account-sync.ts';

export async function accountSync(c:Context) {
  const owner=currentUser(c);if(!owner)return c.json({error:'Sign in required'},401);
  if(c.req.query('account')!==String(owner.id))return c.json({error:'Account changed. Reload before syncing.'},409);
  let changes:SyncChange[]=[];
  if(c.req.method==='POST'){
    const b=await c.req.json().catch(()=>null);
    if(!b||!Array.isArray(b.changes)||b.changes.length>200||JSON.stringify(b).length>250000)return c.json({error:'Invalid sync batch'},400);
    changes=b.changes;
    if(new Set(changes.map(x=>x?.key)).size!==changes.length||changes.some(x=>!x||typeof x.key!=='string'||!validSyncValue(x.key,x.value)||!Number.isSafeInteger(x.base)||x.base<0||typeof x.token!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(x.token)||x.importOnly!==undefined&&typeof x.importOnly!=='boolean'))return c.json({error:'Invalid sync change'},400);
  }
  const d=db(),accepted:string[]=[],conflicts:string[]=[],legacyAllowed=ownsDevice(owner.id,c.req.query('legacyRef'));
  if(changes.some(x=>x.importOnly)&&!legacyAllowed)return c.json({error:'This device cannot import legacy data to this account'},403);
  const entries:SyncEntries={};
  const apply=()=>{
    const rows=d.query('SELECT key,value_json,revision FROM account_sync WHERE user_id=?').all(owner.id) as {key:string;value_json:string;revision:number}[];
    if(rows.length+changes.filter(x=>!rows.some(r=>r.key===x.key)).length>20000)throw new Error('Account sync capacity reached');
    for(const row of rows)entries[row.key]={value:JSON.parse(row.value_json),revision:row.revision};
    for(const change of changes){
      const prev=entries[change.key],json=JSON.stringify(change.value);
      // Retried acknowledgements are harmless. Import fills only never-seen
      // fields: an explicit cloud deletion wins over an old browser bookmark.
      if((change.importOnly&&prev)||prev&&JSON.stringify(prev.value)===json){accepted.push(change.token);continue;}
      if((prev?.revision??0)!==change.base){conflicts.push(change.token);continue;}
      const revision=(prev?.revision??0)+1;
      d.run(`INSERT INTO account_sync(user_id,key,value_json,revision,updated_at) VALUES(?,?,?,?,?)
        ON CONFLICT(user_id,key) DO UPDATE SET value_json=excluded.value_json,revision=excluded.revision,updated_at=excluded.updated_at`,[owner.id,change.key,json,revision,now()]);
      entries[change.key]={value:change.value,revision};accepted.push(change.token);
    }
  };
  if(changes.length)d.transaction(apply)();else apply();
  c.header('Cache-Control','no-store');return c.json({userId:owner.id,entries,accepted,conflicts,legacyAllowed,at:now()});
}
