/**
 * Shadow photo reading, approved by Yish on 2026-09-23 after the GPT-6 Luna
 * benchmark (docs/LUNA-GEMMA-EVALUATION-2026-09-22.md).
 *
 * GPT-6 Luna at reasoning effort `high` reads a listing's photos; the installed
 * Gemma 31B re-reads the same photos on this machine when the GPU is idle. A
 * fact counts as agreed only when both readers report the same field and value,
 * which on the benchmark kept 134 claims with none unsupported. Luna alone
 * invents whole products on sideways labels, so single-reader facts are shown
 * as unchecked.
 *
 * NOTHING HERE WRITES ENGINE FACTS, VALUATIONS OR VERDICTS. Readings are stored
 * beside the listing and displayed as "read from photos, unverified". Letting a
 * reading change a call needs a fresh untouched holdout first.
 *
 * Every setting below is the benchmarked one. Changing the prompt, schema,
 * effort, image detail, Gemma model or options invalidates the evaluation;
 * test/photo-shadow.test.ts pins them.
 */
import type {Database} from 'bun:sqlite';
import {createHash} from 'node:crypto';
import {freemem} from 'node:os';
import {z} from 'zod';
import {evidenceRead,evidencePrompt,canonical,type Claim} from './evidence-evaluation.ts';
import {GPT6_LUNA,costMicros,reservationMicros,imageTokenBound} from '../ai/pricing.ts';
import {setCap,reserve,settle,markUncertain,release,BudgetRefused} from '../ai/spend-cap.ts';
import {buildRequestBody,parseResponse,postResponses,rateLimitWaitMs} from '../ai/openai-responses.ts';

export const SHADOW_PROMPT_SHA='41669d58ff7c5b368c104a3f1880d4fea49aff956963083cee5a6c1c4503487d';
/** The benchmark covered listings with 1 to 6 photos; larger galleries are outside what was measured. */
export const MAX_SHADOW_PHOTOS=6;
export const LUNA_SHADOW={model:GPT6_LUNA.model,effort:'high',detail:'original',
  // High used at most 4,061 output tokens on the benchmark; 16k leaves room
  // without reserving the provider maximum against a daily cap.
  maxOutputTokens:16_384,timeoutMs:10*60_000} as const;
export const GEMMA_SHADOW={model:'gemma4:31b-it-qat',digest:'e0812a55773bfeac846b2d605b4d93638b8dfa7119d9587f3d91475afc78185e',
  context:16_384,maxOutput:4_096,temperature:0,timeoutMs:15*60_000} as const;
export const SHADOW_SCOPE='photo-shadow-luna-high';
export const SHADOW_CAP_MICROS=500_000;
export const SHADOW_APPROVAL='Yish approved an operating budget for GPT-6 Luna high shadow photo reads on 2026-09-23 (about $0.26/day, ~$8/month, hard cap $0.50 per UTC day). Readings are display-only.';
/** A listing gets at most this many failed attempts per reader and photo set. */
export const SHADOW_MAX_FAILURES=2;

export const shadowPrompt=(photos:number)=>evidencePrompt+'\nThere are '+photos+' photos, numbered 0 through '+(photos-1)+'.';
export const shadowSchema=()=>z.toJSONSchema(evidenceRead) as Record<string,unknown>;
export const sha256=(x:string|Uint8Array)=>createHash('sha256').update(x).digest('hex');
/** Source URLs in gallery order; a changed gallery is a new photo set. */
export const urlKey=(urls:string[])=>sha256(JSON.stringify(urls));

export function ensurePhotoShadow(d:Database) {
  d.run(`CREATE TABLE IF NOT EXISTS photo_reads(
    id INTEGER PRIMARY KEY,
    listing_id INTEGER NOT NULL,
    reader TEXT NOT NULL CHECK(reader IN ('luna','gemma')),
    model TEXT NOT NULL,
    config TEXT NOT NULL,
    prompt_sha TEXT NOT NULL,
    url_key TEXT NOT NULL,
    fingerprint TEXT,
    image_hashes TEXT,
    outcome TEXT NOT NULL CHECK(outcome IN ('read','failed','reused')),
    error TEXT,
    claims TEXT,
    usage TEXT,
    cost_micros INTEGER,
    elapsed_ms INTEGER,
    created_at TEXT NOT NULL)`);
  d.run('CREATE INDEX IF NOT EXISTS photo_reads_listing ON photo_reads(listing_id,reader,id)');
}

export type ShadowImage={bytes:Uint8Array;mime:string;width:number;height:number};
export type PhotoSet={listingId:number;urlKey:string;fingerprint:string;imageHashes:string[];images:ShadowImage[]};

function record(d:Database,row:{listingId:number;reader:'luna'|'gemma';model:string;config:unknown;urlKey:string;fingerprint:string|null;imageHashes:string[]|null;
  outcome:'read'|'failed'|'reused';error?:string|null;claims?:unknown;usage?:unknown;costMicros?:number|null;elapsedMs?:number|null},at=new Date().toISOString()) {
  ensurePhotoShadow(d);
  return (d.query(`INSERT INTO photo_reads(listing_id,reader,model,config,prompt_sha,url_key,fingerprint,image_hashes,outcome,error,claims,usage,cost_micros,elapsed_ms,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).get(row.listingId,row.reader,row.model,JSON.stringify(row.config),SHADOW_PROMPT_SHA,row.urlKey,row.fingerprint,
    row.imageHashes?JSON.stringify(row.imageHashes):null,row.outcome,row.error?.slice(0,500)??null,row.claims===undefined?null:JSON.stringify(row.claims),
    row.usage===undefined?null:JSON.stringify(row.usage),row.costMicros??null,row.elapsedMs??null,at) as {id:number}).id;
}

/** A failed attempt that never reached a model (download failed, photos expired). Counts toward SHADOW_MAX_FAILURES. */
export function recordUnreadable(d:Database,row:{listingId:number;reader:'luna'|'gemma';urlKey:string;fingerprint?:string|null;error:string}) {
  return record(d,{...row,model:row.reader==='luna'?LUNA_SHADOW.model:GEMMA_SHADOW.model,config:{},fingerprint:row.fingerprint??null,imageHashes:null,outcome:'failed',costMicros:0});
}

/** Whether this reader already read, reused or gave up on this photo set. */
export function readerDone(d:Database,listingId:number,reader:'luna'|'gemma',key:{urlKey?:string;fingerprint?:string}) {
  const rows=d.query(`SELECT outcome FROM photo_reads WHERE listing_id=? AND reader=? AND prompt_sha=? AND (url_key=? OR fingerprint=?)`)
    .all(listingId,reader,SHADOW_PROMPT_SHA,key.urlKey??'',key.fingerprint??'') as {outcome:string}[];
  return rows.some(r=>r.outcome!=='failed')||rows.filter(r=>r.outcome==='failed').length>=SHADOW_MAX_FAILURES;
}

export type Assessment={call:string;recovery?:{job:string}[]|null};
/** Photos are worth paying for when the engine says a photo could supply the deciding fact, or when the call is one somebody acts on. */
export function worthReading(a:Assessment) {
  return a.call==='BUY'||a.call==='VERIFY'||(a.call==='INSUFFICIENT_DATA'&&!!a.recovery?.some(r=>r.job==='photos'));
}

export type Candidate={id:number;title:string;urls:string[];urlKey:string};
/**
 * Newest live listings first, within the benchmarked photo range, whose photo
 * set this reader has not handled. `eligible` applies the product-type filter
 * and the engine assessment, which are too expensive to run over every row.
 */
export function shadowCandidates(d:Database,opts:{limit:number;windowHours?:number;now?:number;eligible:(c:Candidate)=>boolean}) {
  ensurePhotoShadow(d);
  const since=new Date((opts.now??Date.now())-(opts.windowHours??72)*3600_000).toISOString();
  const rows=d.query(`SELECT l.id,l.title,(SELECT json_group_array(url) FROM (SELECT url FROM listing_photos p WHERE p.listing_id=l.id ORDER BY position)) urls
    FROM listings l WHERE l.delisted_at IS NULL AND COALESCE(l.posted_at,l.captured_at)>=?
      AND (SELECT COUNT(*) FROM listing_photos p WHERE p.listing_id=l.id) BETWEEN 1 AND ?
    ORDER BY COALESCE(l.posted_at,l.captured_at) DESC,l.id DESC`).all(since,MAX_SHADOW_PHOTOS) as {id:number;title:string;urls:string}[];
  const out:Candidate[]=[];let skipped=0;
  for(const r of rows) {
    if(out.length>=opts.limit)break;
    const urls=JSON.parse(r.urls) as string[],c={id:r.id,title:r.title??'',urls,urlKey:urlKey(urls)};
    if(readerDone(d,r.id,'luna',{urlKey:c.urlKey}))continue;
    if(!opts.eligible(c)){skipped++;continue;}
    out.push(c);
  }
  return {candidates:out,notWorthReading:skipped};
}

/** Photo sets outside the benchmarked range, reported instead of silently ignored. */
export function oversizedGalleries(d:Database,opts:{windowHours?:number;now?:number}={}) {
  const since=new Date((opts.now??Date.now())-(opts.windowHours??72)*3600_000).toISOString();
  return (d.query(`SELECT COUNT(*) n FROM listings l WHERE l.delisted_at IS NULL AND COALESCE(l.posted_at,l.captured_at)>=?
    AND (SELECT COUNT(*) FROM listing_photos p WHERE p.listing_id=l.id)>?`).get(since,MAX_SHADOW_PHOTOS) as {n:number}).n;
}

export type LunaOutcome={outcome:'read'|'failed'|'reused'|'budget'|'rate_limited';readId?:number;costMicros?:number;claims?:number;error?:string;elapsedMs?:number};

/**
 * One Luna request with every photo of the listing, under the daily cap. The
 * worst case is reserved before sending; an unknown charge stays counted.
 */
export async function lunaRead(d:Database,set:PhotoSet,deps:{apiKey:string;fetchImpl?:typeof fetch;now?:()=>string}):Promise<LunaOutcome> {
  if(!set.images.length||set.images.length>MAX_SHADOW_PHOTOS)throw new Error('photo count outside the benchmarked range');
  if(sha256(evidencePrompt)!==SHADOW_PROMPT_SHA)throw new Error('evidence prompt changed; the benchmark no longer applies');
  const now=deps.now??(()=>new Date().toISOString());
  ensurePhotoShadow(d);
  const previous=d.query(`SELECT id FROM photo_reads WHERE listing_id=? AND reader='luna' AND outcome='read' AND prompt_sha=? AND fingerprint=? ORDER BY id DESC LIMIT 1`)
    .get(set.listingId,SHADOW_PROMPT_SHA,set.fingerprint) as {id:number}|null;
  const config={effort:LUNA_SHADOW.effort,detail:LUNA_SHADOW.detail,maxOutputTokens:LUNA_SHADOW.maxOutputTokens};
  const base={listingId:set.listingId,reader:'luna' as const,model:LUNA_SHADOW.model,config,urlKey:set.urlKey,fingerprint:set.fingerprint,imageHashes:set.imageHashes};
  // Same photos under new URLs (marketplace CDNs re-sign links): no second charge.
  if(previous)return {outcome:'reused',readId:record(d,{...base,outcome:'reused',error:`same photos as read ${previous.id}`},now())};
  setCap(d,SHADOW_SCOPE,SHADOW_CAP_MICROS,'utc-day',SHADOW_APPROVAL);
  const bound=set.images.reduce((n,i)=>n+imageTokenBound(i.width,i.height,2),0)+4_000;
  const body=buildRequestBody({model:LUNA_SHADOW.model,effort:LUNA_SHADOW.effort,prompt:shadowPrompt(set.images.length),
    images:set.images.map(i=>({mime:i.mime,data:i.bytes,detail:LUNA_SHADOW.detail})),schemaName:'evidence_read',schema:shadowSchema(),maxOutputTokens:LUNA_SHADOW.maxOutputTokens});
  let r;
  try{r=reserve(d,SHADOW_SCOPE,reservationMicros(GPT6_LUNA,bound,LUNA_SHADOW.maxOutputTokens),{provider:'openai',model:LUNA_SHADOW.model,purpose:'photo-shadow',detail:{listing:set.listingId,photos:set.images.length}},now());}
  catch(e){if(e instanceof BudgetRefused)return {outcome:'budget',error:e.message};throw e;}
  const started=Date.now();
  let call;
  try{call=await postResponses(body,{apiKey:deps.apiKey,timeoutMs:LUNA_SHADOW.timeoutMs,fetchImpl:deps.fetchImpl});}
  catch(e){
    const error='transport: '+String((e as Error)?.message??e).slice(0,300);
    markUncertain(d,r.id,error,now());
    return {outcome:'failed',readId:record(d,{...base,outcome:'failed',error,elapsedMs:Date.now()-started},now()),error};
  }
  if(rateLimitWaitMs(call.httpStatus,call.raw)!==null){
    // Refused before processing and not billed; the next pass tries again.
    release(d,r.id,'HTTP 429 rate_limit_exceeded: rejected before processing, not billed',now());
    return {outcome:'rate_limited',error:'HTTP 429'};
  }
  const fail=(error:string,extra:{usage?:unknown;costMicros?:number}={})=>({outcome:'failed' as const,error,
    readId:record(d,{...base,outcome:'failed',error,usage:extra.usage,costMicros:extra.costMicros??null,elapsedMs:Date.now()-started},now()),costMicros:extra.costMicros});
  if(!call.data){markUncertain(d,r.id,'HTTP '+call.httpStatus,now());return fail('OpenAI HTTP '+call.httpStatus);}
  const p=parseResponse(call.data);
  if(!p.usage){markUncertain(d,r.id,'response without usage',now());return fail('response without usage');}
  const cost=costMicros(GPT6_LUNA,p.usage);
  const {overrun}=settle(d,r.id,cost,{listing:set.listingId,responseId:p.id,usage:p.usage},now());
  if(overrun)return fail('settled cost exceeded the reservation; stop and review the bound',{usage:p.usage,costMicros:cost});
  if(p.status!=='completed')return fail('incomplete response: '+(p.incompleteReason??p.status),{usage:p.usage,costMicros:cost});
  if(p.refusal)return fail('refusal: '+p.refusal.slice(0,200),{usage:p.usage,costMicros:cost});
  let read;
  try{read=evidenceRead.parse(JSON.parse(p.text));}catch(e){return fail('invalid structured output: '+String((e as Error).message).slice(0,200),{usage:p.usage,costMicros:cost});}
  const readId=record(d,{...base,outcome:'read',claims:read,usage:p.usage,costMicros:cost,elapsedMs:Date.now()-started},now());
  return {outcome:'read',readId,costMicros:cost,claims:read.fields.length,elapsedMs:Date.now()-started};
}

export type GemmaGuards={idle:()=>boolean;paused:()=>boolean;freeMemory?:()=>number};
export type GemmaOutcome={outcome:'read'|'failed'|'refused';readId?:number;error?:string;elapsedMs?:number;claims?:number};

/**
 * The September 18 Gemma protocol: one loopback request with every photo, the
 * pinned digest, thinking off, temperature 0, cold load and unload per listing.
 * It refuses to start unless the GPU is idle, and aborts when `paused` turns true.
 */
export async function gemmaRead(d:Database,set:PhotoSet,guards:GemmaGuards,deps:{request?:typeof fetch;endpoint?:string;now?:()=>string}={}):Promise<GemmaOutcome> {
  if(!set.images.length||set.images.length>MAX_SHADOW_PHOTOS)throw new Error('photo count outside the benchmarked range');
  const endpoint=new URL(deps.endpoint??'http://127.0.0.1:11434');
  if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||endpoint.username||endpoint.password||endpoint.pathname!=='/')throw new Error('Gemma requires the loopback Ollama endpoint');
  const request=deps.request??fetch,now=deps.now??(()=>new Date().toISOString());
  const refuse=(error:string):GemmaOutcome=>({outcome:'refused',error});
  if(guards.paused())return refuse('paused');
  if(!guards.idle())return refuse('GPU busy');
  if((guards.freeMemory??freemem)()<3*1024**3)return refuse('less than 3 GB free memory');
  const get=async(path:string)=>{const r=await request(new URL(path,endpoint),{signal:AbortSignal.timeout(5000),redirect:'error'});if(!r.ok)throw new Error(`Ollama ${path} HTTP ${r.status}`);return r.json() as any;};
  let version:string|null=null;
  try{
    const tags=await get('/api/tags');
    if(!tags.models?.some((m:any)=>m.name===GEMMA_SHADOW.model&&String(m.digest).replace(/^sha256:/,'')===GEMMA_SHADOW.digest))return refuse('installed Gemma does not match the pinned digest; nothing downloaded');
    if((await get('/api/ps')).models?.length)return refuse('another local model is loaded');
    version=(await get('/api/version')).version??null;
  }catch(e){return refuse('Ollama unavailable: '+String((e as Error).message).slice(0,200));}
  const config={digest:GEMMA_SHADOW.digest,context:GEMMA_SHADOW.context,maxOutput:GEMMA_SHADOW.maxOutput,temperature:GEMMA_SHADOW.temperature,think:false,coldPerCase:true,ollama:version};
  const base={listingId:set.listingId,reader:'gemma' as const,model:GEMMA_SHADOW.model,config,urlKey:set.urlKey,fingerprint:set.fingerprint,imageHashes:set.imageHashes};
  const body={model:GEMMA_SHADOW.model,stream:false,think:false,keep_alive:0,format:shadowSchema(),
    options:{temperature:GEMMA_SHADOW.temperature,num_ctx:GEMMA_SHADOW.context,num_predict:GEMMA_SHADOW.maxOutput},
    messages:[{role:'user',content:shadowPrompt(set.images.length),images:set.images.map(i=>Buffer.from(i.bytes).toString('base64'))}]};
  const ac=new AbortController(),started=Date.now();
  let stopped:string|null=null;
  const deadline=setTimeout(()=>{stopped='timed out';ac.abort();},GEMMA_SHADOW.timeoutMs);
  const watch=setInterval(()=>{if(guards.paused()){stopped='paused mid-read';ac.abort();}},500);
  try{
    const response=await request(new URL('/api/chat',endpoint),{method:'POST',redirect:'error',signal:ac.signal,headers:{'content-type':'application/json'},body:JSON.stringify(body),...({timeout:false} as object)});
    const raw=await response.text();
    if(!response.ok)throw new Error('Ollama HTTP '+response.status);
    const data=JSON.parse(raw) as {done?:boolean;done_reason?:string;message?:{content?:string};prompt_eval_count?:number;eval_count?:number};
    if(data.done!==true||data.done_reason==='length')throw new Error('Gemma output incomplete or truncated');
    const read=evidenceRead.parse(JSON.parse(data.message?.content??''));
    const readId=record(d,{...base,outcome:'read',claims:read,usage:{promptTokens:data.prompt_eval_count??null,outputTokens:data.eval_count??null},costMicros:0,elapsedMs:Date.now()-started},now());
    return {outcome:'read',readId,elapsedMs:Date.now()-started,claims:read.fields.length};
  }catch(e){
    // A pause is the owner taking the GPU back, not a failure of this photo set.
    if(stopped==='paused mid-read')return refuse(stopped);
    const error=stopped??String((e as Error)?.message??e).slice(0,300);
    return {outcome:'failed',error,readId:record(d,{...base,outcome:'failed',error,costMicros:0,elapsedMs:Date.now()-started},now())};
  }finally{
    clearTimeout(deadline);clearInterval(watch);
    if(ac.signal.aborted)await request(new URL('/api/generate',endpoint),{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{'content-type':'application/json'},body:JSON.stringify({model:GEMMA_SHADOW.model,keep_alive:0})}).catch(()=>{});
  }
}

/**
 * A pass killed mid-read (waiting collection work, a timeout) cannot run its
 * cleanup, so the next pass unloads the pinned model if it is still resident.
 * Only this exact model is touched; any other loaded model makes gemmaRead refuse.
 */
export async function releaseGemma(request:typeof fetch=fetch,endpoint='http://127.0.0.1:11434') {
  try{
    const ps=await (await request(new URL('/api/ps',endpoint),{signal:AbortSignal.timeout(5000),redirect:'error'})).json() as {models?:{name:string}[]};
    if(!ps.models?.some(m=>m.name===GEMMA_SHADOW.model))return false;
    await request(new URL('/api/generate',endpoint),{method:'POST',redirect:'error',signal:AbortSignal.timeout(30_000),headers:{'content-type':'application/json'},body:JSON.stringify({model:GEMMA_SHADOW.model,keep_alive:0})});
    return true;
  }catch{return false;}
}

const ABSTAIN=/^(unknown|unreadable|not visible|not readable|n\/a|unspecified)$/i;
/** The benchmark's agreement key: field plus normalized value with spaces removed. */
export const agreementKey=(c:Pick<Claim,'field'|'value'>)=>c.field+'|'+canonical(String(c.value)).replace(/\s+/g,'');
const assertion=(c:Claim)=>c.field!=='brand'&&!ABSTAIN.test(c.value.trim());
const fact=(c:Claim)=>({field:c.field,value:c.value,image:c.image,quote:c.quote,role:c.role,complete:c.complete});

/**
 * Agreed facts need the same field and normalized value from both readers;
 * role and photo index may differ. A field both readers report with no shared
 * value is a conflict. Everything else is single-reader and unchecked.
 */
export function agreement(luna:Claim[],gemma:Claim[]) {
  const L=luna.filter(assertion),G=gemma.filter(assertion);
  const gByKey=new Map<string,Claim>();for(const c of G)if(!gByKey.has(agreementKey(c)))gByKey.set(agreementKey(c),c);
  const lKeys=new Set(L.map(agreementKey)),seen=new Set<string>();
  type Fact=ReturnType<typeof fact>;
  const agreed:(Fact&{other:{image:number;quote:string;role:Claim['role']}})[]=[],lunaOnly:Fact[]=[];
  for(const c of L){
    const key=agreementKey(c),g=gByKey.get(key);
    if(!g){lunaOnly.push(fact(c));continue;}
    if(seen.has(key))continue;seen.add(key);
    agreed.push({...fact(c),other:{image:g.image,quote:g.quote,role:g.role}});
  }
  const gemmaOnly=G.filter(c=>!lKeys.has(agreementKey(c))).map(fact);
  const agreedFields=new Set(agreed.map(a=>a.field));
  const conflicts=[...new Set(lunaOnly.map(c=>c.field))].filter(f=>!agreedFields.has(f)&&gemmaOnly.some(c=>c.field===f)).map(field=>({field,
    luna:[...new Set(lunaOnly.filter(c=>c.field===field).map(c=>c.value))],gemma:[...new Set(gemmaOnly.filter(c=>c.field===field).map(c=>c.value))]}));
  return {agreed,conflicts,lunaOnly,gemmaOnly};
}

const timestamp=z.iso.datetime();
const field=evidenceRead.shape.fields.element.shape.field,role=evidenceRead.shape.fields.element.shape.role;
const factSchema=z.object({field,value:z.string().min(1).max(180),image:z.number().int().min(0).max(MAX_SHADOW_PHOTOS-1),quote:z.string().min(1).max(300),role,complete:z.boolean(),
  other:z.object({image:z.number().int().min(0).max(MAX_SHADOW_PHOTOS-1),quote:z.string().min(1).max(300),role}).optional()});
export const photoReadingSchema=z.object({
  version:z.literal(1),promptSha:z.string().regex(/^[a-f0-9]{64}$/),fingerprint:z.string().regex(/^[a-f0-9]{32}$/),
  photoCount:z.number().int().min(1).max(MAX_SHADOW_PHOTOS),status:z.enum(['luna_only','verified','gemma_failed']),
  luna:z.object({model:z.string().max(100),effort:z.string().max(20),readAt:timestamp}),
  gemma:z.object({model:z.string().max(100),digest:z.string().regex(/^[a-f0-9]{64}$/),readAt:timestamp}).nullable(),
  agreed:z.array(factSchema).max(60),conflicts:z.array(z.object({field,luna:z.array(z.string().max(180)).max(20),gemma:z.array(z.string().max(180)).max(20)})).max(20),
  lunaOnly:z.array(factSchema).max(60),gemmaOnly:z.array(factSchema).max(60),updatedAt:timestamp,
});
export type PhotoReading=z.infer<typeof photoReadingSchema>;

/** The display payload for the newest Luna read of a listing, verified by Gemma when available. Callers ensure the table. */
export function photoReading(d:Database,listingId:number):PhotoReading|null {
  const luna=d.query(`SELECT * FROM photo_reads WHERE listing_id=? AND reader='luna' AND outcome='read' AND prompt_sha=? ORDER BY id DESC LIMIT 1`).get(listingId,SHADOW_PROMPT_SHA) as any;
  if(!luna?.fingerprint)return null;
  const gemmaRows=d.query(`SELECT * FROM photo_reads WHERE listing_id=? AND reader='gemma' AND prompt_sha=? AND fingerprint=? ORDER BY id DESC`).all(listingId,SHADOW_PROMPT_SHA,luna.fingerprint) as any[];
  const gemma=gemmaRows.find(r=>r.outcome==='read')??null,gaveUp=!gemma&&gemmaRows.filter(r=>r.outcome==='failed').length>=SHADOW_MAX_FAILURES;
  const l=evidenceRead.parse(JSON.parse(luna.claims)).fields,g=gemma?evidenceRead.parse(JSON.parse(gemma.claims)).fields:[];
  const photoCount=JSON.parse(luna.image_hashes).length,inRange=(c:Claim)=>c.image>=0&&c.image<photoCount;
  const a=agreement(l.filter(inRange),g.filter(inRange));
  return photoReadingSchema.parse({version:1,promptSha:SHADOW_PROMPT_SHA,fingerprint:luna.fingerprint,photoCount,
    status:gemma?'verified':gaveUp?'gemma_failed':'luna_only',
    luna:{model:luna.model,effort:JSON.parse(luna.config).effort,readAt:luna.created_at},
    gemma:gemma?{model:gemma.model,digest:JSON.parse(gemma.config).digest,readAt:gemma.created_at}:null,
    agreed:gemma?a.agreed:[],conflicts:gemma?a.conflicts:[],lunaOnly:gemma?a.lunaOnly:l.filter(assertion).filter(inRange).map(fact),gemmaOnly:gemma?a.gemmaOnly:[],
    updatedAt:gemma&&gemma.created_at>luna.created_at?gemma.created_at:luna.created_at});
}

/** Luna reads that Gemma has not verified, newest first; reads with no assertions are skipped because agreement could add nothing. */
export function pendingVerification(d:Database,limit:number) {
  ensurePhotoShadow(d);
  const rows=d.query(`SELECT r.* FROM photo_reads r JOIN listings l ON l.id=r.listing_id
    WHERE r.reader='luna' AND r.outcome='read' AND r.prompt_sha=? AND l.delisted_at IS NULL
      AND r.id=(SELECT MAX(id) FROM photo_reads x WHERE x.listing_id=r.listing_id AND x.reader='luna' AND x.outcome='read')
    ORDER BY r.id DESC`).all(SHADOW_PROMPT_SHA) as any[];
  return rows.filter(r=>!readerDone(d,r.listing_id,'gemma',{fingerprint:r.fingerprint})&&evidenceRead.parse(JSON.parse(r.claims)).fields.some(assertion))
    .slice(0,limit).map(r=>({listingId:r.listing_id as number,urlKey:r.url_key as string,fingerprint:r.fingerprint as string,imageHashes:JSON.parse(r.image_hashes) as string[]}));
}
