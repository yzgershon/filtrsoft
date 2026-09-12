import {test,expect} from 'bun:test';
import {comparisonSide,compareSides,safeSellerUrl} from '../src/comparison/core.ts';
import type {BenchmarkSnapshot,PartKind} from '../src/comparison/types.ts';
const now=Date.parse('2026-09-09T12:00:00Z'),at=new Date(now).toISOString();
const snapshot:BenchmarkSnapshot={version:1,revision:'test',retrievedAt:at,suite:'Blender 4.5.0',os:'Windows',source:{name:'Fixture',url:'https://opendata.blender.org/benchmarks/query/?blender_version=4.5.0&response_type=datatables',license:'CC0',licenseUrl:'https://opendata.blender.org/about/'},rows:[
  {device:'NVIDIA GeForce RTX 3070',backend:'OPTIX',median:2000,submissions:20},
  {device:'NVIDIA GeForce RTX 3070 Ti',backend:'OPTIX',median:3000,submissions:40},
  {device:'NVIDIA GeForce RTX 3070 Ti',backend:'CUDA',median:9000,submissions:40},
  {device:'NVIDIA GeForce RTX 3060',backend:'OPTIX',median:1000,submissions:40},
  {device:'NVIDIA GeForce RTX 5090',backend:'OPTIX',median:8000,submissions:40},
  {device:'NVIDIA GeForce RTX 4070 Laptop GPU',backend:'OPTIX',median:1600,submissions:40},
  {device:'AMD Ryzen 7 5800X 8-Core Processor',backend:'CPU',median:200,submissions:30},
  {device:'2 x NVIDIA GeForce RTX 4090',backend:'OPTIX',median:12000,submissions:90},
]};
function side(title:string,description='',category='gpu',price:number|null=20000,kind:PartKind='gpu',extra:any={}){
  return comparisonSide({id:1,title,source:'craigslist',url:'https://boston.craigslist.org/gbs/sop/d/card/1234567890.html',asking_price_cents:price,location:null,posted_at:at,last_seen:at,captured_at:at,delisted_at:null,assessed_at:at,payload:JSON.stringify({provenance:{facts:{title,description,attributes:{}},signals:{category,signals:[]},visionEvidence:null},call:'VERIFY',...extra})},kind,snapshot,now);
}
test('Rendering uses a pinned cohort and preferred backend with transparent relative math',()=>{
  const a=side('RTX 3070'),b=side('RTX 3070 Ti','', 'gpu',40000),r=compareSides([a,b],'gpu','rendering',snapshot);
  expect(b.reference?.backend).toBe('OPTIX');expect(b.reference?.value).toBe(3000);
  expect(b.reference?.sourceUrl).not.toContain('response_type=');
  expect(r.score.indices).toEqual([66.7,100]);expect(r.score.advantagePercent).toBe(50);expect(r.score.leader).toBe(1);
  expect(r.value.indices).toEqual([100,75]);expect(r.value.leader).toBe(0);
  expect(compareSides([a,a],'gpu','rendering',snapshot).score.leader).toBeNull();
});
test('Gaming never inherits rendering numbers or seller FPS claims',()=>{
  const r=compareSides([side('RTX 3070','Runs every game at 300 FPS'),side('RTX 4070')],'gpu','gaming',snapshot);
  expect(r.score.state).toBe('unavailable');expect(r.score.indices).toEqual([null,null]);expect(r.value.leader).toBeNull();
});
test('compact GPU suffixes match their exact spaced model without collapsing variants',()=>{
  expect(side('RTX3070ti').hardware.identity).toBe('RTX 3070 Ti');
  expect(side('RTX3070ti').reference?.value).toBe(3000);
  expect(side('RTX3070ti','GPU: RTX 3070 Ti').hardware.state).toBe('identified');
  expect(side('RTX3070ti','GPU: RTX 3070').hardware.state).toBe('ambiguous');
  expect(side('RTX5090dv2').reference).toBeNull();
  expect(side('RX7900xtx').hardware.identity).toContain('XTX');
});
test('Literal suffix and memory conflicts cannot inherit a base-model score',()=>{
  expect(side('RTX 5090 D V2').reference).toBeNull();
  expect(side('RTX 4070 12GB','GPU: RTX 4070 16GB').hardware.state).toBe('ambiguous');
  expect(side('RTX 4070 12GB','GPU: RTX 4070 16GB').reference).toBeNull();
  expect(side('RTX 4070','GPU: RTX 4070 Ti Super').reference).toBeNull();
  expect(side('Gaming PC RTX 4070 12GB / 32GB RAM','', 'prebuilt').hardware.state).toBe('identified');
});
test('Multi-card, bundle and whole-machine asks do not get part value scores',()=>{
  for(const description of ['GPU: 2x RTX 3070','Selling two RTX 3070 cards together','This bundle includes an RTX 3070, Ryzen 7 5800X and motherboard','This is a gaming PC with RTX 3070 and Ryzen 7 5800X']){
    const a=side('RTX 3070',description),r=compareSides([a,side('RTX 3070 Ti')],'gpu','rendering',snapshot);
    expect(a.standalone).toBe(false);expect(r.value.indices).toEqual([null,null]);
  }
  expect(side('RTX 3070','GPU: 1x RTX 3070').standalone).toBe(true);
  expect(side('PC RTX 3070','','prebuilt').standalone).toBe(false);
});
test('Unknown price, placeholder inventory, category mismatch and multi-device results stay unscored',()=>{
  expect(compareSides([side('RTX 3070','','gpu',0),side('RTX 4070')],'gpu','rendering',snapshot).value.indices).toEqual([null,null]);
  expect(side('RTX 3070','','gpu',100,'gpu',{inventory:{offers:[]}}).priceCents).toBeNull();
  expect(side('RTX 4090').reference).toBeNull();
  expect(side('RTX 3070','CPU: Ryzen 7 5800X','gpu',20000,'cpu').reference).toBeNull();
});
test('Laptop and collapsed memory families remain context, never exact-variant winners',()=>{
  const laptop=side('RTX 4070 Laptop','','laptop');expect(laptop.reference?.scope).toBe('family');
  expect(laptop.reference?.value).toBe(1600);
  const family=side('RTX 3060 12GB');expect(family.reference?.scope).toBe('family');
  expect(compareSides([family,side('RTX 4070')],'gpu','rendering',snapshot).score.state).toBe('unavailable');
  expect(side('Ryzen 7 5800X','','component',15000,'cpu').reference?.value).toBe(200);
});
test('Part specifications retain layouts and have no arbitrary aggregate score',()=>{
  const a=side('RAM','RAM: 32GB DDR5 6000 (2x16GB)','ram',10000,'ram');
  expect(a.hardware.identity).toContain('2x16GB');expect(a.reference).toBeNull();
  expect(compareSides([a,a],'ram','rendering',snapshot).score.state).toBe('unavailable');
});
test('Seller links stay on the recorded platform with no guessed message destination',()=>{
  expect(safeSellerUrl('https://www.facebook.com/marketplace/item/123/','facebook')).toContain('/item/123/');
  for(const url of ['javascript:alert(1)','https://facebook.com.evil.test/','https://evil.test@facebook.com/','https://craigslist.org/'])expect(safeSellerUrl(url,'facebook')).toBeNull();
});
test('External model links retain provider IDs and do not substitute laptop or suffix variants',()=>{
 const gpu=compareSides([side('RTX 3070'),side('RTX 4070')],'gpu','gaming',snapshot);
 expect(gpu.externalGaming?.url).toBe('https://gpu.userbenchmark.com/Compare/Nvidia-RTX-3070-vs-Nvidia-RTX-4070/4083vs4148');
 expect(compareSides([side('RTX 3070 Ti'),side('RTX 4070')],'gpu','gaming',snapshot).externalGaming).toBeNull();
 expect(compareSides([side('RTX 3070','','laptop'),side('RTX 4070')],'gpu','gaming',snapshot).externalGaming).toBeNull();
 const a=side('Ryzen 5 7600X3D','','component',20000,'cpu'),b=side('Ryzen 7 5800X','','component',15000,'cpu');
 expect(compareSides([a,b],'cpu','gaming',snapshot).externalGaming?.url).toContain('/m2342631vs4085');
 expect(a.manufacturer?.metrics.cache).toBe('96 MB');expect(b.manufacturer?.metrics.socket).toBe('AM4');
 expect(side('RTX 5090 D V2').manufacturer).toBeNull();
 expect(side('RTX 3070').specs.fields.find(f=>f.key==='vram')?.values).toEqual([]);
});
