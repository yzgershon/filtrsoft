import {test} from "bun:test";
import {isolated} from "./isolated.ts";
test('a mid-tower chassis is not a whole desktop that needs CPU/GPU evidence',()=>isolated(`
  import {detectCategory} from '@/src/signals/index.ts';
  assert.equal(detectCategory('NZXT Mid-Tower PC Case (Black, Tempered Glass)'),'case');
  assert.equal(detectCategory('Computer Case - Desktop Tower - PC Gaming Case'),'case');
  assert.equal(detectCategory('Gaming PC RTX 4090 in NZXT PC case'),'prebuilt');
`));
test('laptop dual-port copy cannot activate a GPU board-tier comp filter',()=>isolated(`
  import {db} from '@/src/db/index.ts';
  import {checkFetched} from '@/src/engine/index.ts';
  const d=db(),at=new Date().toISOString();
  d.run("INSERT INTO skus(category,brand,model,attributes,created_at) VALUES('laptop','Dell','Latitude 7420','{}',?)",[at]);
  const id=d.query('SELECT id FROM skus').get().id;
  for(let i=0;i<4;i++)d.run("INSERT INTO comps(source,source_item_id,raw_title,sold_price_cents,captured_at,sold_at,sku_id,raw_json,condition_norm) VALUES('ebay',?,'Dell Latitude 7420 i7 32GB RAM 512GB SSD',50000,?,?,?,'{}','used')",[String(i),at,at,id]);
  const r=await checkFetched({source:'audit',sourceId:'one',url:'https://example.invalid',title:'Dell Latitude 7420',description:'Dual USB ports. i7-1185G7 32GB RAM 512GB SSD',askingPriceCents:60000,location:null,postedAt:null,updatedAt:null,photoUrls:[],attributes:{},raw:{}},{persist:false,vision:false,econ:{label:'audit',min_absolute_profit_cents:10000,effective_hourly_floor_cents:8000,transaction_minutes:15,relist_minutes:20,prefers_channel:'facebook'}});
  assert.equal(r.verdict.valuation.compCount,4);
`));
test('pricing revisions cover corrections, relinks, no-op updates and hourly expiry',()=>isolated(`
  import {db} from '@/src/db/index.ts';
  import {pricingSignature} from '@/src/db/revisions.ts';
  const d=db(),at=Date.parse('2026-09-01T01:00:00Z');
  d.run("INSERT INTO skus(category,brand,model,attributes,created_at) VALUES('gpu','Nvidia','RTX 4090','{}',?)",[new Date(at).toISOString()]);
  let before=pricingSignature(d,at);
  d.run("UPDATE skus SET model=model");assert.equal(pricingSignature(d,at),before);
  d.run("UPDATE skus SET attributes=?",[JSON.stringify({vram:24})]);assert.notEqual(pricingSignature(d,at),before);
  d.run("INSERT INTO comps(source,source_item_id,raw_title,sold_price_cents,captured_at,raw_json) VALUES('audit','one','RTX 4090',100000,?,'{}')",[new Date(at).toISOString()]);
  before=pricingSignature(d,at);d.run('UPDATE comps SET sku_id=(SELECT id FROM skus LIMIT 1)');assert.notEqual(pricingSignature(d,at),before);
  before=pricingSignature(d,at);d.run('UPDATE comps SET sold_price_cents=90000');assert.notEqual(pricingSignature(d,at),before);
  assert.notEqual(pricingSignature(d,at),pricingSignature(d,at+3_600_000));
`));
test('scoring resumes after interruption, retries failures and never declares them complete',()=>isolated(`
  import {db} from '@/src/db/index.ts';
  import {upsertListingFacts} from '@/src/db/listings.ts';
  import {scorePending,scoringStatus} from '@/src/db/scoring.ts';
  const d=db();
  for(let i=0;i<4;i++)upsertListingFacts(d,{source:'audit',sourceId:String(i),url:'https://example.invalid/'+i,title:'Unknown tech',description:'',askingPriceCents:10000,location:null,postedAt:null,photoCount:0});
  let fail=true;const score=id=>{if(id===1 && fail)throw new Error('forced failure');return {call:'INSUFFICIENT_DATA'};};
  const first=scorePending(2,score);assert.equal(first.failed,1);assert.equal(first.checked,1);assert.equal(first.complete,false);
  assert.equal(scorePending(2,score).checked,2);assert.equal(scoringStatus().pending,1);
  assert.equal(scorePending(2,score).checked,0); // retry backoff, not lost work
  fail=false;d.run("UPDATE scoring_state SET retry_at='2000-01-01T00:00:00.000Z'");
  assert.equal(scorePending(2,score).checked,1);assert.equal(scoringStatus().complete,true);
  assert.equal(scorePending(2,score).checked,0);
  d.run("UPDATE pricing_revision SET revision=revision+1");
  assert.equal(scoringStatus().pending,4);assert.equal(scorePending(1,score).checked,1);assert.equal(scoringStatus().pending,3);
`));
test('retail selects newest availability before price and only fresh exact corroboration',()=>isolated(`
  import {db} from '@/src/db/index.ts';
  import {latestRetail} from '@/src/sources/retail.ts';
  const d=db(),now=new Date().toISOString(),old=new Date(Date.now()-50*86_400_000).toISOString();
  d.run("INSERT INTO skus(category,brand,model,attributes,created_at) VALUES('phone','Apple','iPhone 16','{}',?)",[now]);
  const id=d.query('SELECT id FROM skus LIMIT 1').get().id;
  const put=(source,price,date,isNew=1,gb=128,tier=null)=>d.run('INSERT INTO retail_prices(sku_id,source,title,price_cents,is_new,storage_gb,board_tier,query,observed_at) VALUES(?,?,?,?,?,?,?,?,?)',[id,source,source+' offer',price,isNew,gb,tier,'iPhone 16 128GB',date]);
  put('bestbuy',50000,old);put('newegg',51000,now);
  assert.equal(latestRetail(id,128).corroborated,false);assert.equal(latestRetail(id,128).quotes.length,1);
  assert.equal(latestRetail(id,512),null);
  put('bestbuy',50000,now);assert.equal(latestRetail(id,128).corroborated,true);
  put('bestbuy',0,now,0,null);assert.equal(latestRetail(id,128).source,'newegg');assert.equal(latestRetail(id,128).corroborated,false);
  assert.equal(latestRetail(id,128,'premium'),null);
`));
test('archive imports retail into nonempty tables, verifies manifests and applies newer corrections only',()=>isolated(`
  import {db} from '@/src/db/index.ts';
  import {exportArchive,importArchive,archiveManifest,writeArchive,readArchive} from '@/src/db/archive.ts';
  const d=db(),at='2026-09-01T00:00:00.000Z';
  d.run("INSERT INTO skus(category,brand,model,attributes,created_at) VALUES('gpu','Nvidia','RTX 4090','{}',?)",[at]);
  const id=d.query('SELECT id FROM skus LIMIT 1').get().id;
  d.run("INSERT INTO comps(source,source_item_id,raw_title,sold_price_cents,captured_at,sku_id,raw_json) VALUES('audit','one','RTX 4090',100000,?,?,'{}')",[at,id]);
  d.run("INSERT INTO retail_prices(sku_id,source,title,price_cents,is_new,query,observed_at) VALUES(?,'bestbuy','RTX 4090',110000,1,'RTX 4090',?)",[id,at]);
  const a=exportArchive();assert.equal(importArchive(a).retail,0);
  const b=structuredClone(a);b.retail.push({...a.retail[0],price_cents:105000,observed_at:'2026-09-02T00:00:00.000Z'});
  b.comps[0].sold_price_cents=90000;b.comps[0].updated_at='2026-09-03T00:00:00.000Z';b.manifest=archiveManifest(b);
  assert.equal(importArchive(b).retail,1);assert.equal(importArchive(b).retail,0);
  assert.equal(d.query('SELECT sold_price_cents FROM comps').get().sold_price_cents,90000);
  importArchive(a);assert.equal(d.query('SELECT sold_price_cents FROM comps').get().sold_price_cents,90000);
  writeArchive(b,'./archive.gz');assert.deepEqual(readArchive('./archive.gz').manifest,b.manifest);
  const corrupt=structuredClone(b);corrupt.comps[0].sold_price_cents=1;assert.throws(()=>importArchive(corrupt));
  assert.equal(d.query('SELECT COUNT(*) n FROM retail_prices').get().n,2);
`));
