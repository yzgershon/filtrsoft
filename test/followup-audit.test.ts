import {test,expect} from 'bun:test';
import {conditionDisclosure} from '../src/signals/condition.ts';
import {textFacts} from '../src/signals/factual-text.ts';
import {extractAttributes} from '../src/catalog/match.ts';
import {isolated} from './isolated.ts';
import {findContradictions} from '../src/reference/compatibility.ts';
test('denied compatibility and omitted sale parts are not damage or installed specifications',()=>{
 const board='GIGABYTE B860 motherboard. Like new. No bent, broken or missing pin as photo #2, #3 shown. Only works with DDR5 RAM, and does not work with DDR4 RAM.';
 expect(conditionDisclosure(board).broken).toBeNull();expect(findContradictions(board).some(c=>c.code==='CONDITION_CONTRADICTION')).toBe(false);
 expect(findContradictions('Intel i5-10400F. This sale is ONLY for 1x CPU and there is no DDR5 DDR4 RAM, GPU, motherboard, PSU for this sale.').some(c=>c.code==='IMPOSSIBLE_SPEC_CLAIM')).toBe(false);
 expect(conditionDisclosure('Does not work with the supplied power adapter.').broken).not.toBeNull();
 expect(findContradictions('Intel i5-10400F with 16GB DDR5 RAM').some(c=>c.code==='IMPOSSIBLE_SPEC_CLAIM')).toBe(true);
});
test('professional GPU capacity stays exact across card wording and mixed sold variants',()=>isolated(`
 import {db,now} from '@/src/db/index.ts';import {extractAttributes} from '@/src/catalog/match.ts';import {valueSku} from '@/src/valuation/index.ts';
 const d=db(),at=now();d.run("INSERT INTO skus(id,category,brand,model,created_at) VALUES(1,'gpu','NVIDIA','RTX A2000',?)",[at]);
 for(const [i,title] of ['NVIDIA RTX A2000 Graphics Card 6gb','NVIDIA RTX A2000 6GB','NVIDIA RTX A2000 12GB','NVIDIA RTX A2000 6GB'].entries())d.run("INSERT INTO comps(source,source_item_id,raw_title,sold_price_cents,condition_norm,sold_at,captured_at,sku_id,raw_json) VALUES('ebay',?,?,25000,'used',?,?,1,json_object('soldAt',?))",[String(i),title,at,at,at]);
 const attributes=extractAttributes('NVIDIA RTX A2000 Graphics Card 6gb','gpu');assert.equal(attributes.vram_gb,6);assert.equal(valueSku(1,{category:'gpu',attributes}).compCount,3);
`));
test('a CPU plus RAM sale cannot be valued from CPU-only sales',()=>isolated(`
 import {db,now} from '@/src/db/index.ts';import {runPipeline} from '@/src/engine/index.ts';
 const d=db(),at=now();d.run("INSERT INTO skus(id,category,brand,model,created_at) VALUES(1,'component','Intel','i5-12400F',?)",[at]);
 for(let i=0;i<5;i++)d.run("INSERT INTO comps(source,source_item_id,raw_title,sold_price_cents,condition_norm,sold_at,captured_at,sku_id,raw_json) VALUES('ebay',?,'Intel i5-12400F CPU processor',10000,'used',?,?,1,json_object('soldAt',?))",[String(i),at,at,at]);
 const listing={source:'facebook',sourceId:'123',url:'https://www.facebook.com/marketplace/item/123/',title:'16 GB DDR4 AND I5 12400F Processor',description:'Selling my RAM and processor from a build. DDR4 RAM (2x8) @ 2666 MHz. Intel i5 12400f desktop processor. Selling for $200.',askingPriceCents:20000,location:null,postedAt:null,photoUrls:[],attributes:{},raw:{}};
 const result=runPipeline(listing,null).verdict;assert.equal(result.call,'INSUFFICIENT_DATA');assert.equal(result.valuation.medianCents,null);assert.match(result.decidingUnknown,/bundle/);
 const single=runPipeline({...listing,title:'Intel i5-12400F processor',description:'CPU only. No RAM included.'},null).verdict;assert.equal(single.call,'PASS');
`));
test('coordinated negated pin damage is not a defect; later asserted damage still is',()=>{
 expect(conditionDisclosure('No bent, broken or missing pin as photo #2, #3 shown.').broken).toBeNull();
 expect(conditionDisclosure('No broken pins. Fully tested.').broken).toBeNull();
 expect(conditionDisclosure('No bent pins, but broken socket.').broken).not.toBeNull();
 expect(conditionDisclosure('Broken pins.').broken).not.toBeNull();
});
test('a compact manufacturer GPU suffix conflicts with the unsuffixed chip name',()=>{
 expect(textFacts('Asus GeForce GTX 1650 4GB GDDR6 TUF-GTX1650S-O4G-GAMING').conflicts).toContain('gpu');
 expect(textFacts('GTX 1650 TUF-GTX1650-O4G-GAMING').conflicts).not.toContain('gpu');
});
test('GPU price retains stated board maker and memory generation even with sparse exact sales',()=>isolated(`
 import {db} from '@/src/db/index.ts';import {extractAttributes,matchSku} from '@/src/catalog/match.ts';import {valueSku} from '@/src/valuation/index.ts';
 const d=db(),at=new Date(Date.now()-86400000).toISOString();
 d.run("INSERT INTO skus(id,category,brand,model,created_at) VALUES (1,'gpu','NVIDIA','GTX 1650',?)",[at]);
 for(const [i,title] of ['ASUS GTX 1650 4GB GDDR6','ASUS GTX 1650 4GB GDDR5','MSI GTX 1650 4GB GDDR6','GTX 1650 4GB GDDR6','ASUS GTX 1650 4GB','ASUS GTX 1650 4GB GDDR6'].entries())d.run("INSERT INTO comps(source,source_item_id,raw_title,sold_price_cents,condition_norm,sold_at,captured_at,sku_id,raw_json) VALUES ('ebay',?,?,10000,'used',?,?,1,json_object('soldAt',?))",[String(i),title,at,at,at]);
 const attrs=extractAttributes('ASUS GTX 1650 4GB GDDR6 graphics card','gpu');
 assert.equal(attrs.board_brand,'asus');assert.equal(attrs.vram_type,'gddr6');
 assert.equal(matchSku('ASUS GTX 1650 4GB GDDR6 graphics card','','gpu').attributes.board_brand,'asus');
 assert.equal(valueSku(1,{category:'gpu',condition:'used',attributes:attrs}).compCount,2);
`));
test('availability observation acquires the write transaction before reading across competing writers',()=>isolated(`
 import {db,DB_PATH} from '@/src/db/index.ts';import {Database} from 'bun:sqlite';import {recordProbe} from '@/src/db/probes.ts';
 const d=db(),at=new Date().toISOString();d.run("INSERT INTO listings(id,source,source_id,url,title,captured_at) VALUES(1,'facebook','test','https://example.invalid','GPU',?)",[at]);
 const other=new Database(DB_PATH);other.exec('PRAGMA busy_timeout=1');const query=d.query.bind(d);let competed=false;
 d.query=(sql)=>{const statement=query(sql);if(!sql.includes('SELECT l.probe_failures'))return statement;return {get(...args){const row=statement.get(...args);try{other.run("UPDATE listings SET title='GPU observed' WHERE id=1");}catch(e){assert.match(String(e),/locked|BUSY/i);}competed=true;return row;}};};
 recordProbe(1,'alive');assert.equal(competed,true);assert.equal(query('SELECT outcome FROM listing_availability WHERE listing_id=1').get().outcome,'alive');other.close();
`));
test('quoted Yoga and LOQ manufacturer identities cannot collapse to a different generation or GPU',()=>isolated(`
 import {db,now} from '@/src/db/index.ts';import {sourceIdentity} from '@/src/catalog/source-identity.ts';import {detectCategory} from '@/src/signals/index.ts';import {matchSku} from '@/src/catalog/match.ts';
 const yoga='Lenovo Laptop- Yoga 7 2-in-1 14AHP9 - Type 83DK',loq='LENOVO LOQ 15ARP9 RYZEN 5 16GB / 512GB RTX4050';
 db().run("INSERT INTO skus(category,brand,model,created_at) VALUES('laptop','Lenovo','Yoga 2',?),('gpu','NVIDIA','RTX 4050',?)",[now(),now()]);
 assert.equal(detectCategory(loq),'laptop');assert.equal(sourceIdentity(yoga,'','laptop').identity.model,'Yoga 7 2-in-1 14AHP9');
 assert.equal(sourceIdentity(loq,'','laptop').identity.model,'LOQ 15ARP9');assert.equal(matchSku(yoga,'','laptop').skuId,null);
`));
test('catalog transfer retains obsolete history but stops retrying only after current facts were acknowledged',()=>isolated(`
 import {db,now} from '@/src/db/index.ts';import {upsertListingFacts} from '@/src/db/listings.ts';import {enqueueIdentity,recoverIdentities} from '@/src/catalog/recovery.ts';import {captureCatalog} from '@/src/sync/catalog.ts';
 const d=db(),target='https://fixture.invalid',id=upsertListingFacts(d,{source:'facebook',sourceId:'123',url:'https://www.facebook.com/marketplace/item/123/',title:'Lenovo Legion 5 laptop',description:'Model 15ACH6',askingPriceCents:70000,location:null,postedAt:null,photoCount:0}).id;
 const resolve=()=>{enqueueIdentity(d.query('SELECT * FROM listings WHERE id=?').get(id));recoverIdentities(1,{ids:[id],enqueue:false});captureCatalog(target);};resolve();const old=d.query('SELECT hash FROM catalog_outbox').get().hash;
 d.run("UPDATE listings SET description='Model 15ACH6. Charger included.' WHERE id=?",[id]);resolve();assert.equal(d.query("SELECT COUNT(*) n FROM catalog_outbox WHERE state='pending'").get().n,2);
 d.run("UPDATE catalog_outbox SET state='applied' WHERE hash!=?",[old]);captureCatalog(target);
 assert.equal(d.query('SELECT state FROM catalog_outbox WHERE hash=?').get(old).state,'superseded');assert.equal(d.query('SELECT COUNT(*) n FROM catalog_outbox').get().n,2);
`));
test('a resolver revision requeues old terminal work once and keeps current retry backoff',()=>isolated(`
 import {db} from '@/src/db/index.ts';import {upsertListingFacts} from '@/src/db/listings.ts';import {enqueueIdentity,recoverIdentities} from '@/src/catalog/recovery.ts';
 const d=db(),id=upsertListingFacts(d,{source:'facebook',sourceId:'1',url:'https://www.facebook.com/marketplace/item/1/',title:'Acer Nitro laptop',description:'i7-13620H RTX4060',askingPriceCents:70000,location:null,postedAt:null,photoCount:0}).id;
 const row=d.query('SELECT * FROM listings WHERE id=?').get(id);enqueueIdentity(row);recoverIdentities(1,{ids:[id],enqueue:false});
 const retry=d.query('SELECT next_at FROM identity_jobs').get().next_at;enqueueIdentity(row);assert.equal(d.query('SELECT state FROM identity_jobs').get().state,'missing-model');assert.equal(d.query('SELECT next_at FROM identity_jobs').get().next_at,retry);
 d.run('UPDATE identity_jobs SET resolver_version=1');enqueueIdentity(row);assert.equal(d.query('SELECT state FROM identity_jobs').get().state,'queued');assert.equal(d.query('SELECT resolver_version FROM identity_jobs').get().resolver_version,2);
`));
