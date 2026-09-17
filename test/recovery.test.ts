import {test,expect} from 'bun:test';
import {isolated} from './isolated.ts';
import {recoveryPlan,recoveryFingerprint} from '../src/agent/recovery.ts';
import {craigslistDescription,detailCompleteness} from '../src/sources/detail-evidence.ts';
import {parseMercariDetail,parseOfferUpDetail} from '../src/sources/marketplace.ts';
import {factualText,textFacts} from '../src/signals/factual-text.ts';
import {extractAttributes} from '../src/catalog/match.ts';
import {detectCategory} from '../src/signals/index.ts';
import {collectionPlan} from '../src/agent/collection.ts';

test('long prose without decisive specs enters BOTH local and production recovery; complete unchanged pages advance',()=>isolated(`
 import {db} from '@/src/db/index.ts';import {upsertListingFacts} from '@/src/db/listings.ts';
 import {dueDetails,recordDetailAttempt} from '@/src/db/enrichment.ts';import {repairTargets} from '@/src/agent/targets.ts';
 const d=db(),at=Date.now(),id=upsertListingFacts(d,{source:'mercari',sourceId:'m87685110404',url:'https://www.mercari.com/us/item/m87685110404/',title:'Gaming desktop PC',description:'Well cared for gaming computer, selling because I upgraded and no longer need it.',askingPriceCents:50000,location:null,postedAt:null,photoCount:0}).id;
 d.run("INSERT INTO verdicts(listing_id,engine_version,call,payload,created_at) VALUES(?,'fixture','INSUFFICIENT_DATA','{}',?)",[id,new Date(at).toISOString()]);
 assert.ok(dueDetails('mercari').some(r=>r.id===id));assert.ok(repairTargets(['mercari']).some(r=>r.sourceId==='m87685110404'));
 recordDetailAttempt(id,'read',at,{complete:true,durationMs:8000});
 assert.equal(dueDetails('mercari',20,at+86400000).length,0);assert.equal(repairTargets(['mercari']).length,0);
 d.run("UPDATE listings SET description=description||' GPU added: RTX 4070 Ti' WHERE id=?",[id]);
 assert.equal(dueDetails('mercari',20,at+1000).length,1);
 recordDetailAttempt(id,'failed',at+2000);recordDetailAttempt(id,'failed',at+3000);
 assert.equal(d.query('SELECT failures FROM listing_enrichment WHERE listing_id=?').get(id).failures,2);
 assert.equal(dueDetails('mercari',20,at+4000).length,0);
`));
test('all missing build fields route to photos after a complete read, while exact comp work remains distinct',()=>{
 const row:any={title:'Gaming desktop PC',description:'CPU i7-12700K, GPU RTX 4070 Ti. Well cared for.',call:'INSUFFICIENT_DATA',photos:'[]'};
 row.recovery={fingerprint:recoveryFingerprint(row),complete:true,observedAt:new Date().toISOString(),unchanged:1};
 const result=recoveryPlan(row);
 expect(result.textDue).toBe(false);expect(result.blockers.some(b=>b.field==='ram'&&b.job==='photos')).toBe(true);
 expect(result.blockers.some(b=>b.field.includes('whole build')&&b.job==='comps')).toBe(true);
 expect(result.blockers.some(b=>b.field==='exact identity')).toBe(false);
});
test('full descriptions preserve tiers and disclosures beyond old worker limits; truncation and absent boundaries stay incomplete',()=>{
 const description='2 sticks $40\n\n4 sticks $70\n'+('Seller paragraph.\n'.repeat(350))+'Screen is cracked';
 for(const parse of [parseMercariDetail,parseOfferUpDetail])expect(parse('Description\n'+description+'\nDelivery\nOther item RTX 5090').description).toContain('Screen is cracked');
 expect(parseOfferUpDetail('Description\n2 sticks $40\n\n4 sticks $70\nDetails\nCondition\nUsed').description).toBe('2 sticks $40\n\n4 sticks $70');
 expect(craigslistDescription('<section id="postingbody">2 sticks $40<br><br>4 sticks $70<p>Not working</p></section>')).toBe('2 sticks $40\n\n4 sticks $70\nNot working');
 expect(()=>craigslistDescription('<title>Challenge</title>')).toThrow('incomplete');
 expect(detailCompleteness(description,{complete:true,truncated:true,rawCharacters:90000}).complete).toBe(false);
 expect(detailCompleteness(description).complete).toBe(false);
});
test('current seller facts exclude trade wishes, compatibility, removed and historical chips; conflicts remain explicit',()=>{
 expect(extractAttributes('Gaming PC. Upgraded from RTX 2080 to RTX 4070 Ti. Looking to trade for RTX 5090.')).toMatchObject({gpu:'rtx 4070 ti'});
 expect(extractAttributes('No RTX 4090 included. Compatible with Ryzen 9 9950X.')).not.toHaveProperty('gpu');
 expect(extractAttributes('No RTX 4090 included. Compatible with Ryzen 9 9950X.')).not.toHaveProperty('cpu');
 expect(textFacts('GPU RTX 4070 Ti\nInstalled GPU RTX 3080').conflicts).toEqual(['gpu']);
 expect(textFacts('RTX 3080\nRTX 3080 Ti').conflicts).toEqual([]);
 expect(extractAttributes('Samsung PC4-2133P 2x16GB laptop memory ECC registered')).toMatchObject({ram_gb:32,quantity:2,kit_layout:'2x16',ecc:'ecc',memory_type:'registered'});
 expect(detectCategory('Samsung PC4-2133P 2x16GB Laptop memory')).toBe('ram');
});
test('recovery capacity is configurable, bounded and source-interleaved after fresh availability',()=>{
 const plan=collectionPlan(['facebook','mercari'],0,3,6,{facebook:{attempts:20,timeMs:180000},mercari:{attempts:0,timeMs:180000}});
 const recovery=plan.filter(p=>p.name.includes('/recovery-'));
 expect(recovery).toHaveLength(2);expect(recovery.every(p=>p.source==='facebook'&&p.timeoutMs===90000)).toBe(true);
 expect(plan.indexOf(recovery[0])).toBeGreaterThan(plan.findIndex(p=>p.name==='mercari/probe'));
 const odd=collectionPlan(['facebook'],0,3,6,{facebook:{attempts:1,timeMs:30000}}).filter(p=>p.name.includes('/recovery-'));
 expect(odd.reduce((n,p)=>n+Number(p.args.at(-1)),0)).toBe(1);
});

test('audited unresolved listings cannot borrow a GPU suffix or a different laptop brand',()=>isolated(`
 import {db} from '@/src/db/index.ts';import {matchSku} from '@/src/catalog/match.ts';import {detectCategory} from '@/src/signals/index.ts';
 const d=db(),at=new Date().toISOString();
 d.run("INSERT INTO skus(id,category,brand,model,created_at) VALUES(1,'gpu','NVIDIA','GTX 1650 Super',?),(2,'laptop','Dell','Inspiron 14 7000',?),(3,'laptop','Lenovo','ThinkPad X1 Carbon',?)",[at,at,at]);
 assert.notEqual(matchSku('Dell NVIDIA GeForce GTX 1650 4GB GDDR5 Graphics Card – 03NR1F','','gpu').skuId,1);
 const title='BRAND NEW Lenovo ThinkBook 14/15 G6 ABP with the Ryzen 5 7000 series processor';
 assert.equal(detectCategory(title),'laptop');assert.notEqual(matchSku(title,'',detectCategory(title)).brand,'Dell');
`));
