import {test,expect} from 'bun:test';import {isolated} from './isolated.ts';
import {sourceIdentity} from '../src/catalog/source-identity.ts';
import {compMatchesQuery} from '../src/sources/ebay.ts';
import {extractAttributes} from '../src/catalog/match.ts';

test('owner recovery accepts the HTTPS site behind TLS termination and rejects foreign origins',()=>isolated(`
 process.env.FILTRSOFT_OWNER_REF='owner-device-fixture';process.env.FILTRSOFT_SITE_URL='https://filtrsoft.com';
 import {app} from '@/src/api/index.ts';import {db,now} from '@/src/db/index.ts';const d=db();
 d.run("INSERT INTO users(id,email,created_at,last_seen_at) VALUES(1,'fixture@example.invalid',?,?)",[now(),now()]);d.run("INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES('fixture-session',1,?,'2099-01-01')",[now()]);d.run('INSERT INTO account_devices(device_ref,user_id,created_at) VALUES(?,1,?)',[process.env.FILTRSOFT_OWNER_REF,now()]);
 const post=origin=>app.request('http://filtrsoft.com/v1/owner/recovery',{method:'POST',headers:{cookie:'filtrsoft_session=fixture-session',origin,'content-type':'application/x-www-form-urlencoded'},body:'ids=1'});
 assert.equal((await post('https://attacker.invalid')).status,403);assert.equal((await post('https://filtrsoft.com')).status,200);
`));

test('known laptop query preserves display constraint without a literal laptop word',()=>{
 const query='Lenovo Legion 5 15ACH6 Ryzen 7 5800H RTX 3050 Ti 16GB RAM 1TB SSD 15.6-inch';
 expect(extractAttributes(query,'laptop').screen_inches).toBe(15.6);
 expect(compMatchesQuery(query.replace('15.6-inch','17.3-inch'),query,'laptop').ok).toBe(false);
 expect(extractAttributes('GPU bracket 15.6-inch','gpu').screen_inches).toBeUndefined();
});

test('catalog synchronization re-derives identity, defers stale facts and acknowledges duplicates',()=>isolated(`
 import {db} from '@/src/db/index.ts';import {upsertListingFacts} from '@/src/db/listings.ts';import {identityFingerprint} from '@/src/catalog/recovery.ts';
 import {receiveCatalog} from '@/src/api/catalog-sync.ts';import {contentHash} from '@/src/sync/outbox.ts';import {catalogTransfer} from '@/src/sync/catalog.ts';
 const d=db(),id=upsertListingFacts(d,{source:'facebook',sourceId:'123',url:'https://www.facebook.com/marketplace/item/123/',title:'Lenovo Legion 5 Gaming Laptop',description:'Model 15ACH6. Ryzen 7 5800H, RTX 3050 Ti, 16GB RAM, 1TB SSD.',askingPriceCents:100000,location:null,postedAt:null,photoCount:0}).id;
 const item={source:'facebook',sourceId:'123',fingerprint:identityFingerprint(d.query('SELECT * FROM listings WHERE id=?').get(id)),identity:{brand:'Lenovo',model:'Legion 5 15ACH6',category:'laptop'}};
 const send=x=>{const canonical=catalogTransfer.parse(x);return receiveCatalog({items:[{...canonical,hash:contentHash(canonical)}]})[0];};
 assert.equal(send({...item,fingerprint:'0'.repeat(64)}).state,'deferred');assert.equal(d.query('SELECT COUNT(*) n FROM skus').get().n,0);
 assert.equal(send({...item,identity:{...item.identity,model:'Legion 5 15ACH6H'}}).state,'rejected');
 assert.equal(send(item).state,'applied');assert.equal(send(item).state,'duplicate');assert.equal(d.query('SELECT COUNT(*) n FROM skus').get().n,1);
 d.run("UPDATE listings SET description=description||' Conflicting model 15ACH6H' WHERE id=?",[id]);assert.equal(send(item).state,'deferred');
`));

test('cohort priority respects complete receipts, retry delay, unavailable and furniture exclusions',()=>isolated(`
 import {db,now} from '@/src/db/index.ts';import {upsertListingFacts} from '@/src/db/listings.ts';import {ensureEnrichment,dueDetails,recordDetailAttempt} from '@/src/db/enrichment.ts';
 const d=db(),ids=[];ensureEnrichment();
 for(let i=0;i<6;i++){const id=upsertListingFacts(d,{source:'facebook',sourceId:String(i+1),url:'https://www.facebook.com/marketplace/item/'+(i+1)+'/',title:i===5?'Office chair':'Lenovo laptop '+i,description:'Seller details',askingPriceCents:10000,location:null,postedAt:null,photoCount:0}).id;ids.push(id);if(i>0)d.run('INSERT INTO cohort_recovery_requests VALUES(?,?)',[id,now()]);}
 recordDetailAttempt(ids[2],'read',Date.now(),{complete:true});recordDetailAttempt(ids[3],'failed');d.run('UPDATE listings SET delisted_at=? WHERE id=?',[now(),ids[4]]);
 assert.deepEqual(dueDetails('facebook',40).map(r=>r.id),[ids[1],ids[0]]);
`));
test('manufacturer codes are quoted, suffixes conflict and configuration never guesses a Nitro chassis',()=>{
 const nitro=sourceIdentity('Acer Nitro 15 gaming laptop','Intel i7-13620H RTX 4060 Laptop 16GB RAM 512GB SSD','laptop');expect(nitro.identity).toBeNull();expect(nitro.reason).toContain('absent');
 expect(sourceIdentity('Acer Nitro laptop','Model ANV15-51-77SY. i7-13620H','laptop').identity?.model).toBe('Nitro ANV15-51-77SY');
 expect(sourceIdentity('Lenovo Legion 5 laptop','Model 15ACH6. Model 15ACH6H.','laptop').conflict).toBe(true);
 expect(sourceIdentity('Intel i5-10400F CPU + motherboard bundle','','component').identity).toBeNull();
 expect(sourceIdentity('HP 27-CB0244 All in One','Ryzen 7 5700U','prebuilt').identity?.model).toBe('27-CB0244');
});

test('new exact cohort identity queries outrank repeated generic demand without bypassing query backoff',()=>isolated(`
 import {db,now} from '@/src/db/index.ts';import {upsertListingFacts} from '@/src/db/listings.ts';import {enqueueIdentity,recoverIdentities} from '@/src/catalog/recovery.ts';import {ensureEnrichment} from '@/src/db/enrichment.ts';import {collectionPriority,startCollection,finishCollection} from '@/src/sources/comp-priority.ts';
 const d=db();ensureEnrichment();d.run("INSERT INTO skus(category,brand,model,created_at) VALUES('gpu','NVIDIA','RTX 4070 Ti',?)",[now()]);
 let legion=0;for(let i=0;i<5;i++){const exact=i===4,id=upsertListingFacts(d,{source:'facebook',sourceId:String(i+1),url:'https://www.facebook.com/marketplace/item/'+(i+1)+'/',title:exact?'Lenovo Legion 5 Gaming Laptop':'NVIDIA RTX 4070 Ti graphics card',description:exact?'Model 15ACH6. Ryzen 7 5800H RTX 3050 Ti 16GB RAM 1TB SSD':'Used',askingPriceCents:100000,location:null,postedAt:null,photoCount:0}).id;d.run('INSERT INTO cohort_recovery_requests VALUES(?,?)',[id,now()]);d.run("INSERT INTO verdicts(listing_id,engine_version,call,payload,created_at) VALUES(?,'fixture','INSUFFICIENT_DATA','{}',?)",[id,now()]);if(exact){legion=id;enqueueIdentity(d.query('SELECT * FROM listings WHERE id=?').get(id));}}
 const result=recoverIdentities(1,{ids:[legion],enqueue:false})[0];assert.equal(collectionPriority(10)[0].demandQuery,result.query);assert.equal(collectionPriority(10,Date.now(),true).length,1);
 const attempt=startCollection(result.skuId,result.query);finishCollection(attempt,{fetched:0,parsed:0,accepted:0,saved:0});assert.equal(collectionPriority(10,Date.now(),true).length,0);
`));
test('a broad Legion alias cannot swallow a precise seller model before identity resolution',()=>isolated(`
 import {db,now} from '@/src/db/index.ts';import {matchSku} from '@/src/catalog/match.ts';
 db().run("INSERT INTO skus(category,brand,model,created_at) VALUES('laptop','Lenovo','Legion 5',?)",[now()]);
 const m=matchSku('Lenovo Legion 5 Gaming Laptop','Model 15ACH6. Ryzen 7 5800H, RTX 3050 Ti, 16GB RAM, 1TB SSD.','laptop');
 assert.equal(m.skuId,null);assert.equal(m.model,'Legion 5 15ACH6');
`));
test('durable identity ownership expires, facts invalidate old work, and unsupported Nitro identity backs off',()=>isolated(`
 import {db} from '@/src/db/index.ts';import {upsertListingFacts} from '@/src/db/listings.ts';import {enqueueIdentity,claimIdentity,resolveIdentityJob} from '@/src/catalog/recovery.ts';
 const d=db(),id=upsertListingFacts(d,{source:'facebook',sourceId:'1',url:'https://www.facebook.com/marketplace/item/1/',title:'Acer Nitro 15 Gaming Laptop',description:'i7-13620H RTX 4060 16GB RAM 512GB SSD',askingPriceCents:70000,location:null,postedAt:null,photoCount:0}).id;
 const row=()=>d.query('SELECT * FROM listings WHERE id=?').get(id),at=Date.now();enqueueIdentity(row(),at);const first=claimIdentity('first',at);assert.ok(first);assert.equal(claimIdentity('second',at),null);
 const retry=claimIdentity('second',at+61000);assert.ok(retry);assert.equal(resolveIdentityJob(first,at+61001),null);
 const result=resolveIdentityJob(retry,at+61001);assert.equal(result.state,'missing-model');assert.equal(d.query('SELECT COUNT(*) n FROM skus').get().n,0);assert.equal(claimIdentity('third',at+62000),null);
 d.run("UPDATE listings SET description=description||' Model ANV15-51-77SY' WHERE id=?",[id]);enqueueIdentity(row(),at+63000);const changed=claimIdentity('third',at+63000);assert.ok(changed);assert.equal(resolveIdentityJob(changed,at+63000).state,'resolved');
`));
test('identity-required becomes a resolved catalog, exact sold query, acknowledged sales and supported verdict',()=>isolated(`
 import {db,now} from '@/src/db/index.ts';import {upsertListingFacts} from '@/src/db/listings.ts';import {checkStored} from '@/src/engine/index.ts';
 import {recordDetailAttempt} from '@/src/db/enrichment.ts';import {recoverIdentities,enqueueIdentity} from '@/src/catalog/recovery.ts';import {collectionPriority,startCollection,finishCollection} from '@/src/sources/comp-priority.ts';
 import {parseSoldRow,compMatchesQuery,saveComps} from '@/src/sources/ebay.ts';import {captureNewComps} from '@/src/sync/comps.ts';import {receiveComps} from '@/src/api/comp-sync.ts';
 const d=db(),id=upsertListingFacts(d,{source:'facebook',sourceId:'123',url:'https://www.facebook.com/marketplace/item/123/',title:'Lenovo Legion 5 Gaming Laptop',description:'Model 15ACH6. AMD Ryzen 7 5800H, NVIDIA RTX 3050 Ti 4GB, 16GB RAM, 1TB SSD, 15.6-inch screen. Fully working with charger.',askingPriceCents:150000,location:null,postedAt:null,photoCount:0}).id;
 recordDetailAttempt(id,'read',Date.now(),{complete:true});assert.equal(checkStored(id).verdict.call,'INSUFFICIENT_DATA');enqueueIdentity(d.query('SELECT * FROM listings WHERE id=?').get(id));
 const result=recoverIdentities(1,{ids:[id],enqueue:false})[0];assert.equal(result.state,'resolved');assert.ok(result.created);assert.ok(result.query.includes('15ACH6'));assert.ok(result.query.includes('1TB SSD'));
 const priceable=collectionPriority(20).find(r=>r.demandQuery===result.query); // stored verdict is established below for scheduling
 const v=checkStored(id).verdict;d.run('INSERT INTO verdicts(listing_id,engine_version,call,payload,created_at) VALUES(?,?,?,?,?)',[id,'before','INSUFFICIENT_DATA',JSON.stringify(v),now()]);
 d.run('INSERT INTO cohort_recovery_requests VALUES(?,?)',[id,now()]);
 assert.ok(collectionPriority(20,Date.now(),true).some(r=>r.demandQuery===result.query));
 const at=Date.now(),date=new Date(at-86400000).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'}),attempt=startCollection(result.skuId,result.query);
 const raw=Array.from({length:5},(_,i)=>({href:'https://www.ebay.com/itm/'+(100000000000+i),title:result.query,text:['Sold '+date,'$500.00','Pre-Owned'],img:null}));
 const parsed=raw.map(r=>parseSoldRow(r,at)).filter(Boolean);assert.equal(parsed.length,5);assert.ok(parsed.every(c=>compMatchesQuery(c.title,result.query,'laptop').ok));
 assert.equal(compMatchesQuery(result.query.replace('3050 ti','3050'),result.query,'laptop').ok,false);
 const saved=saveComps(parsed,result.query,result.skuId);finishCollection(attempt,{fetched:5,parsed:5,accepted:5,saved});assert.equal(saved,5);
 captureNewComps(d,'https://fixture.invalid',0);const transfers=d.query('SELECT hash,payload FROM comp_outbox').all();const ack=receiveComps({items:transfers.map(r=>({hash:r.hash,...JSON.parse(r.payload)}))});assert.equal(ack.length,5);assert.ok(ack.every(r=>['applied','duplicate'].includes(r.status)));
 import {valueSku} from '@/src/valuation/index.ts';import {extractAttributes} from '@/src/catalog/match.ts';
 const after=checkStored(id).verdict;const value=valueSku(result.skuId,{category:'laptop',attributes:after.provenance.match.attributes});assert.equal(after.call,'PASS',JSON.stringify({headline:after.headline,unknown:after.decidingUnknown,match:after.provenance.match,value,query:result.query,queryAttributes:extractAttributes(result.query),baseMatch:compMatchesQuery(result.query,'Lenovo Legion 5 15ACH6','laptop'),comps:d.query('SELECT sold_at,condition_norm FROM comps').all()}));assert.equal(value.compCount,5);
`));

