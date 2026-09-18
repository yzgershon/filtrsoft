import type {DerivedSku} from './derive.ts';
import {factualText,textFacts} from '../signals/factual-text.ts';
import {resolveProductType} from '../signals/product-type.ts';
export type SourceIdentity={identity:DerivedSku|null;quotes:string[];reason:string;conflict:boolean};
/** Manufacturer model strings, not configuration guesses. In particular an
 * i7-13620H/4060 Nitro can be ANV15-51 OR ANV15-52: never derive one from specs.
 * Model suffixes and explicitly stated submodels remain in the key. */
export function sourceIdentity(title:string,description:string,category:string):SourceIdentity {
 const text=factualText(title+'\n'+description),empty=(reason:string,conflict=false):SourceIdentity=>({identity:null,quotes:[],reason,conflict});
 if(['furniture','accessory'].includes(resolveProductType(title).kind))return empty('Not a supported whole product');
 if(textFacts(text).conflicts.length)return empty('Conflicting stated specifications',true);
 if(/\b(?:bundle|lot of|your choice|starting at|choose from)\b|\bup to \d+\s*(?:gb|tb)\b/i.test(text))return empty('Multiple items or selectable configurations require separate evidence');
 const candidates:Array<{identity:DerivedSku;quote:string}>=[];
 const add=(brand:string,line:string,model:string,quote:string)=>candidates.push({identity:{brand,line,model,category},quote});
 if(category==='laptop'){
  const legion=/\bLegion\s+(5i?)\b/i.exec(text);
  if(/\bLenovo\b/i.test(text)&&legion)for(const m of text.matchAll(/\b((?:15|16|17)(?:ACH|IAH|ARH|ITH|IRH|APH|AHP)\d{1,2}[A-Z]*(?:-[A-Z0-9]+)?)\b/gi))add('Lenovo','Legion','Legion '+legion[1].toLowerCase()+' '+m[1].toUpperCase(),m[0]);
  if(/\bLenovo\b/i.test(text)){
   for(const m of text.matchAll(/\bLOQ\s+((?:15|16|17)[A-Z]{3}\d{1,2}[A-Z]*)\b/gi))add('Lenovo','LOQ','LOQ '+m[1].toUpperCase(),m[0]);
   for(const m of text.matchAll(/\bYoga\s+([679]i?)\s+(2[- ]in[- ]1\s+)?((?:13|14|15|16)[A-Z]{3}\d{1,2}[A-Z]*)\b/gi))add('Lenovo','Yoga','Yoga '+m[1].toLowerCase()+(m[2]?' 2-in-1':'')+' '+m[3].toUpperCase(),m[0]);
  }
  if(/\bAcer\b/i.test(text)&&/\bNitro\b/i.test(text))for(const m of text.matchAll(/\b(AN(?:V?(?:15|16|17)|5(?:15|16|17))-\d{2}(?:-[A-Z0-9]{3,6})?)\b/gi))add('Acer','Nitro','Nitro '+m[1].toUpperCase(),m[0]);
 }
 if(category==='prebuilt'&&/\bHP\b/i.test(text))for(const m of text.matchAll(/\b((?:22|24|27)-[a-z]{2}\d{4}(?:[a-z]{0,2}))\b/gi))add('HP','All-in-One',m[1].toUpperCase(),m[0]);
 if(category==='component'&&/\b(?:cpu|processor)\b/i.test(title)&&!/\+|\b(?:with|and)\b.*\b(?:ram|motherboard|memory)\b/i.test(title)){
  for(const m of text.matchAll(/\b(?:Intel\s+(?:Core\s+)?)?(i[3579])[- ](\d{4,5}[A-Z]{0,2})\b/gi))if(/\bIntel\b/i.test(text))add('Intel','Core',m[1].toLowerCase()+'-'+m[2].toUpperCase(),m[0]);
 }
 if(category==='gpu'&&!/\b(?:laptop|notebook|mobile|tesla|cmp)\b/i.test(title)){
  for(const m of text.matchAll(/\b(?:NVIDIA\s+)?(Quadro\s+RTX\s+\d{4}|RTX\s+A\d{4}|Radeon\s+Pro\s+WX\s+\d{4})\b/gi)){
   const amd=/Radeon/i.test(m[1]);add(amd?'AMD':'NVIDIA',amd?'Radeon Pro':'Professional',m[1].replace(/\s+/g,' ').replace(/rtx/ig,'RTX').replace(/wx/ig,'WX'),m[0]);
  }
 }
 const keys=new Set(candidates.map(c=>c.identity.brand+'|'+c.identity.model.toLowerCase()));
 if(keys.size>1)return empty('Conflicting explicit manufacturer model identifiers',true);
 if(!candidates.length)return empty(/\bAcer\b.*\bNitro\b/is.test(text)?'Nitro manufacturer model code is absent; CPU/GPU configuration cannot establish ANV/AN chassis identity':'No supported exact manufacturer model identifier in current seller text');
 return {identity:candidates[0].identity,quotes:[...new Set(candidates.map(c=>c.quote))],reason:'Exact manufacturer identity quoted from seller evidence',conflict:false};
}
