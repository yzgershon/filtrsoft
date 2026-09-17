import {test} from 'bun:test';
import {isolated} from './isolated.ts';
test('Facebook card capture retains unknown facts and all discovery precedes bounded enrichment',()=>isolated(`
  import {cardToListing} from '@/src/sources/facebook.ts';import {collectionPlan,SOURCES} from '@/src/agent/collection.ts';
  const card=cardToListing({sourceId:'1',url:'https://facebook.com/marketplace/item/1/',title:'Gaming PC',askingPriceCents:40000,location:null,thumb:'https://example.invalid/p.jpg'});
  assert.equal(card.description,'');assert.equal(card.postedAt,null);assert.equal(card.updatedAt,null);assert.equal(card.photoUrls.length,1);
  const plan=collectionPlan([...SOURCES],0);const firstDetail=plan.findIndex(s=>s.kind==='enrich');assert.ok(plan.slice(0,firstDetail).every(s=>s.kind==='crawl'));
  assert.ok(plan.find(s=>s.source==='facebook'&&s.kind==='crawl').args.includes('--cards-only'));
  assert.ok(plan.filter(s=>s.name.endsWith('/details')).every(s=>s.args.at(-1)==='20'));
  const recovery=plan.filter(s=>s.name.includes('/recovery-'));
  assert.equal(recovery.length,6);assert.ok(recovery.every(s=>Number(s.args.at(-1))<=20&&s.timeoutMs<=300000));
  assert.equal(plan.filter(s=>s.kind==='crawl').length,9);assert.equal(plan.filter(s=>s.kind==='probe').length,3);
`));
test('a challenged source backs off across cycles while its durable uploads and other sources continue',()=>isolated(`
  import {sourceCooldown,recordSourceAttempt} from '@/src/agent/backoff.ts';import {collect} from '@/src/agent/collection.ts';
  recordSourceAttempt('facebook',false,'marketplace challenge');assert.ok(sourceCooldown('facebook'));
  const ran=[];await collect(['facebook','offerup'],{cursor:0,paused:()=>false,cooldown:s=>sourceCooldown(s)?.retryAt??null,stage:async()=>{},run:async s=>{ran.push(s.name);return {ok:true,tail:'',timedOut:false,cancelled:false};}});
  assert.ok(ran.includes('facebook/recover-sync'));assert.ok(!ran.includes('facebook/search-nvidia-geforce'));assert.ok(ran.includes('offerup/search-graphics-card'));
  recordSourceAttempt('facebook',true);assert.equal(sourceCooldown('facebook'),null);
`));
