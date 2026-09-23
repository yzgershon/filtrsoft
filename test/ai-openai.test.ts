import {describe,test,expect} from 'bun:test';
import {GPT6_LUNA,costMicros,reservationMicros,imageTokenBound} from '../src/ai/pricing.ts';
import {strictSchema,buildRequestBody,parseResponse,redactor,postResponses,readEnvValue,rateLimitWaitMs} from '../src/ai/openai-responses.ts';

describe('Luna pricing',()=>{
 test('reasoning tokens are output tokens and cached input is cheaper',()=>{
  const usage={input_tokens:10_000,output_tokens:2_000,input_tokens_details:{cached_tokens:4_000},output_tokens_details:{reasoning_tokens:1_500}};
  // 6000*0.10 + 4000*0.01 + 2000*0.50 = 600 + 40 + 1000
  expect(costMicros(GPT6_LUNA,usage,'standard')).toBe(1_640);
  // conservative bills uncached input at the 0.125 cache-write rate: 750 + 40 + 1000
  expect(costMicros(GPT6_LUNA,usage)).toBe(1_790);
  // Luna reports writes explicitly: only those use the 0.125 rate. 5000*0.10 + 1000*0.125 + 40 + 1000
  expect(costMicros(GPT6_LUNA,{...usage,input_tokens_details:{cached_tokens:4_000,cache_write_tokens:1_000}})).toBe(1_665);
  expect(costMicros(GPT6_LUNA,{...usage,input_tokens_details:{cached_tokens:4_000,cache_write_tokens:0}})).toBe(1_640);
 });
 test('long prompts use the documented multipliers',()=>{
  expect(costMicros(GPT6_LUNA,{input_tokens:300_000,output_tokens:1_000},'standard')).toBe(60_000+750);
 });
 test('invalid usage cannot be settled',()=>{
  expect(()=>costMicros(GPT6_LUNA,{input_tokens:-1,output_tokens:0})).toThrow();
  expect(()=>costMicros(GPT6_LUNA,{input_tokens:1.5,output_tokens:0})).toThrow();
 });
 test('reservation covers max output at the output price',()=>{
  expect(reservationMicros(GPT6_LUNA,8_000,128_000)).toBe(1_000+64_000);
  expect(imageTokenBound(444,960)).toBe(14*30*2);
 });
});

describe('Responses adapter',()=>{
 const schema={$schema:'x',type:'object',properties:{v:{type:'string',minLength:1,maxLength:9},n:{type:'array',maxItems:3,items:{type:'integer',minimum:0}}},required:['v','n'],additionalProperties:false};
 test('strict schema strips unsupported keywords and reports them',()=>{
  const s=strictSchema(schema);
  expect(s.removed).toEqual(['$.$schema','$.properties.v.maxLength','$.properties.v.minLength']);
  expect(JSON.stringify(s.schema)).not.toContain('minLength');
  expect((s.schema as any).properties.n.maxItems).toBe(3);
 });
 test('request keeps images in order with detail, no storage and no tools',()=>{
  const body:any=buildRequestBody({model:'gpt-6-luna',effort:'none',prompt:'read',schemaName:'r',schema,maxOutputTokens:100,
   images:[{mime:'image/jpeg',data:new Uint8Array([1]),detail:'original'},{mime:'image/png',data:new Uint8Array([2]),detail:'original'}]});
  expect(body.store).toBe(false);expect(body.tools).toBeUndefined();expect(body.reasoning).toEqual({effort:'none'});
  expect(body.input[0].content.map((c:any)=>c.type)).toEqual(['input_text','input_image','input_image']);
  expect(body.input[0].content[2].image_url.startsWith('data:image/png;base64,')).toBe(true);
  expect(body.text.format.strict).toBe(true);
  expect(()=>buildRequestBody({...body,model:'m',effort:null,prompt:'p',schemaName:'r',schema,maxOutputTokens:1,images:[{mime:'text/plain',data:new Uint8Array(),detail:'high'}]})).toThrow();
 });
 test('parses text, refusal and incomplete status',()=>{
  const p=parseResponse({id:'resp_1',model:'gpt-6-luna-2026',status:'incomplete',incomplete_details:{reason:'max_output_tokens'},usage:{input_tokens:1,output_tokens:2},
   output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text:'{"a"'},{type:'output_text',text:':1}'}]}]});
  expect(p.text).toBe('{"a":1}');expect(p.incompleteReason).toBe('max_output_tokens');expect(p.status).toBe('incomplete');
  expect(parseResponse({output:[{type:'message',content:[{type:'refusal',refusal:'no'}]}]}).refusal).toBe('no');
 });
 test('the key never leaves the adapter in raw text',async()=>{
  const key='sk-test-abcdefghijklmnop';
  const fake=(async()=>new Response(JSON.stringify({error:{message:'bad key '+key}}),{status:401})) as unknown as typeof fetch;
  const r=await postResponses({},{apiKey:key,timeoutMs:1000,fetchImpl:fake});
  expect(r.httpStatus).toBe(401);expect(r.data).toBeNull();expect(r.raw).not.toContain(key);
  expect(redactor('')('token sk-other-123456789')).toBe('token [REDACTED]');
 });
 test('temperature only without reasoning',()=>{
  const base={model:'m',prompt:'p',schemaName:'r',schema,maxOutputTokens:1,images:[{mime:'image/jpeg',data:new Uint8Array([1]),detail:'high' as const}]};
  expect((buildRequestBody({...base,effort:'none',temperature:0}) as any).temperature).toBe(0);
  expect(()=>buildRequestBody({...base,effort:'low',temperature:0})).toThrow(/without reasoning/);
 });
 test('waits on rate limits but never on quota exhaustion or other errors',()=>{
  const body=(code:string,message:string)=>JSON.stringify({error:{code,message,type:'tokens'}});
  expect(rateLimitWaitMs(429,body('rate_limit_exceeded','Limit 200000, Used 200000. Please try again in 2.053s.'))).toBe(2303);
  expect(rateLimitWaitMs(429,body('rate_limit_exceeded','Please try again in 120ms.'))).toBe(1000);
  expect(rateLimitWaitMs(429,body('insufficient_quota','You exceeded your current quota'))).toBeNull();
  expect(rateLimitWaitMs(500,body('rate_limit_exceeded','try again in 1s'))).toBeNull();
  expect(rateLimitWaitMs(429,'not json')).toBeNull();
 });
 test('reads a private env value without surrounding quotes',()=>{
  expect(readEnvValue('# c\nOPENAI_API_KEY="sk-x-1"\nB=2','OPENAI_API_KEY')).toBe('sk-x-1');
  expect(readEnvValue('A=1','OPENAI_API_KEY')).toBeNull();
 });
});
