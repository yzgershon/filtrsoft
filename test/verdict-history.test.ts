import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {compactVerdictBatch,encodeVerdictPayload,decodeVerdictPayload} from '../src/db/verdict-history.ts';
import {isolated} from './isolated.ts';
test('historical compression preserves exact bytes, row identity and latest payloads',()=>{
  const d=new Database(':memory:');d.exec('CREATE TABLE verdicts(id INTEGER PRIMARY KEY,listing_id INTEGER,payload TEXT,created_at TEXT); CREATE INDEX history_listing ON verdicts(listing_id,id)');
  const original=JSON.stringify({call:'VERIFY',quote:'Seller’s exact words × 2 😀 '.repeat(150),provenance:{dataRevision:'original'}});
  for(let id=1;id<=20;id++)d.run('INSERT INTO verdicts VALUES(?,?,?,?)',[id,id%2,original,'2026-09-01']);
  const before=d.query('SELECT * FROM verdicts ORDER BY id').all() as Array<{id:number;listing_id:number;payload:string;created_at:string}>;
  expect(compactVerdictBatch(d).changed).toBe(18);expect(d.query('SELECT * FROM verdicts ORDER BY id').all()).toEqual(before);
  const result=compactVerdictBatch(d,{apply:true});expect(result.changed).toBe(18);expect(result.savedBytes).toBeGreaterThan(10000);
  const after=d.query('SELECT * FROM verdicts ORDER BY id').all() as typeof before;
  expect(after.map(r=>({...r,payload:decodeVerdictPayload(r.payload)}))).toEqual(before);
  expect(after.slice(-2).map(r=>r.payload)).toEqual([original,original]);expect(compactVerdictBatch(d,{apply:true}).changed).toBe(0);
  const packed=encodeVerdictPayload(original),bad=JSON.parse(packed);bad.sha256='wrong';expect(()=>decodeVerdictPayload(JSON.stringify(bad))).toThrow('checksum');
  expect(encodeVerdictPayload('tiny')).toBe('tiny');
  expect(compactVerdictBatch(d,{apply:true,restore:true}).changed).toBe(18);
  expect(d.query('SELECT * FROM verdicts ORDER BY id').all()).toEqual(before);
  d.exec("CREATE TRIGGER reject_second BEFORE UPDATE ON verdicts WHEN OLD.id=2 BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  expect(()=>compactVerdictBatch(d,{apply:true})).toThrow('fixture failure');
  expect(d.query('SELECT * FROM verdicts ORDER BY id').all()).toEqual(before);d.close();
});
test('historical personal decisions still resolve the original archived JSON',()=>isolated(`
  import {db} from '@/src/db/index.ts';import {decisionAt} from '@/src/db/learning.ts';import {compactVerdictBatch} from '@/src/db/verdict-history.ts';
  const d=db();d.run("INSERT INTO listings(id,source,source_id,url,title,captured_at) VALUES(1,'craigslist','1','https://example.invalid','test','2026-09-01')");
  const first=JSON.stringify({call:'VERIFY',quote:'original exact evidence '.repeat(200)});
  d.run("INSERT INTO verdicts(id,listing_id,engine_version,call,confidence,payload,created_at) VALUES(1,1,'one','VERIFY','low',?,'2026-09-01')",[first]);
  d.run("INSERT INTO verdicts(id,listing_id,engine_version,call,confidence,payload,created_at) VALUES(2,1,'two','PASS','low','{}','2026-09-03')");
  compactVerdictBatch(d,{apply:true});assert.deepEqual(decisionAt(1,null,undefined,'2026-09-02'),{id:1,payload:first});
`));

test('batched WAL recovery frees reusable pages while preserving every historical record',()=>isolated(`
  import {db} from '@/src/db/index.ts';import {compactVerdictBatch,decodeVerdictPayload} from '@/src/db/verdict-history.ts';
  const d=db();d.run("INSERT INTO listings(id,source,source_id,url,title,captured_at) VALUES(1,'craigslist','1','https://example.invalid','test','2026-09-01')");
  const payload=JSON.stringify({quote:'exact seller evidence '.repeat(250)});
  d.transaction(()=>{for(let id=1;id<=1000;id++)d.run("INSERT INTO verdicts(id,listing_id,engine_version,call,payload,created_at) VALUES(?,1,'one','VERIFY',?,'2026-09-01')",[id,payload]);})();
  d.exec('PRAGMA wal_checkpoint(TRUNCATE)');const before=d.query('PRAGMA freelist_count').get().freelist_count;
  let after=0;while(true){const r=compactVerdictBatch(d,{after,apply:true});after=r.next;assert.equal(d.query('PRAGMA wal_checkpoint(TRUNCATE)').get().busy,0);if(r.done)break;}
  assert.ok(d.query('PRAGMA freelist_count').get().freelist_count>before+500);
  const rows=d.query('SELECT id,payload FROM verdicts ORDER BY id').all();assert.equal(rows.length,1000);
  for(let i=0;i<rows.length;i++){assert.equal(rows[i].id,i+1);assert.equal(decodeVerdictPayload(rows[i].payload),payload);}
  assert.equal(rows.at(-1).payload,payload);assert.equal(d.query('PRAGMA quick_check').get().quick_check,'ok');
`));

test('maintenance CLI opens an existing database for dry-run, application and rollback',()=>isolated(`
  import {db} from '@/src/db/index.ts';import {fileURLToPath} from 'node:url';
  const d=db();d.run("INSERT INTO listings(id,source,source_id,url,title,captured_at) VALUES(1,'craigslist','1','https://example.invalid','test','2026-09-01')");
  const payload=JSON.stringify({quote:'exact evidence '.repeat(200)});
  for(let id=1;id<=2;id++)d.run("INSERT INTO verdicts(id,listing_id,engine_version,call,payload,created_at) VALUES(?,1,'one','VERIFY',?,'2026-09-01')",[id,payload]);
  const path=fileURLToPath(new URL('src/scripts/compact-verdict-history.ts',${JSON.stringify(new URL('../',import.meta.url).href)}));
  for(const args of [[],['--apply'],['--restore','--apply']]){
    const result=Bun.spawnSync({cmd:[process.execPath,'run',path,'--db='+process.env.FILTRSOFT_DB,'--batches=1',...args],stdout:'pipe',stderr:'pipe'});
    assert.equal(result.exitCode,0,new TextDecoder().decode(result.stderr));
    const rows=d.query('SELECT payload FROM verdicts ORDER BY id').all();assert.equal(rows[1].payload,payload);
    if(args.length===1)assert.notEqual(rows[0].payload,payload);else assert.equal(rows[0].payload,payload);
  }
`));
