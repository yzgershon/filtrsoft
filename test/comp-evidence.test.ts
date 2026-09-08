import {test,expect} from "bun:test";
import {isolated} from "./isolated.ts";
import {parseSoldRow} from "../src/sources/ebay.ts";

test('sold parser requires a real date and one unambiguous price',()=>{
  const row={href:'https://www.ebay.com/itm/123456789012',title:'Nvidia RTX 4090',text:['$100.00','Used'],img:null};
  const at=Date.parse('2026-09-07T12:00:00Z');
  expect(parseSoldRow(row,at)).toBeNull();
  expect(parseSoldRow({...row,text:[...row.text,'Sold Feb 30, 2026']},at)).toBeNull();
  expect(parseSoldRow({...row,text:[...row.text,'Sold Sep 9, 2026']},at)).toBeNull();
  expect(parseSoldRow({...row,text:['$100.00 to $200.00','Sold Sep 6, 2026']},at)).toBeNull();
  expect(parseSoldRow({...row,text:[...row.text,'Sold Sep 6, 2026']},at)?.soldEvidence?.line).toBe('Sold Sep 6, 2026');
});

test('unverified, provisional and future comps cannot price or ship; history is recoverable',()=>isolated(`
  import {db,insertComp} from '@/src/db/index.ts';
  import {valueSku} from '@/src/valuation/index.ts';
  import {exportArchive,importArchive,archiveManifest} from '@/src/db/archive.ts';
  const d=db(),at=new Date(Date.now()-86400000).toISOString();
  d.run("INSERT INTO skus(category,brand,model,attributes,created_at) VALUES('gpu','Nvidia','RTX 4090','{}',?)",[at]);
  const put=(id,date,source='ebay',raw={soldAt:date})=>insertComp({source,source_item_id:id,raw_title:'Nvidia RTX 4090',sold_price_cents:100000,sold_at:date,sku_id:1,condition_norm:'used',raw});
  assert.equal(put('null',undefined).changes,0);
  assert.equal(put('future',new Date(Date.now()+86400000).toISOString()).changes,0);
  assert.equal(put('provisional',at,'manual-provisional',{soldAt:at,provisional:true}).changes,0);
  assert.equal(put('unverified',at,'ebay',{}).changes,0);
  for(let i=0;i<3;i++)put(String(i),at);
  put('old','2001-01-01T00:00:00.000Z');
  d.run("INSERT INTO comps(source,source_item_id,raw_title,sold_price_cents,captured_at,sku_id,raw_json) VALUES('manual-provisional','legacy','Nvidia RTX 4090',1,?,1,'{}')",[at]);
  assert.equal(valueSku(1,{category:'gpu'}).compCount,3);
  assert.equal(d.query('SELECT COUNT(*) n FROM quarantined_comp_history').get().n,1);
  assert.equal(d.query('SELECT COUNT(*) n FROM comp_quarantine').get().n,4);
  const a=exportArchive();assert.equal(a.comps.length,4); // dated old evidence is archived, never current
  const invalid={...a.comps[0],source_item_id:'import-invalid',sold_at:null};a.comps.push(invalid);a.manifest=archiveManifest(a);
  assert.equal(importArchive(a).skipped,1);
  assert.equal(d.query("SELECT COUNT(*) n FROM comps WHERE source_item_id='import-invalid'").get().n,0);
  assert.equal(put('0',at).changes,0);
`));

test('health counts actual usable coverage and collection prioritizes unmet demand with durable backoff',()=>isolated(`
  import {db,insertComp} from '@/src/db/index.ts';
  import {compsHealth} from '@/src/api/pipeline-health.ts';
  import {app} from '@/src/api/index.ts';
  import {collectionPriority,startCollection,finishCollection} from '@/src/sources/comp-priority.ts';
  import {upsertListingFacts} from '@/src/db/listings.ts';
  import {storeVerdict} from '@/src/db/verdicts.ts';
  const d=db(),at=new Date(Date.now()-86400000).toISOString();
  for(const [cat,brand,model] of [['gpu','Nvidia','RTX 4090'],['gpu','Nvidia','RTX 3080'],['console','Microsoft','Xbox Series X']])d.run("INSERT INTO skus(category,brand,model,attributes,created_at) VALUES(?,?,?,'{}',?)",[cat,brand,model,at]);
  for(let i=0;i<3;i++)insertComp({source:'ebay',source_item_id:String(i),raw_title:'Nvidia RTX 4090',sold_price_cents:100000,sold_at:at,condition_norm:'used',sku_id:1,raw:{soldAt:at}});
  insertComp({source:'ebay',source_item_id:'sparse',raw_title:'Nvidia RTX 3080',sold_price_cents:30000,sold_at:at,condition_norm:'used',sku_id:2,raw:{soldAt:at}});
  const listing=upsertListingFacts(d,{source:'audit',sourceId:'one',url:'https://example.invalid/one',title:'Nvidia RTX 3080',description:'RTX 3080 graphics card',askingPriceCents:10000,location:null,postedAt:null,photoCount:0});
  storeVerdict(1,'fixture',{call:'INSUFFICIENT_DATA',decidingUnknown:'recent sold comps'});
  assert.equal(collectionPriority(10)[0].id,2);assert.equal(collectionPriority(10).length,2);
  const attempt=startCollection(2,'Nvidia RTX 3080');finishCollection(attempt,{fetched:20,parsed:10,accepted:0,saved:0});
  assert.equal(collectionPriority(10).some(s=>s.id===2),false);
  assert.equal(collectionPriority(10,Date.now()+3600001)[0].id,2);
  const h=compsHealth();assert.equal(h.skusTotal,2);assert.equal(h.skusPriceable,1);assert.equal(h.recentLinkedSkus,2);
  assert.deepEqual(h.coverageByCategory.gpu,{ok:1,sparse:1,no_comps:0});
  assert.equal(h.collection24h.fetched,20);assert.equal(h.collection24h.accepted,0);
  assert.equal(h.insufficientReasons[0].count,1);
  assert.equal((await (await app.request('/v1/health')).json()).canPrice,true);
  // Keeping thousands of historical rows does not prove any model can be priced.
  d.run("UPDATE comps SET sold_at='2020-01-01T00:00:00Z',raw_json=?",[JSON.stringify({soldAt:'2020-01-01T00:00:00Z'})]);
  const stale=await app.request('/v1/health');assert.equal(stale.status,200);
  const status=await stale.json();assert.equal(status.canPrice,false);assert.equal(status.comps.total,4);assert.equal(status.comps.skusPriceable,0);
`));
