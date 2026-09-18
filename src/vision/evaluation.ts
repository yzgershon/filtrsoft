import type {reconcileReads} from './local-lab.ts';
/** Separate extraction errors from presentation errors. None of these scoring
 * classifications changes or writes a production fact. Expected annotations
 * stay frozen and exact suffix/capacity/ECC differences are never normalized away. */
const normalize=(s:string)=>s.toLowerCase().trim().replace(/[®™]/g,'').replace(/\s+/g,' ').replace(/(\d)\s+(gb|tb|mhz|mt\/s)/g,'$1$2').replace(/\s*[x×]\s*/g,'x').replace(/^[()]|[()]$/g,'').replace(/^(\d+)gbx(\d+)$/,'$2x$1gb');
const placeholder=(s:string)=>/^(?:unknown|unreadable|not (?:visible|readable|specified|available)|n\/a|none|unspecified|cannot (?:read|determine))(?:\s*\([^)]*\))?\.?$/i.test(s.trim());
export function evaluateFacts(expected:Record<string,string[]>,result:ReturnType<typeof reconcileReads>|null,supportedLabels:string[]=[]){
 const wanted=new Map(Object.entries(expected).map(([k,v])=>[k,new Set(v.map(normalize))]));
 const all=[...wanted.values()].flatMap(s=>[...s]);
 const facts=[...new Map((result?.fields??[]).map(f=>[f.field+'|'+normalize(f.value),f])).values()];
 const fields:Record<string,{correct:number;missed:number;wrong:number}>={};
 const errors:Array<{field:string;value:string;kind:'placeholder'|'misplaced'|'fragment'|'visible-misfiled'|'unsupported'}>=[];
 for(const [field,values] of wanted){const correct=[...values].filter(value=>facts.some(f=>f.field===field&&normalize(f.value)===value)).length;fields[field]={correct,missed:values.size-correct,wrong:0};}
 for(const f of facts){const value=normalize(f.value);if(wanted.get(f.field)?.has(value))continue;
  const kind=placeholder(f.value)?'placeholder':all.includes(value)?'misplaced':supportedLabels.map(normalize).includes(value)?'visible-misfiled':value.length>=3&&all.some(v=>v.startsWith(value+' ')||v.endsWith(' '+value))?'fragment':'unsupported';
  errors.push({field:f.field,value:f.value,kind});if(kind!=='placeholder'){fields[f.field]??={correct:0,missed:0,wrong:0};fields[f.field].wrong++;}
 }
 const correct=Object.values(fields).reduce((n,f)=>n+f.correct,0),missed=Object.values(fields).reduce((n,f)=>n+f.missed,0),wrong=Object.values(fields).reduce((n,f)=>n+f.wrong,0);
 return {correct,missed,wrong,unsupported:errors.filter(e=>e.kind==='unsupported').length,errors,fields,failed:result===null,
  abstained:result!==null&&facts.every(f=>placeholder(f.value)),duplicates:(result?.fields.length??0)-facts.length,
  precision:correct+wrong?correct/(correct+wrong):0,recall:correct+missed?correct/(correct+missed):0};
}
