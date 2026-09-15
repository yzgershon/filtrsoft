import {test,expect} from 'bun:test';
import {isolated} from './isolated.ts';
import {CORE_QUERIES,PART_QUERIES,collectionQuery,marketplaceSearchUrl,discoveryDecision,hasHardwareCategory} from '../src/crawler/search-policy.ts';
import {collectionPlan,SOURCES} from '../src/agent/collection.ts';
import {parseCards} from '../src/sources/marketplace.ts';

test('verified category filters retain active/newest sorting and the original local radius',()=>{
  const gpu=new URL(marketplaceSearchUrl('mercari','graphics card'));
  expect(gpu.searchParams.get('categoryIds')).toBe('775');
  expect(gpu.searchParams.get('itemStatuses')).toBe('1');expect(gpu.searchParams.get('sortBy')).toBe('2');
  expect(new URL(marketplaceSearchUrl('mercari','macbook')).searchParams.get('categoryIds')).toBe('7');
  const ram=new URL(marketplaceSearchUrl('offerup','ddr5 ram'));
  expect(ram.searchParams.get('cid')).toBe('1.6');expect(ram.searchParams.get('radius')).toBe('30');
  expect(ram.searchParams.get('lat')).toBe('42.337');expect(ram.searchParams.get('sort')).toBe('-posted');
  expect(new URL(marketplaceSearchUrl('offerup','iphone')).searchParams.get('cid')).toBe('1.2');
  expect(new URL(marketplaceSearchUrl('offerup','odd & specific + query')).searchParams.get('q')).toBe('odd & specific + query');
});

test('core cadence stays intact while all additional hardware searches and both GPU makers get turns',()=>{
  const core=new Set<string>(),parts=new Set<string>(),facebook=new Set<string>();
  for(let cursor=0;cursor<CORE_QUERIES.length*PART_QUERIES.length*2;cursor+=2){
    const plan=collectionPlan([...SOURCES],cursor);
    expect(plan.filter(s=>s.kind==='crawl')).toHaveLength(9);
    expect(plan.slice(0,3).map(s=>s.source)).toEqual([...SOURCES]);
    for(let round=0;round<2;round++)core.add(collectionQuery('offerup',cursor,round));
    parts.add(collectionQuery('offerup',cursor,2));
    for(let round=0;round<2;round++)facebook.add(collectionQuery('facebook',cursor,round));
  }
  expect(core).toEqual(new Set(CORE_QUERIES));expect(parts).toEqual(new Set(PART_QUERIES));
  expect(facebook.has('nvidia geforce')).toBe(true);expect(facebook.has('amd radeon')).toBe(true);
  expect(facebook.has('graphics card')).toBe(false);
});

test('restart-safe cursor advances beyond the legacy five-query ceiling',()=>isolated(`
  import {advanceCursor,readCursor,STATE_DIR} from '@/src/agent/state.ts';
  import {writeFileSync,mkdirSync} from 'node:fs';import {join} from 'node:path';
  mkdirSync(STATE_DIR,{recursive:true});writeFileSync(join(STATE_DIR,'cursor'),'4');
  assert.equal(advanceCursor(2),4);assert.equal(readCursor(),6);assert.equal(advanceCursor(2),6);assert.equal(readCursor(),8);
  assert.throws(()=>advanceCursor(-1));assert.equal(readCursor(),8);
`));

test('discovery rejects observed irrelevant cards but retains real devices, kits and PC bundles',()=>{
  for(const title of ['Custom Alice and wonderland birthday dress','Vintage Pokemon graphic novel','Folarin Balogun Donruss Magicians Soccer Card','Computer desk','Case for iPhone 15','RTX 4070 waterblock','PS5 Console','Nintendo Switch','HP LaserJet printer'])expect({title,keep:discoveryDecision(title).keep}).toEqual({title,keep:false});
  for(const title of ['GTX 960','RTX 4070 Ti','32GB DDR5 6000 2x16GB RAM','8x32GB ECC RDIMM RAM','Gaming PC with keyboard and mouse','Acer Monitor, Black Desk, and Chair','MacBook for parts','iPhone 15 cracked screen','Custom Pokemon Gaming PC'])expect({title,keep:discoveryDecision(title).keep}).toEqual({title,keep:true});
});

test('short hardware titles never become city names, prices or badges',()=>{
  for(const title of ['GTX 960','gtx1050ti','iPhone']){
    const card=parseCards('offerup',[{href:'/item/detail/a27ccd20-7e33-3713-a241-4b419bdbe112',text:title+' | $10 | West Somerville, MA | Local pickup | Sponsored'}])[0];
    expect(card.title).toBe(title);expect(card.priceCents).toBe(1000);expect(card.location).toBe('West Somerville, MA');
  }
  expect(parseCards('offerup',[{href:'/item/detail/a27ccd20-7e33-3713-a241-4b419bdbe112',text:'$10 | West Somerville, MA | Shipping'}])).toHaveLength(0);
});

test('verified hardware categories retain ambiguous models without rescuing unrelated items or inventing specs',()=>{
  for(const title of ['3080','PowerColor 9070XT Red Devil','AMD Radeon pro w5500','Samsung 990 Pro']){
    expect(discoveryDecision(title,false).keep).toBe(false);
    expect(discoveryDecision(title,true)).toEqual({keep:true,reason:'hardware-category-needs-details'});
  }
  for(const title of ['Computer desk','RTX 4070 waterblock','Case for iPhone 15','Pokemon M1S card','Birthday dress'])expect(discoveryDecision(title,true).keep).toBe(false);
  expect(discoveryDecision('MSI RX 5700 XT Gaming X 8GB For Parts No Display - S/N 000010',true).keep).toBe(true);
  expect(hasHardwareCategory('mercari','graphics card')).toBe(true);
  expect(hasHardwareCategory('mercari','macbook')).toBe(false);
  expect(hasHardwareCategory('facebook','graphics card')).toBe(false);
  expect(hasHardwareCategory('craigslist','syp')).toBe(true);
  expect(hasHardwareCategory('craigslist','ela')).toBe(false);
});

test('Craigslist pre-detail gate skips furniture/consoles without retiring existing listings',()=>isolated(`
  import {db} from '@/src/db/index.ts';import {discover} from '@/src/crawler/queue.ts';
  const calls=[];
  globalThis.fetch=async url=>{calls.push(new URL(url));return new Response(['Computer desk','PS5 Console','Gaming PC RTX 4070','DDR5 RAM 32GB'].map((title,i)=>'<li class="cl-static-search-result"><a href="https://www.craigslist.org/view/d/item/'+(123456+i)+'"><div class="title">'+title+'</div><div class="price">$10</div></a></li>').join(''));};
  const result=await discover({categories:['vgm']});assert.equal(result.seen,4);assert.equal(result.skipped,2);assert.equal(result.queued,2);
  assert.ok(calls[0].searchParams.get('query').split('|').includes('pc'));
  assert.equal(db().query('SELECT COUNT(*) n FROM listings').get().n,0);
`));
