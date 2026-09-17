import type {VerdictResult} from './index.ts';
import {netByChannel,requiredProfitCents,type UserEconomics} from '../valuation/index.ts';
import {extractAttributes} from '../catalog/match.ts';
import {compMatchesQuery} from '../sources/ebay.ts';
import {storageOf} from '../valuation/index.ts';

export interface ClosedDomain {field:'storage_gb'|'ram_gb';values:number[];quote:string;basis:'seller-explicit-closed-list'}
/** Only explicit exclusive alternatives establish a domain. Observed comp
 * configurations, model memory and a vague "maybe" never close the set. */
export function closedDomain(text:string):ClosedDomain|null {
  const matches=[...text.matchAll(/\b(storage|ram)\s+(?:is|:)\s*either\s+(\d{1,4})\s*(GB|TB)\s+or\s+(\d{1,4})\s*(GB|TB)\s+only\s*(?:[.;]|$)/gim)];
  if(matches.length!==1)return null;const m=matches[0];
  const values=[Number(m[2])*(m[3].toLowerCase()==='tb'?1024:1),Number(m[4])*(m[5].toLowerCase()==='tb'?1024:1)];
  if(values[0]===values[1]||values.some(n=>n<=0||n>4096))return null;
  return {field:m[1].toLowerCase()==='ram'?'ram_gb':'storage_gb',values:values.sort((a,b)=>a-b),quote:m[0],basis:'seller-explicit-closed-list'};
}
export interface BoundedDecision {version:1;field:string;domain:number[];quote:string;basis:string;call:'PASS'|'VERIFY';lowCents:number;highCents:number;profitLowCents:number;profitHighCents:number;configurations:Array<{value:number;compIds:number[]}>;limitation:string}
export function boundedDecision(domain:ClosedDomain|null,cases:Array<{value:number;verdict:VerdictResult}>,opts:{category:string;ask:number|null;econ:UserEconomics;drive:number;conflict:boolean;conditionKnown:boolean},at=Date.now()):BoundedDecision|null {
  if(!domain||domain.basis!=='seller-explicit-closed-list'||opts.ask==null||opts.conflict||!opts.conditionKnown)return null;
  const proof=closedDomain(domain.quote);if(!proof||proof.field!==domain.field||JSON.stringify(proof.values)!==JSON.stringify(domain.values))return null;
  if(!(['phone','tablet'].includes(opts.category)&&domain.field==='storage_gb'||opts.category==='laptop'&&domain.field==='ram_gb'))return null;
  if(cases.length!==domain.values.length||new Set(cases.map(c=>c.value)).size!==domain.values.length||domain.values.some(n=>!cases.some(c=>c.value===n)))return null;
  for(const {value,verdict:v} of cases){const evidence=v.valuation.evidence??[];
    if(!['BUY','VERIFY','PASS'].includes(v.call)||v.blockers.length||v.riskChecks.some(c=>c.state!=='resolved')||v.valuation.status!=='ok'||v.valuation.compCount<5||evidence.length<5||v.valuation.lowCents==null||v.valuation.highCents==null)return null;
    if(evidence.some(c=>!c.url||c.source!=='ebay'||!['used','open_box','refurbished','new'].includes(c.condition_norm??'')||!Number.isFinite(Date.parse(c.sold_at))||Date.parse(c.sold_at)>at||at-Date.parse(c.sold_at)>90*86400000))return null;
    const match=v.provenance?.match;
    if(!match?.skuId||match.confidence==='low'||!match.brand||!match.model||Number(match.attributes[domain.field])!==value)return null;
    if(new Set(evidence.map(e=>`${e.source}:${e.source_item_id}`)).size<5)return null;
    for(const comp of evidence){
      if(!compMatchesQuery(comp.raw_title,`${match.brand} ${match.model}`,opts.category).ok)return null;
      const got=extractAttributes(comp.raw_title);
      if((domain.field==='storage_gb'?storageOf(comp.raw_title):Number(got.ram_gb))!==value)return null;
      if(opts.category==='laptop'&&['cpu','gpu','storage_gb'].some(k=>match.attributes[k]!=null&&String(got[k]).toLowerCase()!==String(match.attributes[k]).toLowerCase()))return null;
    }
  }
  const lowCents=Math.min(...cases.map(c=>c.verdict.valuation.lowCents!)),highCents=Math.max(...cases.map(c=>c.verdict.valuation.highCents!));
  const net=(value:number)=>netByChannel(value,opts.category).find(c=>c.channel===opts.econ.prefers_channel&&c.available)?.netCents;
  const low=net(lowCents),high=net(highCents);if(low==null||high==null)return null;
  const profitLowCents=low-opts.ask,profitHighCents=high-opts.ask,required=requiredProfitCents(opts.econ,opts.drive);
  const allPass=cases.every(c=>c.verdict.call==='PASS')&&profitHighCents<required;
  const allOpportunity=cases.every(c=>['BUY','VERIFY'].includes(c.verdict.call))&&profitLowCents>=required;
  if(!allPass&&!allOpportunity)return null;
  return {version:1,field:domain.field,domain:domain.values,quote:domain.quote,basis:domain.basis,call:allPass?'PASS':'VERIFY',lowCents,highCents,profitLowCents,profitHighCents,
    configurations:cases.map(c=>({value:c.value,compIds:c.verdict.valuation.evidence!.map(e=>e.id)})),
    limitation:'Conditional on the seller’s explicit alternatives. Every listed configuration has matching dated sold evidence; no exact capacity was inferred. Confirm the configuration before purchase.'};
}
