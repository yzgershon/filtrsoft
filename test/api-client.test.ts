import {test} from 'bun:test';
import {isolated} from './isolated.ts';

test('frontend request deadline covers a stalled response body and releases its timer',()=>isolated(`
  import {requestJSON} from '@/web/src/api-client.ts';
  let deadline,cleared=0,signal;
  globalThis.setTimeout=(fn,ms)=>{assert.equal(ms,15000);deadline=fn;return 42;};
  globalThis.clearTimeout=id=>{assert.equal(id,42);cleared++;};
  globalThis.fetch=async(url,init)=>{signal=init.signal;return {ok:true,status:200,json:()=>new Promise((_,reject)=>{
    signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
  })};};
  const result=requestJSON('/fixture');await Promise.resolve();deadline();
  await assert.rejects(result,/took too long/);assert.equal(signal.aborted,true);assert.equal(cleared,1);
`));

test('frontend request handles server errors, validation, successful bodies and caller cancellation',()=>isolated(`
  import {requestJSON} from '@/web/src/api-client.ts';
  globalThis.fetch=async()=>new Response(JSON.stringify({value:17}),{status:200});
  assert.deepEqual(await requestJSON('/fixture'),{value:17});
  await assert.rejects(requestJSON('/fixture',undefined,v=>v.value===18),/incomplete/);
  globalThis.fetch=async()=>new Response(JSON.stringify({error:'database_busy'}),{status:503});
  await assert.rejects(requestJSON('/fixture'),/database busy/);
  globalThis.fetch=async(url,init)=>new Promise((_,reject)=>{
    if(init.signal.aborted)reject(init.signal.reason);
    else init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});
  });
  const ac=new AbortController(),pending=requestJSON('/fixture',{signal:ac.signal});ac.abort();
  await assert.rejects(pending,e=>e.name==='AbortError');
`));
