import {test,expect} from 'bun:test';import {isolated} from './isolated.ts';
import {reconcileReads,evaluateRead,gpuAvailable} from '../src/vision/local-lab.ts';
import {evaluateFacts} from '../src/vision/evaluation.ts';

test('evaluation accepts typography while preserving model suffixes and capacities',()=>{
 const fields=[{field:'cpu' as const,value:'Intel(R) Core(TM) i5-1335U',quote:'Intel(R) Core(TM) i5-1335U'},
 {field:'vram' as const,value:'128 MB',quote:'128 MB'},
 {field:'model' as const,value:'12G-P5-3657-KR',quote:'12G-P5-3657-KR'}];
 const metrics=evaluateFacts({cpu:['Intel Core i5-1335U'],vram:['128MB'],model:['12G-P5-3657-RX']},reconcileReads([{fields,unreadable:false}]));
 expect(metrics.correct).toBe(2);expect(metrics.unsupported).toBe(1);expect(metrics.missed).toBe(1);
});
test('photo conflicts stay separate and unsupported claims count against evaluation',()=>{
  const read=reconcileReads([{fields:[{field:'gpu',value:'RTX 4070 Ti',quote:'RTX 4070 Ti'}],unreadable:false},{fields:[{field:'gpu',value:'RTX 4070',quote:'RTX 4070'},{field:'ram',value:'32GB',quote:'32GB'}],unreadable:true}]);
  expect(read.conflicts).toEqual(['gpu']);expect(read.unreadableImages).toEqual([1]);expect(evaluateRead({gpu:['RTX 4070 Ti'],cpu:['9700X']},read)).toEqual({correct:1,missed:1,unsupported:2});
  expect(gpuAvailable(()=> '95, 8000')).toBe(false);expect(gpuAvailable(()=> '0, 500')).toBe(true);expect(gpuAvailable(()=> 'N/A, N/A')).toBe(false);
});
test('local vision refuses cloud endpoints, busy GPUs and changed models without downloading anything',()=>isolated(`
  import {readLocalPhotos} from '@/src/vision/local-lab.ts';import {writeFileSync} from 'node:fs';
  writeFileSync('photo.bin','synthetic fixture');let requests=0;
  const opts={model:'fixture:local',digest:'a'.repeat(64),idle:()=>true,paused:()=>false,request:async()=>{requests++;return new Response(JSON.stringify({models:[{name:'fixture:local',digest:'b'.repeat(64)}]}));}};
  await assert.rejects(readLocalPhotos(['photo.bin'],{...opts,endpoint:'https://example.invalid'}));assert.equal(requests,0);
  await assert.rejects(readLocalPhotos(['photo.bin'],{...opts,idle:()=>false}));assert.equal(requests,0);
  await assert.rejects(readLocalPhotos(['photo.bin'],opts));assert.equal(requests,1);
  requests=0;opts.request=async()=>{requests++;return new Response(JSON.stringify(requests===1?{models:[{name:opts.model,digest:opts.digest}]}:{done:true,message:{content:JSON.stringify({fields:[],unreadable:true})}}));};
  const result=await readLocalPhotos(['photo.bin','photo.bin'],opts);assert.equal(result.usage,'evaluation-only');assert.equal(result.imageHashes.length,2);assert.deepEqual(result.unreadableImages,[0,1]);assert.equal(requests,3);
  const traces=[];requests=0;opts.request=async()=>{requests++;return new Response(JSON.stringify(requests===1?{models:[{name:opts.model,digest:opts.digest}]}:{done:true,done_reason:'length',eval_count:2048,message:{content:JSON.stringify({fields:[],unreadable:true})}}));};
  await assert.rejects(readLocalPhotos(['photo.bin'],{...opts,trace:t=>traces.push(t)}),/truncated/);assert.equal(traces.length,1);assert.equal(JSON.parse(traces[0].raw).eval_count,2048);
`));
