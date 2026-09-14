import {test,expect} from 'bun:test';
import {isolated} from './isolated.ts';
import {AccountSync} from '../web/src/account-sync.ts';
import type {SyncReply,SyncEntries,SyncChange} from '../src/account-sync.ts';

const setup=`
import {Hono} from '@/node_modules/hono/dist/index.js';
import {db,now} from '@/src/db/index.ts';
import {accountSync} from '@/src/api/account-sync.ts';
const d=db(),app=new Hono();app.get('/sync',accountSync);app.post('/sync',accountSync);
for(const id of [1,2]){d.run('INSERT INTO users(id,email,created_at,last_seen_at) VALUES(?,?,?,?)',[id,'sync'+id+'@example.invalid',now(),now()]);d.run('INSERT INTO sessions VALUES(?,?,?,?,?)',['sync-'+id,id,now(),'2099-01-01',null]);}
d.run('INSERT INTO account_devices VALUES(?,?,?)',['owner_device',1,now()]);
const req=(id,changes,account=id,ref='owner_device')=>app.request('/sync?account='+account+'&legacyRef='+ref,{method:changes?'POST':'GET',headers:{cookie:'filtrsoft_session=sync-'+id,'content-type':'application/json'},...(changes?{body:JSON.stringify({changes})}:{})});
const change=(key,value,base=0,token=crypto.randomUUID())=>({key,value,base,token});
`;
test('account sync merges independent edits, rejects stale resurrection, retries idempotently',()=>isolated(setup+`
const first=change('saved:1',123);let r=await (await req(1,[first])).json();assert.equal(r.entries['saved:1'].revision,1);
r=await (await req(1,[first])).json();assert.equal(r.entries['saved:1'].revision,1);assert.deepEqual(r.accepted,[first.token]);
await req(1,[change('setting:theme','light')]);await req(1,[change('setting:compact',true)]);
r=await(await req(1,[change('saved:1',null,1)])).json();assert.equal(r.entries['saved:1'].value,null);
const stale=change('saved:1',123,1);r=await(await req(1,[stale])).json();assert.deepEqual(r.conflicts,[stale.token]);assert.equal(r.entries['saved:1'].value,null);
assert.equal(r.entries['setting:theme'].value,'light');assert.equal(r.entries['setting:compact'].value,true);
// A tombstone wins even when an older browser imports for the first time.
r=await(await req(1,[{...change('saved:1',456),importOnly:true}])).json();assert.equal(r.entries['saved:1'].value,null);
`));
test('account sync fails closed on wrong account, legacy owner, malformed input and anonymous requests',()=>isolated(setup+`
assert.equal((await app.request('/sync?account=1')).status,401);
assert.equal((await req(2,[change('saved:1',123)],1)).status,409);
assert.equal((await req(2,[{...change('saved:1',123),importOnly:true}])).status,403);
assert.equal((await req(1,[change('setting:theme','invalid')])).status,400);
assert.equal((await req(1,[change('setting:driveMinutes',999)])).status,400);
assert.equal((await req(1,[change('other:1','secret')])).status,400);
assert.equal((await req(1,[change('saved:1',123),change('saved:1',124)])).status,400);
await req(1,[change('saved:1',123)]);assert.deepEqual((await(await req(2)).json()).entries,{});
await req(2,[change('saved:2',456)]);assert.equal((await(await req(1)).json()).entries['saved:2'],undefined);
`));
test('eight-character signup succeeds through the actual API and seven is rejected',()=>isolated(`
import {app} from '@/src/api/index.ts';
const signup=password=>app.request('/v1/auth/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'eight@example.invalid',password})});
assert.equal((await signup('seven77')).status,400);
const r=await signup('eight888');assert.equal(r.status,200);assert.ok(r.headers.get('set-cookie'));assert.equal((await r.json()).user.email,'eight@example.invalid');
`));
const memory=()=>{const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};};
const reply=(entries:SyncEntries={},accepted:string[]=[],conflicts:string[]=[]):SyncReply=>({userId:1,entries,accepted,conflicts,legacyAllowed:true,at:new Date().toISOString()});
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
test('offline queue survives reload, imports only owner data and never leaks across accounts',async()=>{
  const storage=memory();storage.setItem('filtrsoft:watch','[99]');
  let fail=true,cloud:SyncEntries={};
  const send=async(changes:SyncChange[])=>{if(fail)throw Error('offline');for(const c of changes)cloud[c.key]={value:c.value,revision:1};return reply(cloud,changes.map(c=>c.token));};
  const a=new AccountSync(1,storage,send,()=>{});a.write('filtrsoft:watch','[1]');await settle();expect(a.status().pending).toBe(1);a.stop();
  const b=new AccountSync(1,storage,send,()=>{});expect(b.read('filtrsoft:watch')).toBe('[1]');fail=false;await b.flush();await settle();expect(b.status().pending).toBe(0);expect(JSON.parse(b.read('filtrsoft:watch')!)).toEqual(expect.arrayContaining([1,99]));
  const other=new AccountSync(2,storage,async()=>({...reply(),userId:2,legacyAllowed:false}),()=>{});await other.flush();expect(other.read('filtrsoft:watch')).toBe('[]');
});
test('an older acknowledgement preserves an edit made during the request',async()=>{
  const storage=memory();let finish!:(r:SyncReply)=>void;let batch:SyncChange[]=[];let n=0;
  const engine=new AccountSync(1,storage,async changes=>{batch=changes;if(n++===0)return new Promise<SyncReply>(r=>finish=r);return reply({'setting:theme':{value:changes[0].value,revision:2}},changes.map(c=>c.token));},()=>{});
  engine.write('filtrsoft:settings','{"theme":"light"}');const original=batch[0];engine.write('filtrsoft:settings','{"theme":"dark"}');
  finish(reply({'setting:theme':{value:'light',revision:1}},[original.token]));await settle();expect(engine.read('filtrsoft:settings')).toBe('{"theme":"dark"}');expect(engine.status().pending).toBe(0);
});
test('same-field conflicts retain local data until an explicit choice',async()=>{
  const engine=new AccountSync(1,memory(),async changes=>reply({'setting:theme':{value:'dark',revision:2}},[],changes.map(c=>c.token)),()=>{});
  engine.write('filtrsoft:settings','{"theme":"light"}');await settle();expect(engine.status().phase).toBe('conflict');expect(engine.read('filtrsoft:settings')).toBe('{"theme":"light"}');
  engine.resolve(false);await settle();expect(engine.read('filtrsoft:settings')).toBe('{"theme":"dark"}');expect(engine.status().pending).toBe(0);
});
test('two browser tabs preserve independent pending changes in shared local storage',async()=>{
  const storage=memory(),offline=async()=>{throw Error('offline');};
  const a=new AccountSync(1,storage,offline,()=>{}),b=new AccountSync(1,storage,offline,()=>{});
  a.write('filtrsoft:watch','[1]');await settle();b.write('filtrsoft:settings','{"compact":true}');await settle();a.restore();
  expect(a.status().pending).toBe(2);expect(a.read('filtrsoft:watch')).toBe('[1]');expect(a.read('filtrsoft:settings')).toBe('{"compact":true}');
});

test('a damaged account cache preserves valid offline edits without crashing the shell',()=>{
  const storage=memory();storage.setItem('filtrsoft:account:1',JSON.stringify({entries:{'saved:1':null,'setting:theme':{value:'light',revision:1}},pending:{'saved:2':{key:'saved:2',value:123,base:0,token:'kept'},'setting:compact':{key:'setting:theme',value:true,base:0,token:'wrong'}},imported:true,lastSync:42}));
  const engine=new AccountSync(1,storage,async()=>reply(),()=>{});
  expect(engine.read('filtrsoft:watch')).toBe('[2]');expect(engine.read('filtrsoft:settings')).toBe('{"theme":"light"}');expect(engine.status().pending).toBe(1);expect(engine.status().lastSync).toBeNull();
});

test('resolving one overlapping edit retains other conflicts for review',async()=>{
  const engine=new AccountSync(1,memory(),async changes=>reply({'setting:theme':{value:'dark',revision:2},'setting:compact':{value:false,revision:2}},[],changes.map(c=>c.token)),()=>{});
  engine.write('filtrsoft:settings','{"theme":"light","compact":true}');await settle();expect(engine.status().conflicts).toBe(2);
  engine.resolve(false,'setting:theme');await settle();expect(engine.status().conflicts).toBe(1);expect(JSON.parse(engine.read('filtrsoft:settings')!)).toEqual({theme:'dark',compact:true});
});
