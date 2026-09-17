import {test,expect} from 'bun:test';
import {isolated} from './isolated.ts';
import {evaluateRisk} from '../src/verdict/risk-gates.ts';
import {textFacts} from '../src/signals/factual-text.ts';
import {parseOfferUpDetail} from '../src/sources/marketplace.ts';
import {extractAttributes} from '../src/catalog/match.ts';
import {compMatchesQuery} from '../src/sources/ebay.ts';
import {exactDemandQuery} from '../src/sources/comp-priority.ts';
import {visionSignals} from '../src/vision/merge.ts';

test('a hidden bracket is unknown, not proof the card has no display outputs',()=>{
  const v:any={components:{},facts:[],specScreens:[],displayOutputsVisible:false,physicalDamage:[],portCondition:'Connectors not fully visible in image; bracket appears to have vented grille design typical of datacenter cards with no display outputs visible.'};
  expect(visionSignals(v).some(s=>s.code==='NO_DISPLAY_OUTPUT')).toBe(false);
  expect(evaluateRisk('gpu','AMD Radeon Pro WX 3200 Graphics Card',v).find(r=>r.code==='DISPLAY_OUTPUTS')?.state).toBe('unresolved');
  v.portCondition='The full I/O bracket is visible and has no display connectors.';
  expect(visionSignals(v).some(s=>s.code==='NO_DISPLAY_OUTPUT')).toBe(true);
  expect(evaluateRisk('gpu','Mining card',v).find(r=>r.code==='DISPLAY_OUTPUTS')?.state).toBe('failed');
});

test('equivalent CPU punctuation is not a conflict, while suffix differences remain conflicts',()=>{
  expect(textFacts('Intel Core i5-10400F SRH3D CPU. For sale: Intel Core i5 10400F.').conflicts).not.toContain('cpu');
  expect(textFacts('Intel i5-10400. Intel i5 10400F.').conflicts).toContain('cpu');
});

test('component dimensions, GPU bandwidth and laptop memory kits are not machine storage or displays',()=>{
  const gpu=extractAttributes('nVIDIA Quadro RTX 5000 16GB graphics card\nMemory Configuration 16 GB Memory Bandwidth 448 GB/s Display Support Display Connectors 4 x DisplayPort 1.4 Dimensions Height 4.4" Length 10.5"');
  expect(gpu.screen_inches).toBeUndefined();expect(gpu.storage_gb).toBeUndefined();expect(gpu.ram_gb).toBeUndefined();expect(gpu.vram_gb).toBe(16);
  expect(extractAttributes('NVIDIA RTX A2000 Graphics Card 6gb').storage_gb).toBeUndefined();
  const kit=extractAttributes('Samsung PC4-2133P 2x16GB Laptop memory\nPair of matching 16GB memory modules. Sold as pair total 32GB.');
  expect(kit).toMatchObject({ram_gb:32,kit_layout:'2x16',quantity:2});expect(kit.storage_gb).toBeUndefined();
  expect(extractAttributes('MacBook Air 13" M5 16GB RAM 512GB SSD')).toMatchObject({screen_inches:13,storage_gb:512});
  expect(extractAttributes('Samsung Galaxy S24 256GB')).toMatchObject({storage_gb:256});
});

test('store financing availability is not an outstanding balance; a separate debt still fails',()=>{
  const state=(s:string)=>evaluateRisk('phone',s,null).find(r=>r.code==='FINANCING')?.state;
  expect(state('Store warranty and financing available')).toBe('unresolved');
  expect(state('We offer financing. Phone is not paid off.')).toBe('failed');
  expect(state('Still financed with monthly payments')).toBe('failed');
  expect(state('Paid off in full. Financing available')).toBe('resolved');
  expect(textFacts('Apple iPhone 14 pro, 256gb\nDevice Name\niPhone 14 Plus').conflicts).toContain('phoneModel');
});
test('OfferUp accessibility instructions are excluded without dropping seller paragraphs',()=>{
  expect(parseOfferUpDetail('Description\nSelling my MacBook.\n\n512GB SSD\nSee less\nAll content is available to screen readers from the outset. The See more button is for visual users only\nDetails\nCondition\nUsed').description).toBe('Selling my MacBook.\n\n512GB SSD');
});
test('explicit laptop display and GPU core configurations survive query and comp matching',()=>{
  const sku={brand:'Apple',model:'MacBook Air M5',category:'laptop'};
  const attributes=extractAttributes('Apple MacBook Air 13” M5 16GB RAM 512GB SSD 8-core GPU');
  expect(attributes).toMatchObject({screen_inches:13,gpu_cores:8});
  const query=exactDemandQuery(sku,attributes);
  expect(query).toContain('13-inch 8-core GPU');
  expect(compMatchesQuery('NEW LISTINGApple MacBook Air 13" M5 16GB RAM 512GB SSD 8C GPU',query,'laptop').ok).toBe(true);
  for(const title of ['Apple MacBook Air 15" M5 16GB RAM 512GB SSD 8C GPU','Apple MacBook Air 13" M5 16GB RAM 512GB SSD 10C GPU','Apple MacBook Air M5 16GB RAM 512GB SSD'])expect(compMatchesQuery(title,query,'laptop').ok).toBe(false);
  expect(compMatchesQuery('NEW LISTINGApple iPhone 16 Pro Max 256GB','Apple iPhone 16 Pro Max','phone').ok).toBe(true);
});
test('legacy laptop comps cannot mix screen size, omit a requested core count, or substitute GPU cores',()=>isolated(`
 import {db,insertComp,now} from '@/src/db/index.ts';import {valueSku} from '@/src/valuation/index.ts';
 const d=db(),soldAt=new Date(Date.now()-86400000).toISOString();
 d.run("INSERT INTO skus(id,category,brand,model,attributes,created_at) VALUES(1,'laptop','Apple','MacBook Air M5','{}',?)",[now()]);
 const titles=['Apple MacBook Air 13" M5 16GB RAM 512GB SSD 8-core GPU','Apple MacBook Air 15" M5 16GB RAM 512GB SSD 8-core GPU','Apple MacBook Air 13" M5 16GB RAM 512GB SSD 10-core GPU','Apple MacBook Air M5 16GB RAM 512GB SSD'];
 titles.forEach((raw_title,i)=>insertComp({source:'ebay',source_item_id:String(i),sku_id:1,raw_title,sold_price_cents:50000,sold_at:soldAt,condition_norm:'used',raw:{soldAt}}));
 const v=valueSku(1,{category:'laptop',attributes:{cpu:'m5',ram_gb:16,storage_gb:512,screen_inches:13,gpu_cores:8}});
 assert.equal(v.compCount,1);assert.equal(d.query('SELECT COUNT(*) n FROM comps').get().n,4);
`));
