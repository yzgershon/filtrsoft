import {test} from 'bun:test';
import {isolated} from './isolated.ts';
test('off-host stream has one snapshot, preserved rowids/blobs/integers, triggers and verified restoration',()=>isolated(`
 import {Database} from 'bun:sqlite';import {snapshotRecords,restoreSnapshot} from '@/src/db/offhost-backup.ts';
 const d=new Database('source.db');d.exec("PRAGMA journal_mode=WAL; CREATE TABLE items(id INTEGER PRIMARY KEY AUTOINCREMENT,value TEXT,n INTEGER,b BLOB); CREATE TABLE logs(value TEXT); CREATE TRIGGER item_log AFTER INSERT ON items BEGIN INSERT INTO logs VALUES(new.value); END;");
 d.run('INSERT INTO items VALUES(?,?,?,?)',[7,'label\\u2028retained',9007199254740993n,new Uint8Array([0,255])]);
 const records=[];for await(const chunk of snapshotRecords('source.db',{free:()=>100000000})){records.push(chunk.toString());if(records.length===1)d.run('INSERT INTO items(value) VALUES(?)',['arrived later']);}
 async function* lines(){for(const line of records)yield line.slice(0,-1);}
 const result=await restoreSnapshot(lines(),'restored.db');assert.equal(result.restoreVerified,true);
 const r=new Database('restored.db');assert.equal(r.query('SELECT COUNT(*) n FROM items').get().n,1);
 assert.equal(r.query('SELECT n FROM items').safeIntegers(true).get().n,9007199254740993n);assert.deepEqual([...r.query('SELECT b FROM items').get().b],[0,255]);
 assert.equal(r.query('SELECT value FROM items').get().value,'label\\u2028retained');r.run("INSERT INTO items(value) VALUES('new')");assert.equal(r.query('SELECT MAX(id) n FROM items').get().n,8);assert.equal(r.query('SELECT COUNT(*) n FROM logs').get().n,2);
 assert.equal(d.query('SELECT COUNT(*) n FROM items').get().n,2);r.close();d.close();
`));
test('headroom/cancellation and missing or corrupt footers fail closed without publishing a restored database',()=>isolated(`
 import {Database} from 'bun:sqlite';import {existsSync} from 'node:fs';import {snapshotRecords,restoreSnapshot} from '@/src/db/offhost-backup.ts';
 const d=new Database('source.db');d.exec('CREATE TABLE items(id INTEGER)');d.close();
 await assert.rejects(async()=>{for await(const c of snapshotRecords('source.db',{free:()=>1})){}},/physical storage/);
 const rows=[];for await(const c of snapshotRecords('source.db',{free:()=>100000000}))rows.push(c.toString().slice(0,-1));
 async function* missing(){yield* rows.slice(0,-1);}await assert.rejects(()=>restoreSnapshot(missing(),'missing.db'),/Incomplete/);assert.equal(existsSync('missing.db'),false);
 async function* corrupt(){yield* rows.map((r,i)=>i===0?r.replace('items','wrong'):r);}await assert.rejects(()=>restoreSnapshot(corrupt(),'corrupt.db'));assert.equal(existsSync('corrupt.db'),false);
`));
test('production full backup requires an owner session, never just the collector upload token',()=>isolated(`
 process.env.FILTRSOFT_PUSH_TOKEN='fixture-collector-token';process.env.FILTRSOFT_OWNER_REF='owner-device-fixture';
 import {app} from '@/src/api/index.ts';
 const r=await app.request('/v1/owner/backup',{headers:{authorization:'Bearer fixture-collector-token'}});assert.equal(r.status,401);
 import {db,now} from '@/src/db/index.ts';const d=db();d.run("INSERT INTO users(id,email,created_at,last_seen_at) VALUES(1,'fixture@example.invalid',?,?)",[now(),now()]);d.run("INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES('fixture-session',1,?,'2099-01-01')",[now()]);
 const headers={cookie:'filtrsoft_session=fixture-session'};
 for(const path of ['/v1/owner/backup','/v1/owner/recovery-snapshot?ids=1'])assert.equal((await app.request(path,{headers})).status,403);
 d.run('INSERT INTO account_devices(device_ref,user_id,created_at) VALUES(?,1,?)',[process.env.FILTRSOFT_OWNER_REF,now()]);
 assert.equal((await app.request('/v1/owner/backup',{headers:{...headers,'sec-fetch-site':'cross-site'}})).status,403);
 const snapshot=await app.request('/v1/owner/recovery-snapshot?ids=1',{headers});assert.equal(snapshot.status,200);assert.equal((await snapshot.json()).items.length,1);
 assert.equal((await app.request('/v1/owner/recovery-snapshot?ids=1 OR 1=1',{headers})).status,400);
`));
