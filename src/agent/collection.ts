import type {CommandResult} from './process.ts';
import {collectionQuery,CORE_QUERIES} from '../crawler/search-policy.ts';
import type {RecoveryBudget} from './recovery-budget.ts';

export const SOURCES=['facebook','offerup','mercari'] as const;
export type Source=typeof SOURCES[number];
export const QUERIES=CORE_QUERIES;
export const isSource=(value:string):value is Source=>SOURCES.includes(value as Source);
export interface CollectionStage {name:string;source:Source;args:string[];timeoutMs:number;kind:'crawl'|'enrich'|'probe'|'sync'}
const script:Record<Source,string>={facebook:'fb:crawl',offerup:'ou:crawl',mercari:'mc:crawl'};

/** Interleave sources so a broken Facebook launch cannot starve OfferUp. Each
 * cycle advances the cursor even after failure, avoiding a permanent first-query loop. */
export function collectionPlan(sources:Source[],cursor:number,queries=3,limit=6,budgets:Partial<Record<Source,RecoveryBudget>>={}):CollectionStage[] {
  if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isInteger(queries)||queries<1||queries>4)throw new Error('Invalid search plan');
  const plan:CollectionStage[]=[];
  for(let round=0;round<queries;round++) for(const source of sources) {
    const query=collectionQuery(source,cursor,round);
    plan.push({source,kind:'crawl',name:`${source}/search-${query.replaceAll(' ','-')}`,args:['run',script[source],'--query',query,'--limit',String(limit),...(source==='facebook'?['--cards-only']:[])],timeoutMs:4*60_000});
  }
  for(const source of sources) {
    // At most 18 new cards versus 20 detail reads lets the description backlog
    // shrink while preserving core and parts searches. Previously: 36 / 4.
    plan.push({source,kind:'enrich',name:`${source}/details`,args:['run',source==='facebook'?'fb:detail':source==='offerup'?'ou:photos':'mc:detail','--limit','20'],timeoutMs:8*60_000});
    plan.push({source,kind:'probe',name:`${source}/probe`,args:['run','probe','--source',source,'--limit','6'],timeoutMs:4*60_000});
  }
  // Separate recovery capacity follows bounded fresh details and availability.
  // Small source-interleaved chunks checkpoint independently and stay sequential.
  for(let round=0;round<2;round++)for(const source of sources){
    const b=budgets[source]??{attempts:16,timeMs:360000};
    const total=Math.max(0,Math.min(40,b.attempts));
    const attempts=Math.min(20,round===0?Math.ceil(total/2):Math.floor(total/2));
    if(attempts)plan.push({source,kind:'enrich',name:`${source}/recovery-${round+1}`,args:['run',source==='facebook'?'fb:detail':source==='offerup'?'ou:photos':'mc:detail','--limit',String(attempts)],timeoutMs:Math.max(15000,Math.min(600000,b.timeMs)/2)});
  }
  return plan;
}

export async function collect(sources:Source[],opts:{cursor:number;queries?:number;limit?:number;budgets?:Partial<Record<Source,RecoveryBudget>>;cooldown?:(source:Source)=>string|null;paused:()=>boolean;run:(stage:CollectionStage)=>Promise<CommandResult>;stage:(stage:CollectionStage,status:'running'|'done'|'failed',error?:string)=>Promise<void>}) {
  const errors:Record<string,string[]> = Object.fromEntries(sources.map(s=>[s,[]]));
  const blocked=new Set<Source>();
  let stopped=false;
  async function execute(step:CollectionStage) {
    await opts.stage(step,'running');
    let result:CommandResult;
    try {result=await opts.run(step);}catch(error){result={ok:false,tail:String(error),timedOut:false,cancelled:false};}
    const note=result.tail.slice(-350);
    await opts.stage(step,result.ok?'done':'failed',result.ok?undefined:note);
    if(!result.ok)errors[step.source].push(`${step.name}: ${note}`);
    return result.ok;
  }
  const sync=(source:Source,name:string)=>execute({source,kind:'sync',name:`${source}/${name}`,args:['run','push','--source',source],timeoutMs:3*60_000});
  // Recover yesterday's interrupted captures before opening any new browser.
  for(const source of sources) {if(opts.paused()){stopped=true;break;}await sync(source,'recover-sync');}
  for(const step of collectionPlan(sources,opts.cursor,opts.queries,opts.limit,opts.budgets)) {
    if(opts.paused()){stopped=true;break;}
    if(blocked.has(step.source))continue;
    const retryAt=opts.cooldown?.(step.source);if(retryAt){blocked.add(step.source);errors[step.source].push(`Waiting before retry until ${retryAt}`);continue;}
    const ok=await execute(step);
    // Commit useful partial results immediately, even if the browser timed out.
    // Sync never opens a browser, including when pause interrupted this stage.
    await sync(step.source,`${step.name.split('/')[1]}-sync`);
    if(!ok&&step.kind!=='probe')blocked.add(step.source);
  }
  return Object.fromEntries(sources.map(source=>[source,errors[source].length?errors[source].join(' | ').slice(0,950):stopped?'paused before completion':'ok']));
}
