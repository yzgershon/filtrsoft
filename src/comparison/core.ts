import {specifications} from '../engine/specifications.ts';
import type {DecisionProvenance} from '../engine/provenance.ts';
import {externalGamingReference,manufacturerReference} from './references.ts';
import type {BenchmarkSnapshot,CompareMetric,CompareResult,CompareSide,HardwareMatch,PartKind,ReferenceScore,Workload} from './types.ts';

const clean=(s:string)=>s.toLowerCase().replace(/[®™]/g,'').replace(/\s+/g,' ').trim();
const CPU=/\b(?:ryzen\s+(?:[3579]\s+)?(?:pro\s+)?\d{4,5}[a-z0-9]*|(?:core\s+)?i[3579][ -]?\d{4,5}[a-z0-9]*|core\s+ultra\s+[579]\s+\d{3}[a-z]*|(?:ryzen\s+)?threadripper\s+(?:pro\s+)?\d{4,5}[a-z]*|apple\s+m[1-9](?:\s+(?:pro|max|ultra))?)\b/gi;
const GPU=/\b(?:(?:rtx|gtx|rx)\s*\d{3,4}\s*(?:ti\s*super|super|ti|xtx|xt|gre|d(?:\s*v2)?|m(?:\s*xt)?)?|arc\s+[ab]\d{3})\b/gi;
const unsupportedDevice=/\b(?:\d+\s*[x×]\s*(?:nvidia|amd|intel|geforce|radeon)|engineering sample|eng sample|engineering|virtual|qemu)\b/i;
function modelTokens(text:string,kind:PartKind):string[]{
  if(kind!=='cpu'&&kind!=='gpu')return [];
  if(kind==='gpu'&&/\b(?:quadro|ada|rtx pro|rtx a\d)|\brtx\s*[1-9]000\b/i.test(text))return [];
  return [...text.matchAll(new RegExp((kind==='cpu'?CPU:GPU).source,'gi'))].map(m=>clean(m[0]).replace(/^core (i[3579])/,'$1').replace(/^(rtx|gtx|rx|arc)\s*/,'$1 ').replace(/\s+/g,' ').replace(/i([3579])\s*-?\s*(\d)/,'i$1-$2').trim());
}
const displayModel=(s:string)=>s.replace(/\b(rtx|gtx|rx|xtx|xt|ti|super|arc|pro|max|ultra|ryzen|threadripper|apple)\b/g,v=>['rtx','gtx','rx','xtx','xt'].includes(v)?v.toUpperCase():v[0].toUpperCase()+v.slice(1)).replace(/(\d)(x3d|xt|kf|ks|hx|hs|x|g|f|k|h|u|t)\b/gi,(_,n,s)=>n+s.toUpperCase());
const fieldValues=(side:CompareSide,key:string)=>side.specs.fields.find(f=>f.key===key)?.values??[];
export const comparisonCategories:Record<PartKind,string[]>={gpu:['gpu','prebuilt','laptop'],cpu:['component','prebuilt','laptop'],ram:['ram','component','prebuilt','laptop'],storage:['storage','ram','component','prebuilt','laptop'],motherboard:['motherboard','component','prebuilt'],psu:['psu','component','prebuilt']};
export function hardwareMatch(specs:ReturnType<typeof specifications>,kind:PartKind,category:string):HardwareMatch {
  const evidence=specs.fields.find(f=>f.key===kind)?.values??[];
  if(!comparisonCategories[kind].includes(category))return {identity:null,state:'unknown',form:'unknown',evidence,reason:'This component is not established as included in this listing category.'};
  // The display extractor may keep a compact token while its literal quote
  // retains D V2, GRE or another suffix. A shortened token must never inherit
  // the base model's benchmark. Conflicts stay visible instead of guessing.
  const tokens=[...new Set(evidence.flatMap(v=>[...modelTokens(v.value,kind),...modelTokens(v.quote,kind)]))];
  const text=evidence.map(v=>v.value+' '+v.quote).join(' '),portable=/\b(?:laptop|notebook|mobile|max-q)\b/i.test(text)||(kind==='cpu'&&tokens.some(t=>/\d(?:hx|hs|h|u)\b/i.test(t)));
  const form=portable||category==='laptop'?'laptop':['gpu','component','prebuilt','ram','storage','motherboard','psu'].includes(category)?'desktop':'unknown';
  if(kind!=='cpu'&&kind!=='gpu')return {identity:evidence.length?evidence.map(v=>v.value).filter((v,i,a)=>a.indexOf(v)===i).join(' / '):null,state:evidence.length?'identified':'unknown',form,evidence,reason:evidence.length?null:'The seller has not supplied this part’s specifications.'};
  if(tokens.length!==1)return {identity:tokens.length?tokens.map(displayModel).join(' / '):null,state:tokens.length?'ambiguous':'unknown',form,evidence,reason:tokens.length?'The recorded sources name different variants. Confirm the exact part before using a benchmark.':'No exact model is recorded for this component.'};
  if(kind==='gpu'){
    const capacities=[...new Set([...evidence,...(specs.fields.find(f=>f.key==='vram')?.values??[])].flatMap(v=>[...v.value.matchAll(/\b(\d{1,2})\s*GB\b/gi)].map(m=>Number(m[1]))).concat(evidence.flatMap(v=>[...v.quote.matchAll(new RegExp(GPU.source+'\\s+(\\d{1,2})\\s*GB\\b','gi'))].map(m=>Number(m[1])))))];
    if(capacities.length>1)return {identity:displayModel(tokens[0]),state:'ambiguous',form,evidence,reason:'Recorded GPU memory capacities conflict. Confirm the exact memory variant before comparing performance.'};
  }
  if(portable&&category==='prebuilt')return {identity:displayModel(tokens[0]),state:'ambiguous',form,evidence,reason:'A desktop listing names a laptop component. Confirm its form factor and power configuration.'};
  return {identity:displayModel(tokens[0]),state:'identified',form,evidence,reason:null};
}

function benchmark(side:CompareSide,kind:PartKind,data:BenchmarkSnapshot):{reference:ReferenceScore|null;reason:string|null}{
  if(!['gpu','cpu'].includes(kind))return {reference:null,reason:'Compare the reported specifications. There is no universal performance score for these parts.'};
  if(side.hardware.state!=='identified')return {reference:null,reason:side.hardware.reason};
  if(side.hardware.form==='unknown')return {reference:null,reason:'Desktop or laptop form factor is not established.'};
  const identity=modelTokens(side.hardware.identity!,kind)[0];
  const rows=data.rows.filter(row=>{
    if(unsupportedDevice.test(row.device)||/^\s*\d+\s*[x×]\s*/i.test(row.device))return false;
    const tokens=modelTokens(row.device,kind);if(tokens.length!==1||tokens[0]!==identity)return false;
    if(kind==='cpu')return row.backend==='CPU';
    const laptop=/laptop|notebook|mobile/i.test(row.device);
    return laptop===(side.hardware.form==='laptop')&&['OPTIX','HIP','ONEAPI','CUDA'].includes(row.backend);
  });
  // Prefer the supported Cycles backend, not whichever noisy row has the largest
  // score. All cohorts remain Windows + one benchmark version. Submissions are
  // not independent machines and do not establish a statistical confidence %.
  const priority=['OPTIX','HIP','ONEAPI','CUDA','CPU'];
  rows.sort((a,b)=>priority.indexOf(a.backend)-priority.indexOf(b.backend)||b.submissions-a.submissions);
  const row=rows.find(r=>r.submissions>=10);
  if(!row)return {reference:null,reason:rows.length?'Fewer than 10 matching benchmark submissions. No score is assigned.':'No matching benchmark is available for this exact model and form factor.'};
  // Driver names collapse multiple materially different memory versions. Keep
  // the family observation visible but never award an exact-variant winner.
  const mixed=kind==='gpu'&&/^(?:rtx (?:2060|3060|3060 ti|3050|3080|4060 ti|4070|5060 ti)|gtx (?:1060|1650|1660)|rx (?:570|580|550|560))$/i.test(identity);
  const laptop=side.hardware.form==='laptop';
  const scope=mixed||laptop||/^apple /i.test(identity)?'family':'model';
  const note=mixed?'This benchmark name combines memory variants. It is family context, not an exact-variant score.':laptop?'Laptop power limits and cooling vary. This is a model-family reference, not a test of this laptop.':'Reference hardware submissions, not a benchmark of the seller’s physical item. Board clocks, cooling and condition can change results.';
  const u=new URL(data.source.url);u.searchParams.append('device_name',row.device);u.searchParams.append('compute_type',row.backend);
  return {reference:{value:row.median,unit:'samples/min',submissions:row.submissions,device:row.device,backend:row.backend,suite:data.suite,os:data.os,sourceUrl:u.href,scope,note},reason:null};
}

export function safeSellerUrl(raw:string,source:string):string|null {
  try{const u=new URL(raw);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return null;const host=u.hostname.toLowerCase();
    const domain=({facebook:'facebook.com',craigslist:'craigslist.org',offerup:'offerup.com',mercari:'mercari.com'} as Record<string,string>)[source];
    return domain&&(host===domain||host.endsWith('.'+domain))?u.href:null;
  }catch{return null;}
}
export interface StoredCompareRow {id:number;title:string;description?:string;url:string;source:string;asking_price_cents:number|null;location:string|null;posted_at:string|null;last_seen:string|null;captured_at:string|null;delisted_at:string|null;payload:string|null;assessed_at:string|null;dismissed?:number;pending_recheck?:number;photoUrls?:string[]}
const strings=(v:unknown):string[]=>Array.isArray(v)?v.filter((s):s is string=>typeof s==='string'):[];
const records=(v:unknown):any[]=>Array.isArray(v)?v.filter(s=>s&&typeof s==='object'&&!Array.isArray(s)):[];
const stringRecord=(v:unknown):Record<string,string>=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).filter(([,s])=>typeof s==='string')):{};
function recordedProof(v:any):DecisionProvenance|undefined {
  if(!v||typeof v.facts?.title!=='string'||typeof v.facts?.description!=='string'||typeof v.signals?.category!=='string')return;
  return {...v,facts:{...v.facts,attributes:stringRecord(v.facts.attributes),photoUrls:strings(v.facts.photoUrls)},signals:{...v.signals,signals:records(v.signals.signals).filter(s=>typeof s.code==='string'&&typeof s.evidence==='string')},visionEvidence:v.visionEvidence&&typeof v.visionEvidence==='object'?{...v.visionEvidence,components:stringRecord(v.visionEvidence.components),facts:records(v.visionEvidence.facts).filter(f=>typeof f.fact==='string'&&['string','number'].includes(typeof f.photo)&&typeof f.confidence==='string'),unreadable:strings(v.visionEvidence.unreadable)}:null};
}
export function comparisonSide(row:StoredCompareRow,kind:PartKind,data:BenchmarkSnapshot,now=Date.now(),includeBenchmark=true):CompareSide {
  let verdict:any=null;try{verdict=JSON.parse(row.payload??'null');}catch{}
  const storedProof=recordedProof(verdict?.provenance);
  // Facts can be replaced before the queued verdict finishes. Never pair an
  // older expensive part identity with the new listing's cheaper asking price.
  const changed=!!row.pending_recheck||!!storedProof&&(row.title!==storedProof.facts.title||(row.description!==undefined&&row.description!==storedProof.facts.description)||('askingPriceCents' in storedProof.facts&&row.asking_price_cents!==storedProof.facts.askingPriceCents));
  const proof=changed?undefined:storedProof,category=proof?.signals?.category??'unknown';
  const specs=verdict?.inventory?{fields:[],notes:['Inventory offers must be compared individually; the headline is not a component price.'],photoStatus:'not_read' as const,attributes:[]}:specifications(proof);
  const observedAt=row.last_seen??row.captured_at,latest=Date.parse(row.posted_at??observedAt??'');
  const status=row.dismissed?'removed':row.delisted_at?'gone':!Number.isFinite(latest)||latest<now-28*86400000?'stale':changed?'updating':'active';
  if(changed)specs.notes=['The listing changed after its last assessment. Specifications and performance are withheld until the queued assessment finishes.'];
  const prices=verdict?.inventory?null:row.asking_price_cents;
  const included=specs.fields.filter(f=>f.values.length).map(f=>f.key);
  const partBundle=(kind==='gpu'&&included.some(k=>['cpu','motherboard'].includes(k)))||(kind==='cpu'&&included.some(k=>['gpu','motherboard'].includes(k)));
  const side:CompareSide={id:row.id,title:proof?.facts?.title??row.title,url:safeSellerUrl(row.url,row.source),source:row.source,
    priceCents:typeof prices==='number'&&Number.isSafeInteger(prices)&&prices>=0?prices:null,location:row.location,photoUrls:strings(proof?.facts?.photoUrls?.length?proof.facts.photoUrls:row.photoUrls).slice(0,4),status,observedAt,assessedAt:row.assessed_at,category,
    call:!changed&&typeof verdict?.call==='string'?verdict.call:null,worthCents:!changed&&Number.isFinite(verdict?.valuation?.medianCents)?verdict.valuation.medianCents:null,
    concerns:changed?[]:[...(proof?.signals?.signals??[]).filter((s:any)=>s.polarity!=='positive').map((s:any)=>({label:s.code.replaceAll('_',' '),detail:s.evidence})),...records(verdict?.riskChecks).filter(r=>r.state==='failed'&&typeof r.label==='string').map(r=>({label:r.label,detail:typeof r.evidence==='string'?r.evidence:'Disclosed defect'}))].slice(0,10),
    questions:changed?[]:strings(verdict?.questions).slice(0,10),specs,hardware:hardwareMatch(specs,kind,category),reference:null,benchmarkReason:null,manufacturer:null,
    standalone:!verdict?.inventory&&!partBundle&&!/\b(?:[2-9]\d*\s*[x×]\s*(?:rtx|gtx|rx|ryzen|intel|nvidia|amd|geforce)|pair of|lot of|bundle|combo|gaming (?:pc|computer|desktop)|(?:two|three|four|multiple)\b[^.;\n]{0,50}\b(?:cards|gpus|processors|cpus))\b/i.test([proof?.facts?.title??row.title,proof?.facts?.description,...specs.fields.find(f=>f.key===kind)?.values.map(v=>v.value+' '+v.quote)??[]].join(' '))&&(category===kind||(kind==='cpu'&&category==='component'))};
  if(includeBenchmark){const b=benchmark(side,kind,data);side.reference=b.reference;side.benchmarkReason=b.reason;side.manufacturer=manufacturerReference(side);}
  return side;
}
function metricFields(kind:PartKind):Array<[string,string]>{
  return ({gpu:[['gpu','Graphics card'],['vram','Graphics memory'],['psu','Power supply']],cpu:[['cpu','Processor'],['ram','Memory'],['motherboard','Motherboard'],['cooling','Cooling']],ram:[['ram','Memory / kit'],['motherboard','Motherboard']],storage:[['storage','Drives / capacity']],motherboard:[['motherboard','Motherboard'],['cpu','Processor'],['ram','Memory']],psu:[['psu','Power supply'],['gpu','Graphics card']]} as Record<PartKind,Array<[string,string]>>)[kind];
}
const formatPrice=(v:number|null)=>v===null?null:(v/100).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:v%100?2:0});
export function compareSides(sides:CompareSide[],kind:PartKind,workload:Workload,data:BenchmarkSnapshot):CompareResult {
  const both=sides.length===2,a=sides[0],b=sides[1];
  const metrics:CompareMetric[]=metricFields(kind).map(([key,label])=>({key,label,direction:null,values:[a,b].map(side=>side?[...new Set(fieldValues(side,key).map(v=>v.value))].join(' / ')||null:null) as [string|null,string|null]}));
  metrics.push({key:'asking',label:'Listing asking price',values:[formatPrice(a?.priceCents??null),formatPrice(b?.priceCents??null)],direction:'lower',numeric:[a?.priceCents??null,b?.priceCents??null],note:sides.some(s=>!s.standalone)?'Whole-system or bundle ask. This is not a standalone component price.':undefined});
  metrics.push({key:'worth',label:'Estimated resale',values:[formatPrice(a?.worthCents??null),formatPrice(b?.worthCents??null)],direction:null,note:'Existing sold-price valuation for the listing. Separate from hardware performance.'});
  let reason=!both?'Choose two listings to compare.':workload==='gaming'?'A verified gaming benchmark feed is not connected. No gaming score or FPS is inferred from rendering or specifications.':!['gpu','cpu'].includes(kind)?'Specifications describe different capabilities; combining them into a speed score would be misleading.':sides.some(s=>s.status!=='active')?'A selected listing is unavailable, stale or removed. Refresh its source before deciding.':sides.find(s=>!s.reference)?.benchmarkReason??sides.find(s=>s.reference?.scope!=='model')?.reference?.note??'';
  const eligible=both&&!reason;
  const values:[number|null,number|null]=eligible?[a.reference!.value,b.reference!.value]:[null,null];
  const peak=eligible?Math.max(values[0]!,values[1]!):0;
  const leader:0|1|null=eligible&&Math.abs(values[0]!-values[1]!)>.00001?(values[0]!>values[1]!?0:1):null;
  const indices=values.map(v=>v===null?null:Math.round(v/peak*1000)/10) as [number|null,number|null];
  const comparableValues=eligible&&sides.every(s=>s.standalone&&s.priceCents!==null&&s.priceCents>0);
  let valueIndices:[number|null,number|null]=[null,null],valueLeader:0|1|null=null;
  if(comparableValues){const perDollar=sides.map(s=>s.reference!.value/(s.priceCents!/100)),max=Math.max(...perDollar);valueIndices=perDollar.map(v=>Math.round(v/max*1000)/10) as [number,number];valueLeader=Math.abs(perDollar[0]-perDollar[1])<.00001?null:perDollar[0]>perDollar[1]?0:1;}
  return {version:1,kind,workload,sides,metrics,externalGaming:externalGamingReference(sides,kind),score:{state:eligible?'comparable':'unavailable',indices,leader,advantagePercent:eligible?Math.round((peak/Math.min(values[0]!,values[1]!)-1)*1000)/10:null,reason:reason||'Pair-relative index: faster reference = 100. Same benchmark version and operating system; backend is shown for each part.',label:workload==='gaming'?'Gaming performance':'Cycles rendering'},value:{indices:valueIndices,leader:valueLeader,reason:comparableValues?'Benchmark throughput per dollar at each standalone component’s asking price.':eligible?'Value scoring requires two standalone parts with explicit positive asking prices.':'Value scoring needs comparable performance evidence first.'},reference:{revision:data.revision,retrievedAt:data.retrievedAt,suite:data.suite,os:data.os,...data.source}};
}
