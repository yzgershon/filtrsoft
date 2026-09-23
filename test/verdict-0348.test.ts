import {describe,test,expect} from 'bun:test';
import {isolated} from './isolated.ts';
import {spelledContact} from '../src/signals/index.ts';

// September 22 audit of the live VERIFY stream on the OMEN collector.
describe('spelled-out phone numbers',()=>{
 test('the RTX 3090 listing hides a full number in words',()=>{
  const text="Clean and ready to use. I don't check my OfferUp messages often. Serious buyer only five two zero, two eight three, seven eight three three. Thanks.";
  expect(spelledContact(text)).toBe('five two zero, two eight three, seven eight three three');
  expect(spelledContact('Call me at 617 five five five one two one two')).not.toBeNull();
 });
 test('counts, sizes, prices and ordinary numbers are not contacts',()=>{
  for(const text of ['two 8GB sticks, one fan missing, three 1TB drives','Asking 120, will take 100 for two',
   '(617) 555-1234 call anytime','Model 5420 with 16 GB, 2024 11 15','one two three four','Selling one, two or three of these'])
   expect(spelledContact(text)).toBeNull();
 });
});

const fixture=`
  import {db,insertComp} from '@/src/db/index.ts';
  import {checkFetched} from '@/src/engine/index.ts';
  const d=db(),at=new Date(Date.now()-86400000).toISOString();
  globalThis.fetch=async()=>{throw new Error('network forbidden');};
  const sku=(model,price)=>{const id=Number(d.run("INSERT INTO skus(category,brand,model,attributes,created_at) VALUES('gpu','Nvidia',?,'{}',?)",[model,at]).lastInsertRowid);
    for(let i=0;i<6;i++)insertComp({source:'ebay',source_item_id:model+i,raw_title:'Nvidia '+model,sold_price_cents:price+i*100,sold_at:at,sku_id:id,condition_norm:'used',raw:{soldAt:at}});};
  const listing=(id,title,description,ask)=>({source:'offerup',sourceId:id,url:'https://offerup.com/item/detail/'+id,title,description,askingPriceCents:ask,location:'Quincy, MA',postedAt:null,updatedAt:null,photoUrls:['https://example.invalid/a.jpg'],attributes:{},raw:{}});
`;
describe('engine 0.3.48 VERIFY stream',()=>{
 test('a deep discount that cannot pay for the trip is FAIR, not VERIFY',()=>isolated(fixture+`
  sku('GTX 960',3800);
  const r=await checkFetched(listing('gtx960','Gtx 960','Works fine, pulled from my old build.',1000),{persist:false,vision:false});
  assert.equal(r.verdict.call,'FAIR',r.verdict.headline);
 `));
 test('a deep discount with a real margin still asks to verify first',()=>isolated(fixture+`
  sku('RTX 4090',150000);
  const r=await checkFetched(listing('rtx4090','Nvidia RTX 4090','Works fine, pulled from my old build.',70000),{persist:false,vision:false});
  assert.equal(r.verdict.call,'VERIFY',r.verdict.headline);
 `));
 test('a phone number spelled out in words is an off-platform redirect',()=>isolated(fixture+`
  sku('RTX 3090',100000);
  const r=await checkFetched(listing('rtx3090','Nvidia RTX 3090 24GB',"Clean and ready to use. I don't check my OfferUp messages often. Serious buyer only five two zero, two eight three, seven eight three three.",45000),{persist:false,vision:false});
  assert.equal(r.verdict.call,'RISK',r.verdict.headline);
  assert.ok(r.signals.signals.some(s=>s.code==='OFF_PLATFORM_REDIRECT'));
 `));
});
