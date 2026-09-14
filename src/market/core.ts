import {createHash} from 'node:crypto';
import {catalogCategory,memoryLayout} from '../catalog/identity.ts';
import {extractAttributes} from '../catalog/match.ts';
import {compMatchesQuery} from '../sources/ebay.ts';
import {normalizeCondition} from '../valuation/condition.ts';
import {looksLikeWholeMachine} from '../valuation/index.ts';
import {soldEvidence} from '../db/comp-evidence.ts';
import type {MarketProduct,MarketSale,MarketCohort,MarketRange,MarketCondition,PriceBasis,MarketPoint,MarketResponse} from './types.ts';

export interface StoredMarketSale {id:number;source:string;source_item_id:string;url:string|null;raw_title:string;sold_price_cents:number;shipping_cents:number|null;currency:string;condition_norm:string|null;condition_raw:string|null;sold_at:string;captured_at:string;raw_json:string;}
const compact=(s:string)=>s.replace(/\b(\d+)\s*[x×]\s*(\d+)\s*gb\b/gi,'$1x$2GB').replace(/\b(ddr[345])\s+(\d{3,5})\b/gi,'$1-$2');
const gb=(n:number)=>n>=1024&&n%1024===0?`${n/1024}TB`:`${n}GB`;
const partCategories=new Set(['gpu','cpu','ram','storage','psu','motherboard','case','component']);
/** The pricing catalog calls processors "component". Market navigation can
 * name them precisely without changing the engine's category contract. */
export function marketCategory(category:string,model:string):string {
  const resolved=catalogCategory(category,model);
  return resolved==='component'&&/\b(?:ryzen|core i[3579]|i[3579][ -]\d{4,5}[a-z0-9]*|core ultra|xeon|threadripper|pentium|celeron)\b/i.test(model)?'cpu':resolved;
}
const brandPattern=/\b(asus|gigabyte|msi|evga|zotac|pny|sapphire|powercolor|xfx|asrock|intel|palit|gainward|inno3d)\b/i;
const boardPattern=/\b(rog\s+strix|strix|tuf|aorus\s+master|aorus|gaming\s+x\s+trio|gaming\s+trio|gaming\s+oc|ventus|suprim|founders\s+edition|nitro\+?|pulse|red\s+devil|hellhound|ftw3|xc3|trinity|amp\s+extreme|eagle|windforce|merc\s*\d*|swft\s*\d*)\b/i;
function saleUrl(url:string|null):string|null {try{const u=new URL(url??'');return u.protocol==='https:'&&/^(?:www\.)?ebay\.com$/.test(u.hostname)&&/^\/itm\/(?:[^/]+\/)?\d+/.test(u.pathname)?u.href:null;}catch{return null;}}
/** These are observed sale cohorts, never adjusted valuations. Unknown fields
 * stay named and isolated; nothing guesses that a 32GB stick is a 2x16GB kit. */
export function marketCohorts(product:MarketProduct,rows:StoredMarketSale[],at=Date.now()):{cohorts:MarketCohort[];excluded:number} {
  const groups=new Map<string,MarketCohort>(),seen=new Set<string>();let excluded=0;
  const category=marketCategory(product.category,product.model),identity=compact(`${product.brand} ${product.model}`);
  for(const row of rows){
    const condition=normalizeCondition(row.condition_norm??row.condition_raw),title=compact(row.raw_title);
    if(!soldEvidence(row,at)||!condition||condition==='for_parts'||normalizeCondition(title)==='for_parts'||seen.has(`${row.source}:${row.source_item_id}`)){excluded++;continue;}
    const layout=memoryLayout(title),query=category==='ram'&&layout&&!memoryLayout(identity)?`${identity} ${layout}GB`:identity;
    if(!compMatchesQuery(title,query,category==='cpu'?'component':category).ok||partCategories.has(category)&&looksLikeWholeMachine(title)){excluded++;continue;}
    // Numeric matching alone cannot distinguish e.g. a Pixel 8 from iPhone 8.
    // Require the catalog's alphabetic family tokens as well, preserving G.Skill/WD spellings.
    const words=(s:string)=>s.toLowerCase().replace(/g[.\s-]*skill/g,'gskill').replace(/western\s+digital/g,'wd').replace(/[^a-z0-9]+/g,' ').split(' ');
    const got=new Set(words(title));
    const family=words(identity).filter(w=>/^[a-z]{3,}$/.test(w)&&!['amd','nvidia','apple','intel','core','desktop','memory','ram','kit','computer'].includes(w));
    if(!family.every(w=>got.has(w))){excluded++;continue;}
    const fields:string[]=[],unknowns:string[]=[];
    const field=(label:string,value:string|null)=>{fields.push(value?`${label}: ${value}`:`${label}: not stated`);if(!value)unknowns.push(label);};
    if(category==='ram'){
      const parts=layout?.split('x').map(Number),total=parts?parts[0]*parts[1]:null;
      const capacityText=title.replace(/\b\d+\s*[x×]\s*\d+\s*gb\b/gi,'');
      if([...capacityText.matchAll(/\b(\d+)\s*gb\b/gi)].some(m=>Number(m[1])!==total)){excluded++;continue;}
      // exactPartIdentity already requires total capacity, generation, speed,
      // brand, layout and matching RGB/ECC/registered/mobile variants.
      field('Kit',layout?layout.replace('x',' × ')+'GB':null);
      field('Latency',title.match(/\b(?:cl|cas)\s*(\d{2})\b/i)?.[1]?`CL${title.match(/\b(?:cl|cas)\s*(\d{2})\b/i)![1]}`:null);
    }else if(category==='gpu'){
      const capacities=[...title.matchAll(/\b(\d{1,2})\s*gb\b/gi)].map(m=>Number(m[1]));
      if(new Set(capacities).size>1){excluded++;continue;}
      field('Memory',capacities.length?`${capacities[0]}GB`:null);
      const board=title.match(boardPattern)?.[1]?.toUpperCase()??null;
      field('Board',board==='FOUNDERS EDITION'?'NVIDIA':title.match(brandPattern)?.[1]?.toUpperCase()??null);
      field('Series',board);
    }else if(category==='phone'||category==='tablet'){
      const capacities=[...title.matchAll(/\b(\d{1,4})\s*(gb|g|tb)\b/gi)].map(m=>Number(m[1])*(m[2].toLowerCase()==='tb'?1024:1)).filter(n=>n>=32);
      if(new Set(capacities).size>1){excluded++;continue;}
      field('Storage',capacities.length?gb(capacities[0]):null);
      const unlocked=/\bunlocked\b/i.test(title)&&!/(?:not|non)[ -]?unlocked/i.test(title);
      const carriers=[...title.matchAll(/\b(verizon|at&t|t-mobile|sprint|spectrum|cricket|tracfone|boost|us cellular)\b/gi)].map(m=>m[1].toUpperCase());
      field('Network',/\bwi[ -]?fi\s*(?:only)?\b/i.test(title)&&!/(?:cellular|lte|5g)/i.test(title)?'Wi-Fi':unlocked?'Unlocked':carriers.length===1?carriers[0]+' / unlock not stated':null);
    }else if(['laptop','prebuilt','desktop'].includes(category)){
      const attrs=extractAttributes(title);
      field('CPU',attrs.cpu?String(attrs.cpu).toUpperCase():null);
      // Require labelled RAM, rather than treating any smaller GB number as RAM.
      const ram=title.match(/\bram\s*[:=]\s*(\d{1,3})(?:\.0)?\s*gb\b/i)?.[1]??title.match(/\b(\d{1,3})\s*gb\s*(?:ddr[345]\b|ram\b|memory\b)/i)?.[1];
      field('RAM',ram?gb(Number(ram)):null);
      const disk=title.match(/\b(\d+(?:\.\d+)?)\s*(gb|tb)\s*(?:ssd|nvme|hdd|storage|drive)\b/i);
      field('Drive',disk?`${gb(Number(disk[1])*(disk[2].toLowerCase()==='tb'?1024:1))} ${disk[0].match(/ssd|nvme|hdd|storage|drive/i)![0].toUpperCase()}`:null);
      field('GPU',attrs.gpu?String(attrs.gpu).toUpperCase():/\b(?:intel\s+(?:uhd|iris)|integrated graphics)\b/i.test(title)?title.match(/\b(?:intel\s+(?:uhd|iris)(?:\s+(?:xe|graphics|\d+))*|integrated graphics)\b/i)![0].toUpperCase():null);
      const cores=[...title.matchAll(/\b(\d+)[ -]core\s*(cpu|gpu)\b/gi)].map(m=>`${m[1]}-core ${m[2].toUpperCase()}`).join(', ');
      if(/\bm[1-9]\b/i.test(title))field('Chip cores',cores||null);
    }else if(category==='storage')field('Cooling',/\b(?:no|without)\s+(?:a\s+)?heatsink\b/i.test(title)?'No heatsink':/\bheatsink\b/i.test(title)?'Heatsink':null);
    if(!fields.length)fields.push('Catalog model');
    const label=fields.join(' · '),key=createHash('sha256').update(label).digest('hex').slice(0,20);
    let group=groups.get(key);if(!group){group={key,label,complete:!unknowns.length,unknowns,sales:[]};groups.set(key,group);}
    seen.add(`${row.source}:${row.source_item_id}`);
    group.sales.push({id:row.id,title:row.raw_title,url:saleUrl(row.url),date:row.sold_at.slice(0,10),itemCents:row.sold_price_cents,shippingCents:row.shipping_cents,condition});
  }
  return {cohorts:[...groups.values()].sort((a,b)=>Number(b.complete)-Number(a.complete)||b.sales.length-a.sales.length||a.label.localeCompare(b.label)),excluded};
}
const DAY=86400000;
export function rangeStart(range:MarketRange,at:number):number {
  const d=new Date(at);d.setUTCHours(0,0,0,0);
  if(range==='all')return 0;
  const month=d.getUTCMonth()-(range==='1m'?1:range==='3m'?3:range==='6m'?6:range==='1y'?12:36);
  const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(month);d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));return d.getTime();
}
const quantile=(values:number[],p:number)=>{if(!values.length)return null;const s=[...values].sort((a,b)=>a-b),i=(s.length-1)*p;return Math.round(s[Math.floor(i)]+(s[Math.ceil(i)]-s[Math.floor(i)])*(i%1));};
const price=(s:MarketSale,basis:PriceBasis)=>basis==='item'?s.itemCents:s.shippingCents===null?null:s.itemCents+s.shippingCents;
export function marketSeries(product:MarketProduct,cohorts:MarketCohort[],opts:{range:MarketRange;condition:MarketCondition;basis:PriceBasis;cohort?:string;at?:number;excluded?:number;truncated?:boolean}):MarketResponse {
  const at=opts.at??Date.now(),today=new Date(at).toISOString().slice(0,10);
  const available=cohorts.map(c=>({...c,sales:c.sales.filter(s=>s.condition===opts.condition)})).filter(c=>c.sales.length);
  const selected=opts.cohort?available.find(c=>c.key===opts.cohort):available[0];
  const all=(selected?.sales??[]).filter(s=>price(s,opts.basis)!==null).sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id);
  const since=opts.range==='all'?Date.parse(all[0]?.date??today):rangeStart(opts.range,at);
  const interval=opts.range==='1m'||opts.range==='3m'?'day':opts.range==='6m'||opts.range==='1y'?'week':'month';
  const floor=(t:number)=>{const d=new Date(t);d.setUTCHours(0,0,0,0);if(interval==='month')d.setUTCDate(1);if(interval==='week')d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.getTime();};
  const next=(t:number)=>{if(interval==='day')return t+DAY;if(interval==='week')return t+7*DAY;const d=new Date(t);d.setUTCMonth(d.getUTCMonth()+1);return d.getTime();};
  const sales=all.filter(s=>Date.parse(s.date)>=since&&s.date<=today),bucket=new Map<number,number[]>();
  for(const sale of sales){const key=floor(Date.parse(sale.date));const entries=bucket.get(key)??[];entries.push(price(sale,opts.basis)!);bucket.set(key,entries);}
  const points:MarketPoint[]=[];
  // Explicit null buckets prevent the renderer bridging months without sales.
  for(let t=floor(since);t<=at&&points.length<2400;t=next(t)){
    const values=bucket.get(t)??[];
    points.push({date:new Date(Math.max(t,since)).toISOString().slice(0,10),end:new Date(Math.min(next(t)-DAY,Date.parse(today))).toISOString().slice(0,10),count:values.length,medianCents:quantile(values,.5),lowCents:quantile(values,.25),highCents:quantile(values,.75)});
  }
  const observed=points.filter(p=>p.count),first=points[0],last=points.at(-1),values=sales.map(s=>price(s,opts.basis)!);
  // Sparse or missing endpoint buckets cannot substantiate a range return.
  const changePercent=first&&last&&first!==last&&first.count>=3&&last.count>=3&&first.medianCents?100*(last.medianCents!/first.medianCents-1):null;
  return {pinned:false,product:{...product,category:marketCategory(product.category,product.model)},range:opts.range,condition:opts.condition,basis:opts.basis,generatedAt:new Date(at).toISOString(),cohorts:available.map(({sales,...c})=>({...c,count:sales.length})),selected:selected?.key??null,interval,points,sales:sales.slice().reverse().slice(0,100),totalSales:sales.length,
    coverage:{first:all[0]?.date??null,last:all.at(-1)?.date??null,rangeFirst:sales[0]?.date??null,rangeLast:sales.at(-1)?.date??null,excluded:opts.excluded??0,missingShipping:opts.basis==='delivered'?(selected?.sales.filter(s=>s.shippingCents===null&&(opts.range==='all'||Date.parse(s.date)>=since)&&s.date<=today).length??0):0,truncated:opts.truncated??false},
    summary:{medianCents:quantile(values,.5),lowCents:quantile(values,.25),highCents:quantile(values,.75),changePercent,observedBuckets:observed.length,totalBuckets:points.length}};
}

export function marketCsv(sales:MarketSale[],basis:PriceBasis):string {
  const cell=(v:unknown)=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  return [['Sale date','Title','Condition','Item USD','Shipping USD (blank = unknown)','Selected basis USD', 'Source URL'],...sales.map(s=>[s.date,s.title,s.condition,(s.itemCents/100).toFixed(2),s.shippingCents===null?'':(s.shippingCents/100).toFixed(2),price(s,basis)===null?'':(price(s,basis)!/100).toFixed(2),s.url??''])].map(row=>row.map(cell).join(',')).join('\r\n');
}
