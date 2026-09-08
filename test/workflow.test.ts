import {test} from "bun:test";
import {isolated} from "./isolated.ts";
test('image intake rejects oversized streams and bounds a stalled response body',()=>isolated(`
  import {fetchBytes} from '@/src/net/bounded.ts';
  let cancelled=false;
  globalThis.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(9));},cancel(){cancelled=true;}}));
  await assert.rejects(fetchBytes('https://example.invalid',{maxBytes:8,timeoutMs:100}),/byte limit/);assert.ok(cancelled);
  globalThis.fetch=async()=>new Response(new ReadableStream({start(){},cancel(){}}));
  const started=Date.now();await assert.rejects(fetchBytes('https://example.invalid',{timeoutMs:30}),/timed out/);assert.ok(Date.now()-started<1000);
  globalThis.fetch=async()=>new Response(new Uint8Array([1,2,3]));assert.deepEqual([...await fetchBytes('https://example.invalid',{maxBytes:3})],[1,2,3]);
`));
test('profile ownership refuses concurrent browsers and release cannot remove another owner',()=>isolated(`
  import {acquireProfileLease} from '@/src/browser/profile-lease.mjs';
  import {readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
  import {resolve} from 'node:path';
  const profile=resolve('profile'),lock=profile+'.filtrsoft-owner.json';
  const release=acquireProfileLease(profile);assert.throws(()=>acquireProfileLease(profile),/in use/);
  const owner=JSON.parse(readFileSync(lock,'utf8'));writeFileSync(lock,JSON.stringify({...owner,token:'replacement'}));
  release();assert.ok(existsSync(lock));unlinkSync(lock);
  const again=acquireProfileLease(profile);again();assert.equal(existsSync(lock),false);
`));
test('temporary photo cleanup preserves concurrently active workspaces',()=>isolated(`
  import {createPhotoWorkspace,releasePhotos,prunePhotos} from '@/src/photos/index.ts';
  import {existsSync,writeFileSync} from 'node:fs';
  import {join} from 'node:path';
  const first=createPhotoWorkspace(1),second=createPhotoWorkspace(1);
  assert.notEqual(first.path,second.path);
  writeFileSync(join(first.path,'p0.jpg'),'fixture');writeFileSync(join(second.path,'p0.jpg'),'fixture');
  assert.equal(prunePhotos().dirs,0);
  releasePhotos(1,first);assert.equal(existsSync(first.path),false);assert.ok(existsSync(second.path));
  releasePhotos(1,second);assert.equal(existsSync(second.path),false);
`));
test('probe failures back off and same-priority unseen listings get their turn',()=>isolated(`
  import {db} from '@/src/db/index.ts';import {upsertListingFacts} from '@/src/db/listings.ts';
  import {recordProbe,dueProbes} from '@/src/db/probes.ts';
  const d=db(),at=Date.now();
  for(let i=0;i<3;i++)upsertListingFacts(d,{source:'facebook',sourceId:String(i),url:'https://example.invalid/'+i,title:'GPU',description:'',askingPriceCents:10000,location:null,postedAt:null,photoCount:0});
  const first=dueProbes('facebook',1,at)[0].id;recordProbe(first,'unknown',at);
  const second=dueProbes('facebook',1,at)[0].id;assert.notEqual(first,second);recordProbe(second,'alive',at);
  assert.equal(dueProbes('facebook',3,at).length,1);
  assert.equal(dueProbes('facebook',3,at+16*60_000).length,2);
  assert.equal(d.query('SELECT last_seen,last_probed_at FROM listings WHERE id=?').get(first).last_probed_at,new Date(at).toISOString());
`));
test('running heartbeats survive restart state and only the owning agent completes a job',()=>isolated(`
  process.env.FILTRSOFT_PUSH_TOKEN='synthetic-fixture-only';
  import {db} from '@/src/db/index.ts';import {app} from '@/src/api/index.ts';
  import {sweepStaleJobs,agentSeenAt} from '@/src/api/jobs.ts';
  const d=db(),at=new Date().toISOString();
  d.run("INSERT INTO crawl_jobs(status,sources,created_at) VALUES('queued',?,?)",[JSON.stringify(['facebook']),at]);
  const headers={authorization:'Bearer synthetic-fixture-only','x-filtrsoft-agent':'owner','content-type':'application/json'};
  const response=await app.request('/v1/jobs/next',{headers});assert.equal(response.status,200);
  const {job}=await response.json();assert.ok(job);
  d.run("UPDATE crawl_jobs SET started_at='2000-01-01T00:00:00.000Z' WHERE id=?",[job.id]);
  const update=body=>app.request('/v1/jobs/'+job.id,{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal((await update({progress:'facebook/detail',stage:{name:'facebook/detail',status:'running'}})).status,200);
  sweepStaleJobs();assert.equal(d.query('SELECT status FROM crawl_jobs WHERE id=?').get(job.id).status,'running');
  assert.ok(agentSeenAt());
  d.run("UPDATE agent_presence SET seen_at='2026-09-01T00:00:00.000Z'");assert.equal(agentSeenAt(),'2026-09-01T00:00:00.000Z');
  assert.equal((await app.request('/v1/jobs/'+job.id,{method:'POST',headers:{...headers,'x-filtrsoft-agent':'other'},body:JSON.stringify({status:'done'})})).status,409);
  assert.equal((await update({stage:{name:'facebook/detail',status:'done'},status:'done',result:{facebook:'ok'}})).status,200);
  assert.equal(d.query('SELECT status FROM crawl_job_stages').get().status,'done');
  assert.equal((await update({status:'done',result:{facebook:'ok'}})).status,200);
  assert.equal((await update({status:'running'})).status,409);
`));
test('undated stale listings and thumbnails share the same observation-based expiry',()=>isolated(`
  import {db} from '@/src/db/index.ts';import {app} from '@/src/api/index.ts';
  import {upsertListingFacts} from '@/src/db/listings.ts';import {putThumb,pruneThumbs} from '@/src/photos/thumb.ts';
  const d=db(),at=new Date().toISOString(),old=new Date(Date.now()-40*86_400_000).toISOString();
  d.run('INSERT INTO users(id,email,created_at,last_seen_at) VALUES(1,?,?,?)',['audit@example.invalid',at,at]);
  d.run('INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,1,?,?)',['fixture',at,'2099-01-01T00:00:00.000Z']);
  for(let i=0;i<2;i++) {
    const id=upsertListingFacts(d,{source:'facebook',sourceId:String(i),url:'https://example.invalid/'+i,title:'Unknown tech',description:'',askingPriceCents:10000,location:null,postedAt:null,photoCount:0},i===0?old:at).id;
    d.run("INSERT INTO verdicts(listing_id,engine_version,call,payload,created_at) VALUES(?,'audit','INSUFFICIENT_DATA',?,?)",[id,JSON.stringify({call:'INSUFFICIENT_DATA',headline:'Unknown',confidence:'low'}),at]);
    putThumb(id,'https://example.invalid/'+i,{bytes:new Uint8Array([1]),mime:'image/webp',width:1,height:1});
  }
  pruneThumbs();assert.equal(d.query('SELECT COUNT(*) n FROM listing_thumbs').get().n,1);
  const response=await app.request('/v1/feed?quality=all',{headers:{cookie:'filtrsoft_session=fixture'}});
  assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.items.length,1);assert.equal(body.items[0].postedAt,null);
`));
test('agent completion reports survive transient transport failure without storing authorization',()=>isolated(`
  import {db} from '@/src/db/index.ts';import {queueJobReport,flushJobReports} from '@/src/agent/reports.ts';
  const d=db(),api='https://example.invalid';let calls=0;
  queueJobReport(d,api,'fixture-agent',1,{status:'done',result:{facebook:'ok'}});
  globalThis.fetch=async()=>{calls++;return new Response('{}',{status:503});};
  assert.equal(await flushJobReports(d,api,'Bearer fixture-secret'),0);
  assert.equal(d.query('SELECT status FROM agent_reports').get().status,'pending');
  assert.equal(JSON.stringify(d.query('SELECT * FROM agent_reports').all()).includes('fixture-secret'),false);
  globalThis.fetch=async(url,opts)=>{calls++;assert.equal(opts.headers['x-filtrsoft-agent'],'fixture-agent');return new Response('{}');};
  assert.equal(await flushJobReports(d,api,'Bearer fixture-secret'),1);
  assert.equal(await flushJobReports(d,api,'Bearer fixture-secret'),0);assert.equal(calls,2);
`));
