import {test,expect} from 'bun:test';
import {closedDomain,boundedDecision} from '../src/verdict/bounded.ts';
import {DEFAULT_ECONOMICS} from '../src/valuation/index.ts';
import {isolated} from './isolated.ts';
const at=Date.parse('2026-09-17T20:00:00Z'),domain=closedDomain('Storage is either 128GB or 256GB only.')!;
const options={category:'phone',ask:10000,econ:DEFAULT_ECONOMICS,drive:15,conflict:false,conditionKnown:true};
const row=(value:number,call='BUY',price=50000):any=>({value,verdict:{call,blockers:[],riskChecks:[{state:'resolved'}],provenance:{match:{skuId:1,confidence:'high',brand:'Apple',model:'iPhone 15',attributes:{storage_gb:value}}},valuation:{status:'ok',compCount:5,lowCents:price,highCents:price+5000,evidence:Array.from({length:5},(_,i)=>({id:value+i,source_item_id:String(value+i),raw_title:`Apple iPhone 15 ${value}GB Unlocked`,url:'https://ebay.com/itm/'+(value+i),source:'ebay',condition_norm:'used',sold_at:'2026-09-01T00:00:00Z'}))}}});
test('only an explicit exclusive seller domain can support a bounded decision; observed configurations cannot',()=>{
 expect(closedDomain('Probably 128GB or 256GB, maybe upgraded.')).toBeNull();
 expect(boundedDecision(null,[row(128),row(256)],options,at)).toBeNull();
 expect(boundedDecision({...domain,quote:'These are the only capacities in our comp sample.'},[row(128),row(256)],options,at)).toBeNull();
 expect(boundedDecision(domain,[row(128),row(256)],options,at)?.call).toBe('VERIFY');
 expect(boundedDecision(domain,[row(128,'PASS',5000),row(256,'PASS',6000)],options,at)?.call).toBe('PASS');
});

test('the engine preserves the seller uncertainty and risk precedence with exact evidence for every alternative',()=>isolated(`
 import {db,insertComp} from '@/src/db/index.ts';import {runPipeline} from '@/src/engine/index.ts';
 const d=db();d.run("INSERT INTO skus(id,category,brand,model,created_at) VALUES(1,'phone','Apple','iPhone 15',?)",[new Date().toISOString()]);
 for(const capacity of [128,256])for(let i=0;i<6;i++)insertComp({sku_id:1,source:'ebay',source_item_id:String(capacity)+'-'+i,raw_title:'Apple iPhone 15 '+capacity+'GB Factory Unlocked',sold_price_cents:50000,shipping_cents:0,sold_at:new Date().toISOString(),condition_norm:'used',url:'https://ebay.com/itm/'+capacity+i,raw:{soldAt:new Date().toISOString()}});
 const description='Fully working. Factory unlocked. Clean IMEI. Paid off. iCloud removed. Storage is either 128GB or 256GB only.';
 const listing={source:'facebook',sourceId:'bounded',url:'https://facebook.com/marketplace/item/bounded',title:'Apple iPhone 15',description,askingPriceCents:10000,location:null,postedAt:null,photoUrls:[],attributes:{condition:'used'}};
 const result=runPipeline(listing,null).verdict;
 assert.equal(result.call,'VERIFY');assert.equal(result.boundedDecision.domain.length,2);assert.equal(result.valuation.medianCents,null);
 assert.equal(result.provenance.facts.description,description);assert.equal(result.provenance.match.attributes.storage_gb,undefined);
 assert.equal(runPipeline({...listing,description:description+' Does not power on, sold for parts.'},null).verdict.call,'RISK');
 d.run("UPDATE comps SET raw_title='Apple iPhone 14 256GB Unlocked' WHERE source_item_id LIKE '256-%'");
 assert.equal(runPipeline(listing,null).verdict.call,'INSUFFICIENT_DATA');
`));
test('sparse, stale, missing configurations, mixed outcomes and crossing profit ranges remain unresolved',()=>{
 const valid=[row(128),row(256)];
 expect(boundedDecision(domain,valid.slice(0,1),options,at)).toBeNull();
 for(const mutate of [(r:any)=>r.verdict.valuation.compCount=2,(r:any)=>r.verdict.valuation.evidence[0].sold_at='2020-01-01',(r:any)=>r.verdict.valuation.evidence[0].url=null,(r:any)=>r.verdict.valuation.evidence[0].raw_title='Apple iPhone 14 128GB Unlocked',(r:any)=>r.verdict.valuation.evidence.forEach((e:any)=>e.source_item_id='same'),(r:any)=>r.verdict.call='FAIR',(r:any)=>r.verdict.valuation.lowCents=1000]){
  const cases=structuredClone(valid);mutate(cases[1]);expect(boundedDecision(domain,cases,options,at)).toBeNull();
 }
 expect(boundedDecision(domain,valid,{...options,conflict:true},at)).toBeNull();
 expect(boundedDecision(domain,valid,{...options,conditionKnown:false},at)).toBeNull();
 const damaged=structuredClone(valid);damaged[0].verdict.call='RISK';expect(boundedDecision(domain,damaged,options,at)).toBeNull();
});
