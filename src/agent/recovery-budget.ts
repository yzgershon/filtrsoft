import {db} from '../db/index.ts';
import {ensureEnrichment} from '../db/enrichment.ts';
import type {Source} from './collection.ts';
export interface RecoveryBudget {attempts:number;timeMs:number}
const number=(s:string|undefined,fallback:number,min:number,max:number)=>{const n=Number(s);return s&&Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):fallback;};
/** Measure recent reads without parallelizing profiles. Slow/challenged sources
 * use fewer attempts inside the same configured time budget. */
export function recoveryBudgets():Partial<Record<Source,RecoveryBudget>> {
  ensureEnrichment();const result:Partial<Record<Source,RecoveryBudget>>={};
  for(const source of ['facebook','offerup','mercari'] as const){
    const prefix='FILTRSOFT_RECOVERY_'+source.toUpperCase();
    const timeMs=number(process.env[prefix+'_SECONDS'],360,30,600)*1000;
    const cap=number(process.env[prefix+'_ATTEMPTS'],20,0,40);
    const rows=db().query(`SELECT r.payload,e.outcome FROM listing_enrichment e JOIN listings l ON l.id=e.listing_id LEFT JOIN listing_recovery r ON r.listing_id=l.id WHERE l.source=? ORDER BY e.attempted_at DESC LIMIT 40`).all(source) as {payload:string|null;outcome:string}[];
    const times=rows.map(r=>r.payload?JSON.parse(r.payload).durationMs:0).filter(n=>n>0).sort((a,b)=>a-b);
    const typical=times.length?times[Math.floor(times.length*.75)]:18000;
    const success=rows.length?rows.filter(r=>r.outcome==='read').length/rows.length:1;
    result[source]={timeMs,attempts:Math.min(cap,Math.max(cap?1:0,Math.floor(timeMs/(typical+2500)*Math.max(.25,success))))};
  }return result;
}
