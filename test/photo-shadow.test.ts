import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {isolated} from './isolated.ts';
import {evidencePrompt,type Claim} from '../src/vision/evidence-evaluation.ts';
import {SHADOW_PROMPT_SHA,SHADOW_SCOPE,SHADOW_CAP_MICROS,SHADOW_APPROVAL,LUNA_SHADOW,GEMMA_SHADOW,MAX_SHADOW_PHOTOS,shadowSchema,sha256,agreement,worthReading,
  lunaRead,gemmaRead,photoReading,ensurePhotoShadow,readerDone,pendingVerification,type PhotoSet} from '../src/vision/photo-shadow.ts';
import {setCap,reserve,spendSummary} from '../src/ai/spend-cap.ts';
import {isAccessoryFor} from '../src/crawler/vision-pass.ts';
import {userIdleMs} from '../src/agent/user-idle.ts';

const claim=(field:Claim['field'],value:string,extra:Partial<Claim>={}):Claim=>({field,value,quote:value,image:0,role:'item',complete:true,...extra});
const set=(photos=2,fingerprint='a'.repeat(32)):PhotoSet=>({listingId:7,urlKey:'u'.repeat(64),fingerprint,imageHashes:Array.from({length:photos},(_,i)=>String(i).repeat(64)),
  images:Array.from({length:photos},()=>({bytes:new Uint8Array([1,2,3]),mime:'image/jpeg',width:1024,height:768}))});
const lunaBody=(fields:Claim[])=>({id:'resp_1',model:'gpt-6-luna',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({fields})}]}],
  usage:{input_tokens:3000,output_tokens:800,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:700}}});
const memory=()=>{const d=new Database(':memory:');d.run('CREATE TABLE listings(id INTEGER PRIMARY KEY,delisted_at TEXT)');d.run('INSERT INTO listings VALUES(7,NULL)');ensurePhotoShadow(d);return d;};

test('shadow reads use exactly the benchmarked prompt, schema, effort and local model',()=>{
  // Changing any of these invalidates docs/LUNA-GEMMA-EVALUATION-2026-09-22.md.
  expect(sha256(evidencePrompt)).toBe(SHADOW_PROMPT_SHA);
  expect(sha256(JSON.stringify(shadowSchema()))).toBe('cca91adb6abfe1a6e13c65edca0f474b053468437d573c9c5c9cae4ff059bee3');
  expect([LUNA_SHADOW.model,LUNA_SHADOW.effort,LUNA_SHADOW.detail]).toEqual(['gpt-6-luna','high','original']);
  expect(GEMMA_SHADOW).toMatchObject({model:'gemma4:31b-it-qat',digest:'e0812a55773bfeac846b2d605b4d93638b8dfa7119d9587f3d91475afc78185e',context:16384,maxOutput:4096,temperature:0});
  expect(MAX_SHADOW_PHOTOS).toBe(6);
  expect([SHADOW_CAP_MICROS,/2026-09-23/.test(SHADOW_APPROVAL)]).toEqual([500_000,true]);
});

test('Luna sends every photo once at original detail and settles the measured cost against the daily cap',async()=>{
  const d=memory();const bodies:any[]=[];
  const fetchImpl=(async(_url:string,init:any)=>{bodies.push(JSON.parse(init.body));return new Response(JSON.stringify(lunaBody([claim('gpu','RTX 3080'),claim('brand','EVGA')])),{status:200});}) as any;
  const r=await lunaRead(d,set(3),{apiKey:'sk-test',fetchImpl});
  expect(r.outcome).toBe('read');expect(bodies.length).toBe(1);
  const b=bodies[0];
  expect([b.model,b.reasoning.effort,b.store,b.temperature,b.max_output_tokens]).toEqual(['gpt-6-luna','high',false,undefined,16384]);
  const images=b.input[0].content.filter((c:any)=>c.type==='input_image');
  expect(images.map((i:any)=>i.detail)).toEqual(['original','original','original']);
  expect(b.input[0].content[0].text).toBe(evidencePrompt+'\nThere are 3 photos, numbered 0 through 2.');
  const s=spendSummary(d,SHADOW_SCOPE);
  expect([s.window,s.capMicros,s.committedMicros]).toEqual(['utc-day',500_000,300+400]);
  const reading=photoReading(d,7)!;
  expect(reading.status).toBe('luna_only');expect(reading.lunaOnly.map(f=>f.value)).toEqual(['RTX 3080']);expect(reading.agreed).toEqual([]);
  // The same photos under re-signed CDN links are not paid for twice.
  expect((await lunaRead(d,{...set(3),urlKey:'v'.repeat(64)},{apiKey:'sk-test',fetchImpl})).outcome).toBe('reused');expect(bodies.length).toBe(1);
});

test('the daily cap refuses before sending; rate limits are released and transport failures stay counted',async()=>{
  const d=memory();let calls=0;
  setCap(d,SHADOW_SCOPE,SHADOW_CAP_MICROS,'utc-day',SHADOW_APPROVAL);
  reserve(d,SHADOW_SCOPE,495_000,{provider:'openai',model:'gpt-6-luna',purpose:'fixture'});
  const refused=await lunaRead(d,set(),{apiKey:'sk-test',fetchImpl:(async()=>{calls++;return new Response('{}');}) as any});
  expect([refused.outcome,calls]).toEqual(['budget',0]);
  const e=memory();
  const limited=await lunaRead(e,set(),{apiKey:'sk-test',fetchImpl:(async()=>new Response(JSON.stringify({error:{code:'rate_limit_exceeded',message:'try again in 2s'}}),{status:429})) as any});
  expect(limited.outcome).toBe('rate_limited');expect(spendSummary(e,SHADOW_SCOPE).committedMicros).toBe(0);
  const lost=await lunaRead(e,set(),{apiKey:'sk-test',fetchImpl:(async()=>{throw new Error('socket closed');}) as any});
  expect(lost.outcome).toBe('failed');
  expect(spendSummary(e,SHADOW_SCOPE).byStatus.find(x=>x.status==='uncertain')?.n).toBe(1);
  expect(readerDone(e,7,'luna',{urlKey:'u'.repeat(64)})).toBe(false);
});

test('Gemma never starts on a busy GPU or a different model, and uses the September 18 request',async()=>{
  const d=memory();let requests=0;
  const busy=await gemmaRead(d,set(),{idle:()=>false,paused:()=>false},{request:(async()=>{requests++;return new Response('{}');}) as any});
  expect([busy.outcome,busy.error,requests]).toEqual(['refused','GPU busy',0]);
  const tags=(digest:string,loaded:string[]=[])=>(async(url:URL,init?:any)=>{
    const path=new URL(url).pathname;
    if(path==='/api/tags')return new Response(JSON.stringify({models:[{name:GEMMA_SHADOW.model,digest}]}));
    if(path==='/api/ps')return new Response(JSON.stringify({models:loaded.map(name=>({name}))}));
    if(path==='/api/version')return new Response(JSON.stringify({version:'0.34.3'}));
    return new Response(JSON.stringify({done:true,done_reason:'stop',message:{content:JSON.stringify({fields:[claim('gpu','RTX 3080',{image:1,quote:'GeForce RTX 3080'})]})},body:init?.body}));
  }) as any;
  const guards={idle:()=>true,paused:()=>false,freeMemory:()=>16*1024**3};
  expect((await gemmaRead(d,set(),guards,{request:tags('f'.repeat(64))})).error).toMatch(/pinned digest/);
  expect((await gemmaRead(d,set(),guards,{request:tags(GEMMA_SHADOW.digest,['qwen3-vl:8b-instruct'])})).error).toBe('another local model is loaded');
  const sent:any[]=[];
  const r=await gemmaRead(d,set(),guards,{request:(async(url:URL,init?:any)=>{if(new URL(url).pathname==='/api/chat')sent.push(JSON.parse(init.body));return tags(GEMMA_SHADOW.digest)(url,init);}) as any});
  expect(r.outcome).toBe('read');
  expect(sent[0]).toMatchObject({model:GEMMA_SHADOW.model,stream:false,think:false,keep_alive:0,options:{temperature:0,num_ctx:16384,num_predict:4096}});
  expect(sent[0].format).toEqual(shadowSchema());expect(sent[0].messages[0].images.length).toBe(2);
});

test('pausing or returning to the PC aborts a Gemma read and unloads the model without counting a failure',async()=>{
  const d=memory();let paused=false;const unloads:any[]=[];
  const request=(async(url:URL,init?:any)=>{
    const path=new URL(url).pathname;
    if(path==='/api/tags')return new Response(JSON.stringify({models:[{name:GEMMA_SHADOW.model,digest:GEMMA_SHADOW.digest}]}));
    if(path==='/api/ps')return new Response(JSON.stringify({models:[]}));
    if(path==='/api/version')return new Response(JSON.stringify({version:'0.34.3'}));
    if(path==='/api/generate'){unloads.push(JSON.parse(init.body));return new Response('{}');}
    setTimeout(()=>{paused=true;},50);
    return await new Promise<Response>((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted'))));
  }) as any;
  const r=await gemmaRead(d,set(),{idle:()=>true,paused:()=>paused,freeMemory:()=>16*1024**3},{request});
  expect([r.outcome,r.error]).toEqual(['refused','paused mid-read']);
  expect(unloads).toEqual([{model:GEMMA_SHADOW.model,keep_alive:0}]);
  expect(d.query("SELECT COUNT(*) n FROM photo_reads WHERE reader='gemma'").get()).toEqual({n:0});
});

test('agreement matches the benchmark rule: same field and normalized value; brand and abstentions never count',()=>{
  const a=agreement(
    [claim('gpu','GeForce RTX 3080'),claim('ram','16 GB',{role:'kit_total'}),claim('brand','EVGA'),claim('cpu','unknown'),claim('storage','1TB'),claim('model','X570')],
    [claim('gpu','geforce  rtx 3080',{image:1}),claim('ram','16GB',{role:'module'}),claim('brand','EVGA'),claim('storage','2TB'),claim('vram','10GB')]);
  expect(a.agreed.map(f=>[f.field,f.value,f.other?.image])).toEqual([['gpu','GeForce RTX 3080',1],['ram','16 GB',0]]);
  expect(a.conflicts).toEqual([{field:'storage',luna:['1TB'],gemma:['2TB']}]);
  expect(a.lunaOnly.map(f=>f.field)).toEqual(['storage','model']);expect(a.gemmaOnly.map(f=>f.field)).toEqual(['storage','vram']);
});

test('a verified reading shows agreed facts and conflicts; Luna reads with nothing to verify are not queued for Gemma',async()=>{
  const d=memory();
  await lunaRead(d,set(2),{apiKey:'sk-test',fetchImpl:(async()=>new Response(JSON.stringify(lunaBody([claim('gpu','RTX 3080'),claim('storage','1TB')])))) as any});
  expect(pendingVerification(d,10).map(p=>p.listingId)).toEqual([7]);
  const request=(async(url:URL)=>{const path=new URL(url).pathname;
    if(path==='/api/tags')return new Response(JSON.stringify({models:[{name:GEMMA_SHADOW.model,digest:GEMMA_SHADOW.digest}]}));
    if(path==='/api/ps')return new Response(JSON.stringify({models:[]}));
    if(path==='/api/version')return new Response(JSON.stringify({version:'0.34.3'}));
    return new Response(JSON.stringify({done:true,done_reason:'stop',message:{content:JSON.stringify({fields:[claim('gpu','RTX 3080'),claim('storage','2TB')]})}}));}) as any;
  await gemmaRead(d,set(2),{idle:()=>true,paused:()=>false,freeMemory:()=>16*1024**3},{request});
  const reading=photoReading(d,7)!;
  expect(reading.status).toBe('verified');expect(reading.agreed.map(f=>f.value)).toEqual(['RTX 3080']);expect(reading.conflicts.map(c=>c.field)).toEqual(['storage']);
  expect(pendingVerification(d,10)).toEqual([]);
  const e=memory();
  await lunaRead(e,set(1),{apiKey:'sk-test',fetchImpl:(async()=>new Response(JSON.stringify(lunaBody([claim('brand','Dell')])))) as any});
  expect(pendingVerification(e,10)).toEqual([]);
});

test('only photo-recoverable unknowns and actionable calls are worth a paid read; plural accessories are refused',()=>{
  expect(worthReading({call:'INSUFFICIENT_DATA',recovery:[{job:'photos'}]})).toBe(true);
  expect(worthReading({call:'INSUFFICIENT_DATA',recovery:[{job:'comps'}]})).toBe(false);
  expect([worthReading({call:'VERIFY'}),worthReading({call:'BUY'}),worthReading({call:'PASS'}),worthReading({call:'RISK'})]).toEqual([true,true,false,false]);
  expect(['Hello Kitty Phone Cases Lot','MacBook Pro Empty Box','USB-C cables'].map(isAccessoryFor)).toEqual([true,true,true]);
  expect(['ASUS ROG Gaming Laptop','Dell Precision tower with box','EVGA RTX 3080'].map(isAccessoryFor)).toEqual([false,false,false]);
});

test('user idle time parses the helper output and treats anything unreadable as someone present',()=>{
  if(process.platform==='win32'){expect(userIdleMs(()=> '12345\r\n')).toBe(12345);expect(userIdleMs(()=>{throw new Error('no session');})).toBeNull();expect(userIdleMs(()=> '-1')).toBeNull();}
  else expect(userIdleMs(()=> '12345')).toBeNull();
});

test('photo readings sync to the server as display-only rows and leave other snapshots unchanged',()=>isolated(`
  import {db} from '@/src/db/index.ts';
  import {upsertListingFacts} from '@/src/db/listings.ts';
  import {syncPhotoUrls,fingerprintOf} from '@/src/vision/merge.ts';
  import {captureChanges,pendingBatch,acknowledge} from '@/src/sync/outbox.ts';
  import {receiveChanges} from '@/src/sync/receive.ts';
  import {ensurePhotoShadow,SHADOW_PROMPT_SHA} from '@/src/vision/photo-shadow.ts';
  import {loadPhotoReading} from '@/src/vision/photo-readings.ts';
  const d=db(),target='https://example.invalid',at='2026-09-01T00:00:00.000Z';
  const base={source:'facebook',title:'RTX 3080',description:'Works',askingPriceCents:40000,location:null,postedAt:null,photoCount:1,raw:{}};
  const one=upsertListingFacts(d,{...base,sourceId:'one',url:'https://facebook.com/marketplace/item/one'},at).id;
  const two=upsertListingFacts(d,{...base,sourceId:'two',url:'https://facebook.com/marketplace/item/two'},at).id;
  syncPhotoUrls(one,['https://cdn.invalid/a.jpg']);d.run("UPDATE listing_photos SET phash='00000000000000ff'");
  captureChanges(d,target,'facebook');const first=pendingBatch(d,target,'facebook');
  assert.equal(first.changes.some(c=>'photoReading' in c.listing),false);
  acknowledge(d,target,first,receiveChanges(first).acks);
  // This fixture is both collector and server; settle what the receive itself changed.
  captureChanges(d,target,'facebook');const settled=pendingBatch(d,target,'facebook');acknowledge(d,target,settled,receiveChanges(settled).acks);
  assert.equal(captureChanges(d,target,'facebook'),0);
  ensurePhotoShadow(d);
  const fp=fingerprintOf(['00000000000000ff']),claims={fields:[{field:'gpu',value:'RTX 3080',quote:'RTX 3080',image:0,role:'item',complete:true}]};
  d.run("INSERT INTO photo_reads(listing_id,reader,model,config,prompt_sha,url_key,fingerprint,image_hashes,outcome,claims,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    [one,'luna','gpt-6-luna','{"effort":"high"}',SHADOW_PROMPT_SHA,'u'.repeat(64),fp,JSON.stringify(['a'.repeat(64)]),'read',JSON.stringify(claims),'2026-09-02T00:00:00.000Z']);
  assert.equal(captureChanges(d,target,'facebook'),1);
  const second=pendingBatch(d,target,'facebook');
  assert.equal(second.changes[0].listing.photoReading.status,'luna_only');
  const verdicts=d.query('SELECT COUNT(*) n FROM verdicts').get().n;
  d.run('DELETE FROM photo_reads');
  assert.equal(receiveChanges(second).acks[0].status,'applied');
  const shown=loadPhotoReading(one);
  assert.equal(shown.lunaOnly[0].value,'RTX 3080');assert.equal(shown.photosChanged,false);
  assert.equal(loadPhotoReading(two),null);
  assert.equal(d.query('SELECT COUNT(*) n FROM verdicts').get().n,verdicts);
  d.run("UPDATE listing_photos SET phash='00000000000000fe' WHERE listing_id=?",[one]);
  assert.equal(loadPhotoReading(one).photosChanged,true);
`));
