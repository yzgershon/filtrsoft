import {test} from "bun:test";
import {isolated} from "./isolated.ts";
const fixture=`
  import {db,insertComp} from '@/src/db/index.ts';
  import {checkFetched,checkStored} from '@/src/engine/index.ts';
  import {getEconomics} from '@/src/valuation/index.ts';
  import {app} from '@/src/api/index.ts';
  const d=db(),at=new Date().toISOString();
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
