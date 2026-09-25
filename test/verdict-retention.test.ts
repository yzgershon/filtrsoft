import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {pruneVerdictHistoryBatch,HISTORY_RETENTION_DAYS} from '../src/db/verdict-history.ts';

// Approved by Yish on 2026-09-25: history older than 14 days goes, except the
// current verdict of every listing and any row a decision record names.
test('verdict history retention keeps current, recent and referenced rows and deletes the rest in bounded steps',()=>{
  const d=new Database(':memory:'),now=Date.parse('2026-09-25T00:00:00Z'),day=86400000;
  d.exec(`CREATE TABLE verdicts(id INTEGER PRIMARY KEY,listing_id INTEGER,engine_version TEXT,call TEXT,confidence TEXT,payload TEXT,created_at TEXT);
    CREATE TABLE verdict_overrides(device_ref TEXT,listing_id INTEGER,decision_id INTEGER);
    CREATE TABLE decision_views(token TEXT,decision_id INTEGER);`);
  const add=(listing:number,ageDays:number)=>Number(d.run("INSERT INTO verdicts(listing_id,engine_version,call,payload,created_at) VALUES(?,'t','PASS','{}',?)",[listing,new Date(now-ageDays*day).toISOString()]).lastInsertRowid);
  const oldA=[add(1,40),add(1,30),add(1,20)],labelled=add(1,19),viewed=add(1,18),recentA=add(1,3),currentA=add(1,1);
  const onlyOld=add(2,60); // the only (current) verdict of a quiet listing
  const oldB=[add(3,50),add(3,16)],currentB=add(3,15);
  d.run('INSERT INTO verdict_overrides VALUES(?,?,?)',['device',1,labelled]);d.run('INSERT INTO decision_views VALUES(?,?)',['token',viewed]);
  let after=0,total=0,steps=0;
  for(;;){const r=pruneVerdictHistoryBatch(d,{after,limit:2,now});total+=r.deleted;after=r.next;steps++;if(r.done)break;}
  const left=new Set((d.query('SELECT id FROM verdicts').all() as {id:number}[]).map(r=>r.id));
  expect([...oldA,...oldB].every(id=>!left.has(id))).toBe(true);
  expect([labelled,viewed,recentA,currentA,onlyOld,currentB].every(id=>left.has(id))).toBe(true);
  expect(total).toBe(5);expect(steps).toBeGreaterThan(1);
  // Nothing inside the retention window is ever deleted.
  expect(HISTORY_RETENTION_DAYS).toBe(14);
  expect(pruneVerdictHistoryBatch(d,{now}).deleted).toBe(0);
});
