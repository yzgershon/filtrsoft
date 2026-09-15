import {test} from 'bun:test';
import {isolated} from './isolated.ts';

test('collection telemetry stays private and an online heartbeat cannot invent a successful search',()=>isolated(`
  process.env.FILTRSOFT_PUSH_TOKEN='fixture';process.env.FILTRSOFT_OWNER_REF='owner-device';
  import {app} from '@/src/api/index.ts';import {db,now} from '@/src/db/index.ts';
  const d=db();for(const id of [1,2]){d.run('INSERT INTO users(id,email,created_at,last_seen_at) VALUES(?,?,?,?)',[id,id+'@example.invalid',now(),now()]);d.run('INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)',['fixture-'+id,id,now(),'2099-01-01']);}
  d.run('INSERT INTO account_devices VALUES(?,?,?)',['owner-device',1,now()]);
  const body={nodeId:'00000000-0000-4000-8000-000000000001',label:'Desktop',revision:'fixture',status:'online',jobId:null,pending:{facebook:2}};
  const send=(headers)=>app.request('/v1/collector/heartbeat',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await send({})).status,401);assert.equal((await send({authorization:'Bearer fixture'})).status,200);
  assert.equal((await app.request('/v1/collection/health')).status,401);
  const other=await (await app.request('/v1/collection/health',{headers:{cookie:'filtrsoft_session=fixture-2'}})).json();assert.deepEqual(other,{allowed:false});
  const owner=await (await app.request('/v1/collection/health',{headers:{cookie:'filtrsoft_session=fixture-1'}})).json();
  assert.equal(owner.nodes[0].online,true);assert.equal(owner.nodes[0].pending.facebook,2);assert.ok(owner.sources.every(s=>s.status==='stale'&&s.lastSuccessAt===null));
  assert.equal((await app.request('/v1/jobs/diagnostics')).status,401);
  const diagnostic=await (await app.request('/v1/jobs/diagnostics',{headers:{authorization:'Bearer fixture'}})).json();
  assert.equal(diagnostic.collection.agentOnline,true);
  assert.equal(diagnostic.health.nodes[0].label,'Desktop');assert.ok(!JSON.stringify(diagnostic).includes('example.invalid'));
  d.run("UPDATE agent_presence SET seen_at='2000-01-01'");body.status='paused';await send({authorization:'Bearer fixture'});
  const paused=await (await app.request('/v1/jobs/diagnostics',{headers:{authorization:'Bearer fixture'}})).json();assert.equal(paused.collection.agentOnline,false);assert.equal(paused.health.nodes[0].status,'paused');
`));

test('source health keeps failed uploads visible until upload recovery and treats old working stages as stale',()=>isolated(`
  import {db} from '@/src/db/index.ts';import {collectionHealth} from '@/src/api/collection-health.ts';
  const d=db(),at=Date.parse('2026-09-15T12:00:00Z');const time=(ago)=>new Date(at-ago).toISOString();
  d.run("INSERT INTO crawl_jobs(id,status,sources,created_at,heartbeat_at) VALUES(1,'running','[]',?,?)",[time(300000),time(1000)]);
  const stage=(name,status,ago,error=null)=>d.run('INSERT INTO crawl_job_stages VALUES(?,?,?,?,?,?)',[1,name,status,time(ago),status==='running'?null:time(ago),error]);
  stage('facebook/search-gpu','done',100000);stage('facebook/search-gpu-sync','failed',90000,'push failed: secret seller text');stage('facebook/search-pc','done',80000);
  let facebook=collectionHealth(at).sources[0];assert.equal(facebook.status,'attention');assert.equal(facebook.issue,'Upload needs retry');assert.ok(!JSON.stringify(facebook).includes('secret seller'));
  stage('facebook/search-pc-sync','done',70000);assert.equal(collectionHealth(at).sources[0].status,'healthy');
  stage('offerup/search-gpu','running',60000);assert.equal(collectionHealth(at).sources[1].status,'working');
  assert.equal(collectionHealth(at+4*3600000).sources[1].status,'stale');assert.equal(collectionHealth(at+4*3600000).sources[0].status,'stale');
`));

test('completion report survives network interruption and retries without changing its job owner',()=>isolated(`
  import {db} from '@/src/db/index.ts';import {queueJobReport,flushJobReports} from '@/src/agent/reports.ts';
  const d=db(),api='https://fixture.invalid';queueJobReport(d,api,'run-before-sleep',42,{status:'done',result:{facebook:'ok'}});
  globalThis.fetch=async()=>{throw new Error('connection lost');};assert.equal(await flushJobReports(d,api,'Bearer fixture'),0);
  assert.equal(d.query('SELECT status FROM agent_reports').get().status,'pending');
  let sends=0;globalThis.fetch=async(url,init)=>{sends++;assert.equal(init.headers['x-filtrsoft-agent'],'run-before-sleep');return new Response('{}');};
  assert.equal(await flushJobReports(d,api,'Bearer fixture'),1);assert.equal(await flushJobReports(d,api,'Bearer fixture'),0);assert.equal(sends,1);
`));
