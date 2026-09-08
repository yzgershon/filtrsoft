import {test} from "bun:test";
import {isolated} from "./isolated.ts";
const fixture=`
  import {db,insertComp} from '@/src/db/index.ts';
  import {checkFetched,checkStored} from '@/src/engine/index.ts';
  import {getEconomics} from '@/src/valuation/index.ts';
  import {app} from '@/src/api/index.ts';
  const d=db(),at=new Date(Date.now()-86400000).toISOString();
  d.run("INSERT INTO skus(category,brand,model,attributes,created_at) VALUES('gpu','Nvidia','RTX 4090','{}',?)",[at]);
  for(let i=0;i<4;i++)insertComp({source:'ebay',source_item_id:String(i),raw_title:'Nvidia RTX 4090 24GB',sold_price_cents:100000+i*1000,
    sold_at:at,sku_id:1,condition_norm:'used',raw:{soldAt:at}});
  const listing={source:'audit',sourceId:'one',url:'https://example.invalid/one',title:'Nvidia RTX 4090',description:'RTX 4090 graphics card',
    askingPriceCents:80000,location:null,postedAt:null,updatedAt:null,photoUrls:[],attributes:{},raw:{}};
  globalThis.fetch=async()=>{throw new Error('network forbidden');};
  d.run('INSERT INTO users(id,email,created_at,last_seen_at) VALUES(1,?,?,?)',['fixture@example.invalid',at,at]);
  d.run('INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,1,?,?)',['fixture',at,'2099-01-01T00:00:00.000Z']);
  const request=(path,method='GET',body=undefined)=>app.request(path,{method,headers:{cookie:'filtrsoft_session=fixture','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
`;
test('a persisted decision keeps its exact comp observations after the database changes',()=>isolated(fixture+`
  const r=await checkFetched(listing,{persist:true,vision:false});
  const proof=r.verdict.provenance,ev=r.verdict.valuation.evidence;
  assert.equal(proof.economics.scope,'canonical');assert.equal(ev.length,4);
  assert.equal(ev[0].observedTotalCents,100000);assert.equal(ev[0].adjustedTotalCents,100000);
  d.run('UPDATE comps SET sold_price_cents=200000');
  const saved=await (await request('/v1/checks/'+r.listingId)).json();
  assert.equal(saved.verdict.valuation.medianCents,r.verdict.valuation.medianCents);
  assert.deepEqual(saved.comps.map(c=>c.id),ev.map(c=>c.id));
  assert.equal(saved.comps[0].total,100000);
  assert.equal(saved.verdict.provenance.dataRevision,proof.dataRevision);
  const projected=await (await request('/v1/checks/'+r.listingId+'?drive=0')).json();
  assert.equal(projected.verdict.valuation.medianCents,200000);
  assert.equal(projected.comps[0].total,200000);assert.equal(projected.meta.projection,true);
  assert.equal((await request('/v1/checks/'+r.listingId+'?drive=-1')).status,400);
`));
test('concurrent personal economics never replace canonical shared decisions',()=>isolated(fixture+`
  const economics=getEconomics();assert.equal(economics.min_absolute_profit_cents,10000);
  const [a,b]=await Promise.all([
    checkFetched(listing,{persist:true,vision:false,econ:{...economics,label:'account-a',effective_hourly_floor_cents:1},driveMinutes:0}),
    checkFetched(listing,{persist:true,vision:false,econ:{...economics,label:'account-b',effective_hourly_floor_cents:100000},driveMinutes:120})]);
  assert.notEqual(a.verdict.provenance.economics.hash,b.verdict.provenance.economics.hash);
  assert.equal(a.verdict.provenance.economics.values.label,'account-a');
  assert.equal(b.verdict.provenance.economics.values.label,'account-b');
  const saved=JSON.parse(d.query('SELECT payload FROM verdicts ORDER BY id DESC LIMIT 1').get().payload);
  assert.equal(saved.provenance.economics.scope,'canonical');assert.equal(saved.provenance.economics.driveMinutes,15);
  assert.equal(saved.provenance.economics.values.label,'yish');
  assert.equal(getEconomics().effective_hourly_floor_cents,8000);
  for(const body of [{url:listing.url,driveMinutes:-1},{url:listing.url,vision:'yes'},{url:listing.url,economics:{label:'a'}}])
    assert.equal((await request('/v1/checks','POST',body)).status,400);
`));

test('feed filters the full population and freezes page order across arrivals and retirements',()=>isolated(fixture+`
  import {upsertListingFacts} from '@/src/db/listings.ts';
  import {storeVerdict} from '@/src/db/verdicts.ts';
  d.transaction(()=>{for(let i=0;i<1210;i++){
    const l=upsertListingFacts(d,{source:'audit',sourceId:'feed'+i,url:'https://example.invalid/'+i,title:i===0?'Nvidia RTX 4090 target':'Nvidia RTX 4090 '+i,
      description:'',askingPriceCents:80000,location:null,postedAt:null,photoCount:0});
    storeVerdict(l.id,'fixture',{call:'BUY',confidence:'high',netProfitCents:20000,headline:'Fixture'});
  }})();
  const target=await (await request('/v1/feed?quality=all&q=target')).json();assert.equal(target.items.length,1);
  const first=await (await request('/v1/feed?quality=all&limit=200')).json();assert.equal(first.total,1210);assert.equal(first.items.length,200);
  const expected=d.query('SELECT id FROM listings ORDER BY id DESC').all().map(r=>r.id);
  assert.deepEqual(first.items.map(r=>r.id),expected.slice(0,200));
  d.run('UPDATE listings SET delisted_at=? WHERE id=?',[at,expected[205]]);
  const l=upsertListingFacts(d,{source:'audit',sourceId:'new',url:'https://example.invalid/new',title:'Nvidia RTX 4090 new',description:'',askingPriceCents:100,location:null,postedAt:null,photoCount:0});
  storeVerdict(l.id,'fixture',{call:'BUY',confidence:'high',netProfitCents:999999});
  const second=await (await request('/v1/feed?quality=all&limit=200&cursor='+encodeURIComponent(first.nextCursor))).json();
  assert.equal(second.items.length,200);assert.equal(second.items.some(r=>r.id===l.id),false);
  assert.deepEqual(second.items.map(r=>r.id),expected.slice(200).filter(id=>id!==expected[205]).slice(0,200));
  assert.equal((await request('/v1/feed?quality=all&limit=-1')).status,400);
  assert.equal((await request('/v1/feed?quality=all&q=other&cursor='+encodeURIComponent(first.nextCursor))).status,409);
`));
test('pulse drains same-timestamp bursts after account filters and does not repeat a re-score',()=>isolated(fixture+`
  import {upsertListingFacts} from '@/src/db/listings.ts';
  import {storeVerdict} from '@/src/db/verdicts.ts';
  const initial=await (await request('/v1/pulse')).json();
  d.run('INSERT INTO account_devices(device_ref,user_id,created_at) VALUES(?,1,?)',['owned_fixture',at]);
  for(let i=0;i<51;i++){
    const l=upsertListingFacts(d,{source:'audit',sourceId:'pulse'+i,url:'https://example.invalid/p'+i,title:'Nvidia RTX 4090',description:'',askingPriceCents:10000,location:null,postedAt:null,photoCount:0});
    storeVerdict(l.id,'fixture',{call:'BUY',confidence:'high'},at);
    if(i<5)d.run('INSERT INTO verdict_overrides(device_ref,listing_id,call,created_at) VALUES(?,?,?,?)',['owned_fixture',l.id,'RISK',at]);
  }
  let cursor=initial.cursor,ids=[];
  for(let i=0;i<3;i++){
    const page=await (await request('/v1/pulse?cursor='+encodeURIComponent(cursor))).json();
    assert.equal(page.items.length,i<2?20:6);ids.push(...page.items.map(r=>r.id));cursor=page.cursor;
  }
  assert.equal(new Set(ids).size,46);
  storeVerdict(ids[0],'new-engine',{call:'BUY',confidence:'medium'});
  assert.equal((await (await request('/v1/pulse?cursor='+encodeURIComponent(cursor))).json()).items.length,0);
`));

test('pipeline reports measured stage evidence and leaves unavailable sync unknown',()=>isolated(fixture+`
  import {pipelineFunnel} from '@/src/api/pipeline-health.ts';
  await checkFetched(listing,{persist:true,vision:false});
  const p=pipelineFunnel();
  assert.equal(p.counts.discovered,1);assert.equal(p.counts.exactIdentity,1);assert.equal(p.counts.decisionProvenance,1);
  assert.equal(p.counts.scored,1);assert.equal(p.counts.synchronized,null);
  assert.equal(p.firstScoreSeconds.samples,1);assert.ok(p.firstScoreSeconds.p50>=0);
  assert.equal((await request('/v1/checks/1/outcome','POST',{action:'bought',pricePaidCents:-1})).status,400);
`));
