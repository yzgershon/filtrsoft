/**
 * bun run photo:shadow --luna [--limit 10] [--dry]
 * bun run photo:shadow --gemma [--minutes 12]
 * bun run photo:shadow --status
 *
 * Display-only photo readings (src/vision/photo-shadow.ts). The Luna pass
 * spends against the approved $0.50/UTC-day cap and stops at it. The Gemma
 * pass uses this machine's GPU only when it is idle and nobody has touched the
 * keyboard or mouse for 10 minutes, and stops within seconds of either
 * changing. Neither writes facts or verdicts. The API key is never printed.
 */
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {db} from '../db/index.ts';
import {checkStored} from '../engine/index.ts';
import {resolveProductType} from '../signals/product-type.ts';
import {isAccessoryFor} from '../crawler/vision-pass.ts';
import {readEnvValue} from '../ai/openai-responses.ts';
import {spendSummary,setCap} from '../ai/spend-cap.ts';
import {gpuAvailable} from '../vision/local-lab.ts';
import {STATE_DIR} from '../agent/state.ts';
import {userIdleMs} from '../agent/user-idle.ts';
import {isPaused} from './pause.ts';
import {SHADOW_SCOPE,SHADOW_CAP_MICROS,SHADOW_APPROVAL,MAX_SHADOW_PHOTOS,shadowCandidates,oversizedGalleries,worthReading,lunaRead,gemmaRead,pendingVerification,ensurePhotoShadow,readerDone,recordUnreadable,releaseGemma} from '../vision/photo-shadow.ts';
import {acquirePhotoSet,loadPhotoSet,pruneShadowPhotos} from '../vision/photo-shadow-files.ts';

const arg=(k:string)=>{const i=process.argv.indexOf(`--${k}`);return i>=0?process.argv[i+1]:undefined;};
const has=(k:string)=>process.argv.includes(`--${k}`);
const d=db();ensurePhotoShadow(d);setCap(d,SHADOW_SCOPE,SHADOW_CAP_MICROS,'utc-day',SHADOW_APPROVAL);
const usd=(micros:number)=>`$${(micros/1e6).toFixed(4)}`;
const today=()=>spendSummary(d,SHADOW_SCOPE);
const monthMicros=()=>(d.query(`SELECT COALESCE(SUM(CASE status WHEN 'settled' THEN actual_micros WHEN 'released' THEN 0 ELSE reserved_micros END),0) m
  FROM ai_spend WHERE scope=? AND created_at>=?`).get(SHADOW_SCOPE,new Date().toISOString().slice(0,7)+'-01T00:00:00.000Z') as {m:number}).m;

function apiKey() {
  const direct=process.env.OPENAI_API_KEY?.trim();if(direct)return direct;
  const file=process.env.FILTRSOFT_OPENAI_ENV_FILE;if(!file)return null;
  try{return readEnvValue(readFileSync(file,'utf8'),'OPENAI_API_KEY');}catch{return null;}
}

const eligible=(c:{id:number;title:string})=>{
  if(resolveProductType(c.title).kind!=='tech'||isAccessoryFor(c.title))return false;
  try{return worthReading(checkStored(c.id).verdict as any);}catch{return false;}
};

if(has('status')) {
  const t=today(),reads=d.query(`SELECT reader,outcome,COUNT(*) n FROM photo_reads WHERE created_at>=? GROUP BY reader,outcome`).all(new Date().toISOString().slice(0,10)+'T00:00:00.000Z');
  console.log(JSON.stringify({todayUsd:t.committedMicros/1e6,capUsd:t.capMicros/1e6,monthUsd:monthMicros()/1e6,readsToday:reads,
    waitingForGemma:pendingVerification(d,10_000).length,galleriesOver6Photos72h:oversizedGalleries(d)},null,1));
} else if(has('luna')) {
  const limit=Math.max(1,Math.min(50,Number(arg('limit'))||10));
  const {candidates,notWorthReading}=shadowCandidates(d,{limit,eligible});
  console.log(`photo-shadow: ${candidates.length} listing(s) to read, ${notWorthReading} recent listing(s) not worth a read, ${oversizedGalleries(d)} with more than ${MAX_SHADOW_PHOTOS} photos skipped; ${usd(today().committedMicros)} of ${usd(SHADOW_CAP_MICROS)} used today`);
  if(has('dry')){for(const c of candidates)console.log(`  would read #${c.id} (${c.urls.length} photos) ${c.title.slice(0,60)}`);process.exit(0);}
  const key=apiKey();
  if(!key?.startsWith('sk-')){console.error('photo-shadow: OpenAI key not configured (FILTRSOFT_OPENAI_ENV_FILE); nothing sent');process.exit(1);}
  let read=0,failures=0;
  for(const c of candidates) {
    let set;
    try{set=await acquirePhotoSet(c.id,c.urls);}
    catch(e){
      console.log(`photo-shadow: luna #${c.id} photos unavailable: ${String((e as Error).message).slice(0,120)}`);
      recordUnreadable(d,{listingId:c.id,reader:'luna',urlKey:c.urlKey,error:'download: '+String((e as Error).message).slice(0,200)});
      continue;
    }
    const r=await lunaRead(d,set,{apiKey:key});
    if(r.outcome==='budget'){console.log(`photo-shadow: daily cap reached; ${r.error}`);break;}
    if(r.outcome==='rate_limited'){console.log('photo-shadow: rate limited; next pass retries');break;}
    if(r.outcome==='reused'){console.log(`photo-shadow: luna #${c.id} same photos already read`);continue;}
    if(r.outcome==='failed'){console.log(`photo-shadow: luna #${c.id} failed: ${r.error}`);if(++failures>=3||/exceeded the reservation/.test(r.error??''))break;continue;}
    read++;failures=0;
    console.log(`photo-shadow: luna #${c.id} ${set.images.length} photos, ${r.claims} claims, ${usd(r.costMicros??0)}, ${((r.elapsedMs??0)/1000).toFixed(1)}s`);
  }
  pruneShadowPhotos(d);
  console.log(`photo-shadow: read ${read}; ${usd(today().committedMicros)} of ${usd(SHADOW_CAP_MICROS)} used today, ${usd(monthMicros())} this month`);
} else if(has('gemma')) {
  const deadline=Date.now()+Math.max(1,Math.min(30,Number(arg('minutes'))||12))*60_000;
  const AWAY_MS=10*60_000,BACK_MS=60_000;
  pruneShadowPhotos(d);
  let lastCheck=0,present=false;
  // A person at the keyboard wins. Checked about every 20 s during a read.
  const userBack=()=>{if(Date.now()-lastCheck>20_000){lastCheck=Date.now();const ms=userIdleMs();present=ms===null||ms<BACK_MS;}return present;};
  const paused=()=>isPaused()||existsSync(join(STATE_DIR,'pause-gpu'))||userBack();
  let verified=0;
  const idleAtStart=userIdleMs();
  if(idleAtStart!==null&&idleAtStart>=AWAY_MS&&await releaseGemma())await Bun.sleep(5000);
  for(const p of pendingVerification(d,50)) {
    if(Date.now()>deadline)break;
    const away=userIdleMs();
    if(away===null||away<AWAY_MS){console.log('photo-shadow: someone is using this PC; Gemma waits');break;}
    const set=loadPhotoSet(p.listingId,p.fingerprint);
    if(!set){
      if(!readerDone(d,p.listingId,'gemma',{fingerprint:p.fingerprint}))recordUnreadable(d,{listingId:p.listingId,reader:'gemma',urlKey:p.urlKey,fingerprint:p.fingerprint,error:'photos expired before local verification'});
      continue;
    }
    lastCheck=0;
    const r=await gemmaRead(d,set,{idle:()=>gpuAvailable(),paused});
    if(r.outcome==='refused'){console.log(`photo-shadow: Gemma not started: ${r.error}`);break;}
    if(r.outcome==='failed'){console.log(`photo-shadow: gemma #${p.listingId} failed: ${r.error}`);continue;}
    verified++;console.log(`photo-shadow: gemma #${p.listingId} ${set.images.length} photos, ${r.claims} claims, ${((r.elapsedMs??0)/1000).toFixed(0)}s`);
  }
  pruneShadowPhotos(d);
  console.log(`photo-shadow: Gemma verified ${verified}; ${pendingVerification(d,10_000).length} waiting`);
} else {
  console.error('usage: photo:shadow --luna [--limit N] [--dry] | --gemma [--minutes N] | --status');process.exit(2);
}
