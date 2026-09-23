import {describe,test,expect} from 'bun:test';
import {evaluateEvidence,claimKey,type Claim,type Reference,type EvidenceCase} from '../src/vision/evidence-evaluation.ts';
const claim=(v:string,over:Partial<Claim>={}):Claim=>({field:'ram',value:v,quote:v,image:0,role:'module',complete:true,...over});
const ref=(id:string,value:string,over:Partial<Reference>={}):Reference=>({id,field:'ram',role:'module',values:[value],required:true,evidence:[{image:0,text:value,anchors:[value]}],...over});
const item=(references:Reference[]):EvidenceCase=>({id:'fixture',category:'ram',photos:[{path:'a',sha256:'a'},{path:'b',sha256:'b'}],references});
describe('evidence-aware evaluation regressions',()=>{
 test('accepts explicitly equivalent full identity with brand',()=>{
  const r=ref('sku','HMCG66AGBSA092N BA',{field:'partNumber',values:['HMCG66AGBSA092N BA','SK hynix HMCG66AGBSA092N BA'],evidence:[{image:0,text:'SK hynix HMCG66AGBSA092N BA',anchors:['HMCG66AGBSA092N BA']}]});
  expect(evaluateEvidence(item([r]),{fields:[claim('SK hynix HMCG66AGBSA092N BA',{field:'partNumber'})]}).requiredCorrect).toBe(1);
 });
 test('compound DDR generation and form factor are two supported facts',()=>{
  const rs=['DDR5','SODIMM'].map(v=>ref(v,v,{field:'memoryType',evidence:[{image:0,text:'DDR5 SODIMM',anchors:[v]}]}));
  const m=evaluateEvidence(item(rs),{fields:[claim('DDR5 SODIMM',{field:'memoryType'})]});expect(m.correct).toBe(2);expect(m.wrong).toBe(0);
 });
 test('reviewed family alias does not invent an exact SKU',()=>{
  const r=ref('family','Flare X5',{field:'model',values:['Flare X5','G.SKILL Flare X5'],evidence:[{image:0,text:'Flare X5',anchors:['Flare X5']}]});
  expect(evaluateEvidence(item([r]),{fields:[claim('Flare X5',{field:'model'})]}).requiredCorrect).toBe(1);
 });
 test('admitted prefix gets partial coverage but no complete SKU',()=>{
  const r=ref('sku','CP32G60C40U5W.M8B1',{field:'partNumber',partials:['CP32G60C40U5W'],evidence:[{image:0,text:'CP32G60C40U5W.M8B1',anchors:['CP32G60C40U5W.M8B1']}]});
  const m=evaluateEvidence(item([r]),{fields:[claim('CP32G60C40U5W',{field:'partNumber',complete:false})]});expect(m.partial).toBe(1);expect(m.requiredCorrect).toBe(0);expect(m.wrong).toBe(0);
  expect(evaluateEvidence(item([r]),{fields:[claim('CP32G60C40U5W',{field:'partNumber'})]}).wrong).toBe(1);
  expect(evaluateEvidence(item([r]),{fields:[claim('CP32G60C40U5W.M8B1',{field:'partNumber',quote:'CP32G60C40U5W'})]}).correct).toBe(0);
 });
 test('wrong digits or suffixes are not aliases',()=>{
  const m=evaluateEvidence(item([ref('sku','CP32G60C40U5W.M8B1',{field:'partNumber'})]),{fields:[claim('CP32G60C40U5W.MB81',{field:'partNumber'})]});expect(m.correct).toBe(0);expect(m.reviewNeeded).toBe(1);expect(m.acceptanceEligible).toBe(false);
 });
 test('fabricated quote cannot score as grounded',()=>{
  const m=evaluateEvidence(item([ref('r','32GB')]),{fields:[claim('32GB',{quote:'No specifications are readable'})]});expect(m.correct).toBe(0);expect(m.reviewNeeded).toBe(1);
 });
 test('wrong photo attribution cannot score as grounded',()=>{
  const m=evaluateEvidence(item([ref('r','32GB')]),{fields:[claim('32GB',{image:1})]});expect(m.correct).toBe(0);expect(m.reviewNeeded).toBe(1);
 });
 test('out of range photo index is rejected',()=>expect(evaluateEvidence(item([]),{fields:[claim('32GB',{image:9})]}).wrong).toBe(1));
 test('quote on same image must contain relevant evidence anchor',()=>{
  const r=ref('r','32GB',{evidence:[{image:0,text:'32GB DDR5',anchors:['32GB']}]});expect(evaluateEvidence(item([r]),{fields:[claim('32GB',{quote:'DDR5'})]}).correct).toBe(0);
 });
 test('kit total and module capacity do not conflict',()=>{
  const m=evaluateEvidence(item([ref('total','64GB',{role:'kit_total'}),ref('module','32GB')]),{fields:[claim('64GB',{role:'kit_total'}),claim('32GB')]});expect(m.conflicts).toEqual([]);expect(m.correct).toBe(2);
 });
 test('same role contradictory capacities remain conflicts',()=>{
  const m=evaluateEvidence(item([ref('one','8GB'),ref('two','16GB')]),{fields:[claim('8GB'),claim('16GB')]});expect(m.conflicts).toEqual(['ram|module']);expect(m.acceptanceEligible).toBe(false);
 });
 test('definition footnote cannot be assigned to drive capacity',()=>{
  const r=ref('footnote','1TB',{field:'storage',role:'definition',required:false,evidence:[{image:0,text:'1TB = 1 trillion bytes',anchors:['1TB']}]});
  const m=evaluateEvidence(item([r]),{fields:[claim('1TB',{field:'storage',role:'item'})]});expect(m.rows[0].status).toBe('misassigned');expect(m.correct).toBe(0);
 });
 test('missing gold requires review instead of invented falsehood',()=>{
  const m=evaluateEvidence(item([]),{fields:[claim('16GB')]});expect(m.wrong).toBe(0);expect(m.reviewNeeded).toBe(1);expect(m.acceptanceEligible).toBe(false);
 });
 test('duplicates cannot inflate semantic coverage',()=>{
  const r=ref('r','32GB',{evidence:[{image:0,text:'32GB',anchors:['32GB']},{image:1,text:'32GB',anchors:['32GB']}]});
  const m=evaluateEvidence(item([r]),{fields:[claim('32GB'),claim('32GB'),claim('32GB',{image:1})]});expect(m.correct).toBe(1);expect(m.requiredCorrect).toBe(1);
 });
 test('review decisions bind to exact saved claim and require a reason',()=>{
  const c=claim('16GB');const m=evaluateEvidence(item([]),{fields:[c]},[{claimKey:claimKey(c),status:'unsupported',reason:'Source label explicitly says 8GB.'}]);expect(m.wrong).toBe(1);expect(m.reviewNeeded).toBe(0);
  expect(evaluateEvidence(item([]),{fields:[claim('8GB')]},[{claimKey:claimKey(c),status:'unsupported',reason:'Different claim.'}]).wrong).toBe(0);
 });
 test('failed requests never count as abstention',()=>{
  expect(evaluateEvidence(item([]),null).abstained).toBe(false);expect(evaluateEvidence(item([]),{fields:[]}).abstained).toBe(true);
 });
 test('explicit unknown is abstention rather than a fabricated specification',()=>{
  const m=evaluateEvidence(item([]),{fields:[claim('unknown',{complete:false,quote:'N/A'})]});expect(m.abstained).toBe(true);expect(m.wrong).toBe(0);expect(m.reviewNeeded).toBe(0);
 });
 test('unit changes and inferred ECC remain review-required',()=>{
  const m=evaluateEvidence(item([ref('s','6000MT/s',{field:'memorySpeed'})]),{fields:[claim('6000MHz',{field:'memorySpeed'}),claim('ECC',{field:'ecc'})]});expect(m.reviewNeeded).toBe(2);expect(m.correct).toBe(0);
 });
});
