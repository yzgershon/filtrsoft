import {describe,test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setCap,changeCap,reserve,settle,markUncertain,release,committedMicros,spendSummary,BudgetRefused} from '../src/ai/spend-cap.ts';

const meta={provider:'openai',model:'gpt-6-luna',purpose:'test'};
const fresh=(cap=1_000,window:'total'|'utc-day'='total')=>{const d=new Database(':memory:');setCap(d,'s',cap,window,'fixture approval');return d;};

describe('hard spend cap',()=>{
 test('refuses a reservation that would exceed the cap, before any call',()=>{
  const d=fresh(1_000);
  reserve(d,'s',600,meta);
  expect(()=>reserve(d,'s',401,meta)).toThrow(BudgetRefused);
  expect(reserve(d,'s',400,meta).reservedMicros).toBe(400);
  expect(committedMicros(d,'s')).toBe(1_000);
 });
 test('settling releases the unused part of a reservation',()=>{
  const d=fresh(1_000),r=reserve(d,'s',900,meta);
  expect(settle(d,r.id,120).overrun).toBe(false);
  expect(committedMicros(d,'s')).toBe(120);
  expect(reserve(d,'s',880,meta).reservedMicros).toBe(880);
 });
 test('an uncertain charge keeps its whole reservation',()=>{
  const d=fresh(1_000),r=reserve(d,'s',700,meta);
  markUncertain(d,r.id,'socket closed after send');
  expect(committedMicros(d,'s')).toBe(700);
  expect(()=>reserve(d,'s',301,meta)).toThrow(BudgetRefused);
 });
 test('release is only for requests never sent and frees the amount',()=>{
  const d=fresh(1_000),r=reserve(d,'s',700,meta);release(d,r.id,'validation failed before send');
  expect(committedMicros(d,'s')).toBe(0);
 });
 test('an overrun is recorded truthfully and reported',()=>{
  const d=fresh(1_000),r=reserve(d,'s',100,meta);
  expect(settle(d,r.id,150).overrun).toBe(true);
  expect(committedMicros(d,'s')).toBe(150);
  expect(()=>settle(d,r.id,10)).toThrow(/already settled/);
 });
 test('no cap means no paid call; caps change only with a recorded approval',()=>{
  const d=new Database(':memory:');
  setCap(d,'other',5,'total','fixture');
  expect(()=>reserve(d,'missing',1,meta)).toThrow(/no approved cap/);
  expect(()=>setCap(d,'other',6,'total','fixture')).toThrow(/changeCap/);
  expect(()=>setCap(d,'x',1,'total','  ')).toThrow(/approved/);
  changeCap(d,'other',6,'second approval');
  expect(spendSummary(d,'other').capMicros).toBe(6);
 });
 test('daily window only counts the current UTC day',()=>{
  const d=fresh(1_000,'utc-day');
  reserve(d,'s',900,meta,'2026-09-21T23:59:00.000Z');
  expect(committedMicros(d,'s','2026-09-22T00:01:00.000Z')).toBe(0);
  expect(reserve(d,'s',900,meta,'2026-09-22T00:01:00.000Z').reservedMicros).toBe(900);
 });
 test('separate processes racing on one file never exceed the cap',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'spend-cap-'));
  try{
   const file=join(dir,'ledger.sqlite');
   const d=new Database(file);d.run('PRAGMA journal_mode=WAL');setCap(d,'race',10_000,'total','fixture');d.close();
   const worker=join(dir,'worker.ts'),mod=resolve(import.meta.dir,'../src/ai/spend-cap.ts').replaceAll('\\','/');
   writeFileSync(worker,`import {Database} from 'bun:sqlite';import {reserve,BudgetRefused} from '${mod}';
const d=new Database(process.argv[2]);d.run('PRAGMA busy_timeout=10000');let ok=0,refused=0;
for(let i=0;i<40;i++){try{reserve(d,'race',300,{provider:'p',model:'m',purpose:'race'});ok++;}catch(e){if(e instanceof BudgetRefused)refused++;else throw e;}}
console.log(JSON.stringify({ok,refused}));`);
   const procs=Array.from({length:4},()=>Bun.spawn([process.execPath,worker,file],{stdout:'pipe',stderr:'pipe'}));
   const outs=await Promise.all(procs.map(async p=>{await p.exited;return JSON.parse(await new Response(p.stdout).text());}));
   const ok=outs.reduce((n,o)=>n+o.ok,0);
   expect(ok).toBe(33); // floor(10000/300)
   const check=new Database(file);expect(committedMicros(check,'race')).toBe(9_900);check.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
 },30_000);
});
