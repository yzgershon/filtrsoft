import {test,expect} from 'bun:test';
import {isolated} from './isolated.ts';
import {conditionDisclosure} from '../src/signals/condition.ts';
import {probeVerdict,mercariDescription,parseMercariDetail,offerUpDescription} from '../src/sources/marketplace.ts';
import {collectionPlan} from '../src/agent/collection.ts';
import {extractAttributes} from '../src/catalog/match.ts';
import {availabilityView} from '../src/db/availability.ts';
import {isPhotoUrl} from '../src/sources/photo-url.ts';
import {detectCategory,analyze} from '../src/signals/index.ts';
import {compMatchesQuery} from '../src/sources/ebay.ts';

test('desktop wording and Windows edition cannot masquerade as laptop model variants',()=>{
  for(const title of ['Dell XPS 8930 Desktop PC i7 NVIDIA graphics 2TB','Dell Inspiron 7700 AIO 27 inch','Dell Precision 5820 Tower'])expect(detectCategory(title)).toBe('prebuilt');
  expect(detectCategory('Dell Precision 5560 Mobile Workstation Laptop')).toBe('laptop');
  expect(detectCategory('Intel Desktop Processor i7-9700K')).toBe('component');
  expect(detectCategory('Kingston Fury 32GB DDR5 6000 Desktop Memory')).toBe('ram');
  expect(detectCategory('Corsair 360mm AIO liquid CPU cooler')).not.toBe('prebuilt');
  expect(compMatchesQuery('Lenovo Legion 5 Ryzen 7 5800H RTX 3060 16GB RAM 1TB SSD Windows 11 Pro','Lenovo Legion 5','laptop').ok).toBe(true);
  expect(compMatchesQuery('Lenovo Legion Pro 5 laptop','Lenovo Legion 5','laptop').ok).toBe(false);
  expect(compMatchesQuery('Dell Inspiron 5400 / 7700 Replacement Motherboard i7-1165G7','Dell Inspiron 7700','laptop').ok).toBe(false);
  const report=analyze({source:'facebook',sourceId:'fixture',url:'https://example.invalid',title:'Lenovo Legion 5 laptop',description:'R7 5800H, RTX 3060, 16 gigs RAM, 1TB SSD',askingPriceCents:50000,photoUrls:[],attributes:{},raw:{},location:null,postedAt:null,updatedAt:null});
  expect(report.missingValueFields).not.toContain('cpu');expect(report.missingValueFields).not.toContain('ram');
});

test('availability distinguishes checked, expired, failed and never checked evidence',()=>{
  const at=Date.now(),recent=new Date(at-60000).toISOString(),old=new Date(at-7*3600000).toISOString();
  expect(availabilityView(undefined,false,at).state).toBe('unchecked');
  expect(availabilityView({observed_at:recent,outcome:'alive'},false,at).state).toBe('checked');
  expect(availabilityView({observed_at:old,outcome:'alive'},false,at).state).toBe('stale');
  expect(availabilityView({observed_at:recent,outcome:'unknown'},false,at).state).toBe('unknown');
  expect(availabilityView(undefined,true,at).state).toBe('gone');
  expect(isPhotoUrl('https://video.xx.fbcdn.net/clip.mp4?token=sample')).toBe(false);
  expect(isPhotoUrl('https://images.example.com/photo.jpg?token=sample')).toBe(true);
});

test('seller condition survives marketplace details and does not invent damage from negations',()=>{
  expect(conditionDisclosure('Purchased from liqudation. Untested sold as is.').untested).toBeTruthy();
  expect(conditionDisclosure('Untested sold as is for parts.').broken).toBeTruthy();
  for(const text of ['Not for parts. Tested working.','Not broken.','Not sold as for parts.','Broken box, GPU works perfectly.'])expect(conditionDisclosure(text).broken).toBeNull();
  const description=mercariDescription(parseMercariDetail('Details\nCondition\nPoor\nBrand\nSapphire\nDescription\nUntested sold as is for parts.\nDelivery\nFree'));
  expect(description).toContain('condition: Poor');expect(conditionDisclosure(description).broken).toBeTruthy();
  expect(offerUpDescription({description:'',details:{condition:'For parts'}})).toBe('condition: For parts');
});

test('sold badges and positive actions belong to the exact requested item',()=>{
  const url='https://offerup.com/item/detail/abc';
  const page={url,finalUrl:url,title:'RTX 4090 for Sale in Boston - OfferUp',heading:'RTX 4090',actions:['Ask','Make offer'],text:'RTX 4090\n$1500\nDetails\nUsed\nA graphics card'};
  expect(probeVerdict(page)?.gone).toBe(false);
  expect(probeVerdict({...page,text:'RTX 4090\n$1500\nSOLD\nDetails\nUsed'} )?.gone).toBe(true);
  expect(probeVerdict({...page,text:page.text+'\nSimilar items\nSOLD\nRTX 3060 $200'})?.gone).toBe(false);
  expect(probeVerdict({...page,finalUrl:'https://offerup.com/item/detail/different'})).toBeNull();
  expect(probeVerdict({...page,heading:'',actions:[],text:'Log in Sign up Browse recommendations RTX 4090 $1500'})).toBeNull();
  expect(probeVerdict({...page,title:'Just a moment',text:'Security verification. Please wait before seeing the RTX 4090 $1500.'})).toBeNull();
  expect(probeVerdict({...page,text:'RTX 4090\nSold by\nAlex\n$1500\nMake offer'})?.gone).toBe(false);
  expect(probeVerdict({...page,text:'Home > RTX 4090\nSimilar items\nOther GPU SOLD\nRTX 4090\n$1500\nMake offer'})?.gone).toBe(false);
});

test('OfferUp chevron breadcrumbs do not count as a second item panel',()=>{
  const heading='MSI RTX 5090 Liquid Suprim and ROG Strix X870e mother board';
  const url='https://offerup.com/item/detail/c05b46e1-e7c6-3780-869d-6d5c23aba7d3';
  const page={url,finalUrl:url,heading,title:`${heading} for Sale in Melrose, MA - OfferUp`,actions:['Ask','Make offer'],
    text:`Home\n›\nComputers & Accessories\n›\n${heading}\nTake action\n$3,100\n${heading}\nSold by\nZack\nAsk\nMake offer\nDescription\nSelling a new still sealed MSI 5090 LC suprim GPU and ROG Strix X870e MB.\nSimilar items\nSOLD`};
  expect(probeVerdict(page)?.gone).toBe(false);
  expect(probeVerdict({...page,text:page.text.replace('Sold by','Sold\nSold by')})?.gone).toBe(true);
  expect(probeVerdict({...page,text:page.text.replace('Take action',heading)})).toBeNull();
  expect(probeVerdict({...page,actions:[]})).toBeNull();
});

test('explicit Radeon variants retain their identity while legacy Radeon numbers stay unknown',()=>{
  expect(extractAttributes('Alienware R10 Radeon 6800XT 16GB, Ryzen 9 5900X, 32GB DDR4 RAM').gpu).toBe('rx 6800 xt');
  expect(extractAttributes('Graphics card Radeon 7900 XTX').gpu).toBe('rx 7900 xtx');
  expect(extractAttributes('Graphics card Radeon 9700 Pro').gpu).toBeUndefined();
  expect(extractAttributes('Graphics card Radeon Pro W6800').gpu).toBeUndefined();
});

test('Mercari breadcrumb titles do not hide the actual item availability and price',()=>{
  const url='https://www.mercari.com/us/item/m87685110404/';
  const heading='Sapphire Pulse AMD Radeon RX 7900xtx Graphics Card';
  const page={url,finalUrl:url,heading,actions:['Make offer','Add to cart','Buy now'],title:heading,
    text:`Mercari\n\n>\n\nComputer GPUs\n\n>\n\n${heading}\n\nSimilar items\nOther card\nSOLD\n$200\n\n${heading}\nUsed - Poor\n$529.00\n$649.00\nMake offer\nDetails\nCondition\nPoor`};
  expect(probeVerdict(page)?.gone).toBe(false);
  expect(probeVerdict({...page,text:page.text.replace('Used - Poor','Sold')})?.gone).toBe(true);
  expect(probeVerdict({...page,text:`Mercari\n>\n${heading}\nSimilar items\nOther card\n$200`,actions:[]})).toBeNull();
  const duplicate={...page,text:page.text.replace('Other card',heading)};
  expect(probeVerdict(duplicate)).toBeNull();
  expect(probeVerdict({...duplicate,itemText:`${heading}\n$529.00\nMake offer\nDetails\nCondition\nPoor`})?.gone).toBe(false);
  expect(probeVerdict({...duplicate,itemText:`${heading}\n$529.00\nSold`})?.gone).toBe(true);
  expect(probeVerdict({...duplicate,itemText:`Another card\n$200\nBuy now`})).toBeNull();
});

test('server repair work preserves provenance and never overwrites unsent collector evidence',()=>isolated(`
  import {db} from '@/src/db/index.ts';import {upsertListingFacts} from '@/src/db/listings.ts';
  import {repairTargets,acceptRepairTargets,repairTargetSchema} from '@/src/agent/targets.ts';
  import {storeVerdict} from '@/src/db/verdicts.ts';import {dueProbes} from '@/src/db/probes.ts';
  const d=db(),at=new Date(Date.now()-3600000).toISOString();
  const facts={source:'mercari',sourceId:'m123',url:'https://www.mercari.com/us/item/m123/',title:'RTX 4090',description:'',askingPriceCents:150000,location:null,postedAt:null,photoCount:0};
  const id=upsertListingFacts(d,facts,at).id;storeVerdict(id,'fixture',{call:'BUY'});
  const work=repairTargets(['mercari']);assert.equal(work.length,1);assert.equal(work[0].capturedAt,at);
  upsertListingFacts(d,{...facts,description:'New unsent seller description',askingPriceCents:140000});
  acceptRepairTargets(work);assert.equal(d.query('SELECT description FROM listings WHERE id=?').get(id).description,'New unsent seller description');
  assert.equal(d.query('SELECT asking_price_cents FROM listings WHERE id=?').get(id).asking_price_cents,140000);
  const added={...work[0],sourceId:'m456',url:'https://www.mercari.com/us/item/m456/',photos:['https://cdn.invalid/one.jpg']};
  acceptRepairTargets([added]);const row=d.query("SELECT * FROM listings WHERE source_id='m456'").get();
  assert.equal(row.last_seen,at);assert.equal(row.captured_at,at);assert.equal(row.updated_at,null);
  assert.equal(d.query('SELECT COUNT(*) n FROM listing_photos WHERE listing_id=?').get(row.id).n,1);
  assert.ok(dueProbes('mercari',20).some(r=>r.id===row.id));
  assert.equal(repairTargetSchema.safeParse({...added,url:'https://www.mercari.com/us/item/m999/'}).success,false);
  assert.equal(repairTargetSchema.safeParse({...added,url:'https://evil.invalid/us/item/m456/'}).success,false);
`));

test('detail reads include good photos with missing prose, short disclosures and backoff fairness',()=>isolated(`
  import {db} from '@/src/db/index.ts';import {upsertListingFacts} from '@/src/db/listings.ts';
  import {dueDetails,recordDetailAttempt} from '@/src/db/enrichment.ts';
  const d=db(),at=Date.now();const ids=[];
  for(let i=0;i<3;i++) {
    const id=upsertListingFacts(d,{source:'offerup',sourceId:String(i),url:'https://offerup.com/item/detail/'+i,title:'Nvidia RTX 4090',description:'',askingPriceCents:50000,location:null,postedAt:null,photoCount:1}).id;
    d.run('INSERT INTO listing_photos(listing_id,url,position,captured_at) VALUES(?,?,0,?)',[id,'https://images.offerup.com/signature/1200x1200/photo.jpg',new Date(at).toISOString()]);ids.push(id);
  }
  assert.equal(dueDetails('offerup',20,at).length,3);
  recordDetailAttempt(ids[2],'failed',at);assert.ok(!dueDetails('offerup',20,at+1).some(r=>r.id===ids[2]));
  recordDetailAttempt(ids[1],'empty',at);assert.equal(dueDetails('offerup',20,at+1).length,1);
  assert.equal(dueDetails('offerup',20,at+86400001).length,3);
`));

test('collector keeps core and parts discovery bounded below its detail-reading budget',()=>{
  const plan=collectionPlan(['offerup'],0);
  const captures=plan.filter(s=>s.kind==='crawl').reduce((n,s)=>n+Number(s.args[s.args.indexOf('--limit')+1]),0);
  const detail=plan.find(s=>s.kind==='enrich')!;
  expect(captures).toBeLessThan(Number(detail.args[detail.args.indexOf('--limit')+1]));
  expect(plan.filter(s=>s.kind==='crawl')).toHaveLength(3);
});

test('Legion desktops cannot borrow laptop identity and laptop comps must match actual configuration',()=>isolated(`
  import {db,insertComp} from '@/src/db/index.ts';import {matchSku,extractAttributes} from '@/src/catalog/match.ts';
  import {valueSku} from '@/src/valuation/index.ts';import {compMatchesQuery} from '@/src/sources/ebay.ts';
  import {collectionPriority} from '@/src/sources/comp-priority.ts';import {upsertListingFacts} from '@/src/db/listings.ts';import {storeVerdict} from '@/src/db/verdicts.ts';
  const d=db(),at=new Date().toISOString();d.run("INSERT INTO skus(id,category,brand,model,created_at) VALUES(1,'laptop','Lenovo','Legion 5',?)",[at]);
  const desktop=matchSku('Lenovo Legion T5 Gaming PC GTX 1660 Super Ryzen 5 3600','GTX 1660 Super 6GB\\n8GB DDR4 3200MHz RAM','prebuilt');
  assert.notEqual(desktop.category,'laptop');assert.equal(desktop.attributes.ram_gb,8);assert.equal(desktop.attributes.vram_gb,6);
  d.run("INSERT INTO skus(id,category,brand,model,created_at) VALUES(2,'laptop','Apple','MacBook Pro M1',?)",[at]);
  const max=matchSku('MacBook Pro M1 Max, 32GB RAM, 1TB SSD','','laptop');assert.equal(max.model,'MacBook Pro M1 Max');assert.notEqual(max.skuId,2);
  d.run("INSERT INTO skus(id,category,brand,model,created_at) VALUES(20,'laptop','Apple','MacBook Pro 2019',?)",[at]);
  assert.equal(matchSku('Apple MacBook Pro 2019','Bought in 2024, selling in 2026.','laptop').skuId,20);
  assert.equal(extractAttributes('R7 5800H, 16 gigs RAM').cpu,'ryzen 7 5800h');
  const wrong='NIMO 15.6 FHD Student Laptop 8/16GB RAM 1TB SSD Intel Pentium N100';
  assert.equal(compMatchesQuery(wrong,'Lenovo Legion 5','laptop').ok,false);
  const right='Lenovo Legion 5 Ryzen 7 5800H RTX 3060 16GB RAM 1TB SSD';
  for(const [i,title] of [wrong,right,right,right,right.replace('3060','5070'),right.replace('5800H','6800H'),right.replace('16GB','32GB')].entries())insertComp({source:'ebay',source_item_id:String(i),raw_title:title,sold_price_cents:60000+i,sold_at:at,sku_id:1,condition_norm:'used',raw:{soldAt:at}});
  const attributes=extractAttributes(right),v=valueSku(1,{category:'laptop',condition:'used',attributes});
  assert.equal(attributes.vram_gb,undefined);
  assert.equal(v.compCount,3);assert.ok(v.evidence.every(e=>e.raw_title===right));
  const id=upsertListingFacts(d,{source:'audit',sourceId:'legion',url:'https://example.invalid',title:'Lenovo Legion 5 Gaming Laptop',description:right,askingPriceCents:50000,location:null,postedAt:null,photoCount:0}).id;
  storeVerdict(id,'fixture',{call:'INSUFFICIENT_DATA'});
  assert.equal(collectionPriority(10)[0].demandQuery,'Lenovo Legion 5 ryzen 7 5800h rtx 3060 16GB RAM 1TB SSD');
`));

test('untested and parts GPUs cannot reach BUY even with attractive exact sold comps',()=>isolated(`
  import {db,insertComp} from '@/src/db/index.ts';import {checkFetched} from '@/src/engine/index.ts';
  const d=db(),at=new Date().toISOString();d.run("INSERT INTO skus(category,brand,model,attributes,created_at) VALUES('gpu','AMD','RX 7900 XTX','{}',?)",[at]);
  for(let i=0;i<4;i++)insertComp({source:'ebay',source_item_id:String(i),raw_title:'Sapphire Pulse AMD Radeon RX 7900 XTX 24GB',sold_price_cents:85000+i*100,sold_at:at,sku_id:1,condition_norm:'used',raw:{soldAt:at}});
  const listing={source:'mercari',sourceId:'m1',url:'https://www.mercari.com/us/item/m1/',title:'Sapphire Pulse AMD Radeon RX 7900xtx Graphics Card',askingPriceCents:59900,location:null,postedAt:null,updatedAt:null,photoUrls:[],attributes:{},raw:{}};
  globalThis.fetch=async()=>{throw new Error('No network');};
  const untested=await checkFetched({...listing,description:'Purchased from liqudation. Untested sold as is.'},{persist:false,vision:false});
  assert.equal(untested.verdict.call,'VERIFY');assert.equal(untested.verdict.decidingUnknown,'working condition');
  const parts=await checkFetched({...listing,description:'Purchased from liqudation. Untested sold as is for parts.'},{persist:false,vision:false});
  assert.equal(parts.verdict.call,'RISK');assert.ok(parts.verdict.blockers.some(s=>s.includes('for parts')));
`));

test('operable laptops with disclosed display damage cannot borrow an undamaged bargain verdict',()=>isolated(`
  import {conditionDisclosure} from '@/src/signals/condition.ts';import {checkFetched} from '@/src/engine/index.ts';
  for(const description of ['Used , fully operable - there is a crack on the screen .','Cracked display','Screen has a small crack','Shattered LCD'])assert.ok(conditionDisclosure(description).displayDamage,description);
  for(const description of ['No cracks on the screen.','Screen has no cracks.','Not a cracked screen.','Cracked screen protector only.','A crack on the screen protector.','Cracked screen was replaced.','Replaced the cracked display.','Warranty covers cracked screens.'])assert.equal(conditionDisclosure(description).displayDamage,null,description);
  assert.equal(conditionDisclosure('Broken screen protector only.').broken,null);
  globalThis.fetch=async()=>{throw new Error('No network');};
  const result=await checkFetched({source:'offerup',sourceId:'damage',url:'https://offerup.com/item/detail/damage',title:'HP ENVY x360 16 inch 2.8k OLED Touch AMD Ryzen 16GB RAM',description:'Used , fully operable - there is a crack on the screen .',askingPriceCents:10000,location:null,postedAt:null,updatedAt:null,photoUrls:[],attributes:{},raw:{}},{persist:false,vision:false});
  assert.equal(result.verdict.call,'RISK');assert.ok(result.verdict.blockers.some(s=>s.includes('crack on the screen')));
`));
