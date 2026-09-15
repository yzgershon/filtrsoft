import {test,expect} from 'bun:test';
import {isolated} from './isolated.ts';
import {collect,collectionPlan,SOURCES,QUERIES} from '../src/agent/collection.ts';
import {runCommand} from '../src/agent/process.ts';
import {workerEvents} from '../src/agent/worker.ts';

test('virtualized Mercari viewports preserve the first GPU and update repeated cards without losing photos',()=>isolated(`
  import {rememberCards} from '@/src/browser/card-snapshots.mjs';import {parseCards} from '@/src/sources/marketplace.ts';
  import {resolveProductType} from '@/src/signals/product-type.ts';
  const first={href:'/us/item/m123456789/',text:'GeForce GTX 1060 6GB Graphics Card\\n$65.00',photo:'https://example.invalid/gpu.jpg'};
  const second={href:'/us/item/m987654321/',text:'GIGABYTE GeForce RTX 3050 WINDFORCE OC 6G GPU\\n$199.00'};
  const observed=new Map();rememberCards(observed,[first]);rememberCards(observed,[second]);rememberCards(observed,[{...second,text:second.text.replace('199','189')},{...first,photo:''}]);
  const cards=parseCards('mercari',[...observed.values()]);assert.equal(cards.length,2);assert.equal(cards[0].photoUrl,first.photo);
  assert.equal(cards[1].priceCents,18900);assert.ok(cards.every(c=>resolveProductType(c.title).kind==='tech'));
`));

test('worker drains a full stderr pipe and retains final UTF-8 JSON without newline',async()=>{
  const code=`process.stderr.write('x'.repeat(200000)); process.stdout.write(JSON.stringify({type:'done',stats:{text:'café'}}));`;
  const events=[];for await(const event of workerEvents(['--eval',code],{executable:process.execPath,timeoutMs:3000}))events.push(event);
  expect(events).toEqual([{type:'done',stats:{text:'café'}}]);
});
test('clean worker exit without completion is a failure and hangs are bounded',async()=>{
  const collect=async(code:string,timeoutMs=3000)=>{const events=[];for await(const e of workerEvents(['--eval',code],{executable:process.execPath,timeoutMs}))events.push(e);return events;};
  expect((await collect("process.stdout.write(JSON.stringify({type:'cards',cards:[]}))")).at(-1)?.type).toBe('error');
  const at=Date.now();expect((await collect('setInterval(()=>{},1000)',300)).at(-1)?.type).toBe('error');expect(Date.now()-at).toBeLessThan(3000);
});
test('command timeout cannot become success and stderr stays bounded',async()=>{
  const noisy=await runCommand(process.execPath,['--eval',"process.stderr.write('x'.repeat(100000));"],{timeoutMs:3000});
  expect(noisy.ok).toBe(true);expect(noisy.tail.length).toBeLessThanOrEqual(12000);
  const hung=await runCommand(process.execPath,['--eval','setInterval(()=>{},1000)'],{timeoutMs:300});
  expect(hung.ok).toBe(false);expect(hung.timedOut).toBe(true);
});
test('search rotation covers every category and never runs a full source before another gets a turn',()=>{
  const first=collectionPlan([...SOURCES],0).filter(s=>s.kind==='crawl');
  expect(first.slice(0,3).map(s=>s.source)).toEqual([...SOURCES]);
  const seen=new Set([0,2,4].flatMap(cursor=>collectionPlan(['facebook'],cursor).filter(s=>s.kind==='crawl').map(s=>s.args[3])));
  expect(seen).toEqual(new Set(QUERIES));
});
test('failed crawl checkpoints partial facts, skips more visits to that source, and serves others',async()=>{
  const ran:string[]=[];
  const summary=await collect([...SOURCES],{cursor:0,paused:()=>false,stage:async()=>{},run:async s=>{
    ran.push(s.name);return {ok:!(s.source==='facebook'&&s.kind==='crawl'),tail:'challenge',timedOut:false,cancelled:false};}});
  const failed=ran.indexOf('facebook/search-graphics-card');
  expect(ran[failed+1]).toBe('facebook/search-graphics-card-sync');
  expect(ran).not.toContain('facebook/search-gaming-pc');expect(ran).toContain('mercari/details');
  expect(summary.facebook).toContain('challenge');expect(summary.offerup).toBe('ok');
});
test('pause stops new browser stages while checkpointing the interrupted one',async()=>{
  let paused=false;const ran:string[]=[];
  const summary=await collect(['facebook','offerup'],{cursor:0,paused:()=>paused,stage:async()=>{},run:async s=>{
    ran.push(s.name);if(s.kind==='crawl')paused=true;return {ok:true,tail:'',timedOut:false,cancelled:false};}});
  expect(ran.at(-1)).toBe('facebook/search-graphics-card-sync');expect(ran).not.toContain('offerup/search-graphics-card');
  expect(summary.offerup).toContain('paused');
});
test('collector diagnostics require machine auth, do not claim jobs, and keep version after heartbeat',()=>isolated(`
  process.env.FILTRSOFT_PUSH_TOKEN='fixture';
  import {app} from '@/src/api/index.ts';import {db} from '@/src/db/index.ts';
  const d=db(),at=new Date().toISOString();
  d.run("INSERT INTO crawl_jobs(status,sources,created_at) VALUES('queued','[\\"facebook\\"]',?)",[at]);
  assert.equal((await app.request('/v1/jobs/diagnostics')).status,401);
  const headers={authorization:'Bearer fixture','x-filtrsoft-agent':'test','x-filtrsoft-agent-version':'abc123'};
  const diag=await app.request('/v1/jobs/diagnostics',{headers});assert.equal(diag.status,200);
  const body=await diag.json();assert.ok(Array.isArray(body.arrivals));assert.equal(d.query('SELECT status FROM crawl_jobs').get().status,'queued');
  assert.equal(d.query('SELECT COUNT(*) n FROM agent_presence').get().n,0);
  const {job}=await (await app.request('/v1/jobs/next',{headers})).json();
  await app.request('/v1/jobs/'+job.id,{method:'POST',headers:{authorization:'Bearer fixture','x-filtrsoft-agent':'test','content-type':'application/json'},body:JSON.stringify({progress:'working'})});
  assert.equal(d.query('SELECT revision FROM agent_versions').get().revision,'abc123');
  assert.equal((await app.request('/v1/jobs/latest',{headers})).status,401);
`));

test('managed supervisor starts the configured runtime once and stops only its own child',()=>isolated(`
  import {spawn} from 'node:child_process';import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';import {resolve,join} from 'node:path';
  import {fileURLToPath} from 'node:url';
  import {killChildTree} from '@/src/agent/process.ts';
  const root=resolve('runtime with spaces'),state=resolve('runner state');mkdirSync(join(root,'src/scripts'),{recursive:true});mkdirSync(state);
  writeFileSync(join(root,'src/scripts/agent.ts'),"import {writeFileSync} from 'node:fs';writeFileSync(process.env.FILTRSOFT_AGENT_STATE+'/child.json',JSON.stringify({pid:process.pid,db:process.env.FILTRSOFT_DB,vision:process.env.FILTRSOFT_AGENT_VISION_LIMIT,fixture:process.env.FILTRSOFT_FIXTURE}));setInterval(()=>{},1000);");
  writeFileSync(resolve('fixture.env'),'FILTRSOFT_FIXTURE=loaded-by-bun');
  const config=resolve('config.json');writeFileSync(config,JSON.stringify({root,state,bun:process.execPath,node:process.execPath,envFile:resolve('fixture.env'),database:resolve('fixture.db')}));
  const supervisor=fileURLToPath(new URL('@/src/agent/supervisor.mjs'.replace('@/',${JSON.stringify(new URL('../',import.meta.url).href)})));
  const launch=()=>spawn(process.execPath,[supervisor,config],{stdio:'ignore',windowsHide:true,detached:process.platform!=='win32'});
  const first=launch();const exited=new Promise(r=>first.once('exit',r));
  try {
    const deadline=Date.now()+10000;while(!existsSync(join(state,'child.json'))&&Date.now()<deadline)await Bun.sleep(40);
    const child=JSON.parse(readFileSync(join(state,'child.json'),'utf8'));assert.equal(child.db,resolve('fixture.db'));assert.equal(child.vision,'0');assert.equal(child.fixture,'loaded-by-bun');
    const duplicate=launch();assert.equal(await new Promise(r=>duplicate.once('exit',r)),0);process.kill(child.pid,0);
    writeFileSync(join(state,'stop'),'');await Promise.race([exited,Bun.sleep(5000).then(()=>{throw new Error('supervisor did not stop');})]);
    assert.throws(()=>process.kill(child.pid,0));
  } finally {killChildTree(first);}
`),20000);
