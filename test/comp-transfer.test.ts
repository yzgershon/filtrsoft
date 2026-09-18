import {test} from 'bun:test';import {isolated} from './isolated.ts';
test('comp transfer remaps catalog identity, rejects variants and duplicate ownership, and retries acknowledgements',()=>isolated(`
  import {db,now} from '@/src/db/index.ts';import {receiveComps} from '@/src/api/comp-sync.ts';import {contentHash} from '@/src/sync/outbox.ts';import {flushComps,ensureCompOutbox} from '@/src/sync/comps.ts';
  const d=db(),sku={category:'gpu',brand:'NVIDIA',model:'RTX 4070 Ti'};
  d.run('INSERT INTO skus(id,category,brand,model,attributes,created_at) VALUES(77,?,?,?,?,?)',[sku.category,sku.brand,sku.model,'{}',now()]);
  const make=(title='NVIDIA RTX 4070 Ti 12GB Graphics Card',id='123456789012')=>{const raw={title,sourceItemId:id,soldPriceCents:50000,shippingCents:0,soldAt:'2026-09-01T00:00:00.000Z'};const item={sku,comp:{source:'ebay',source_item_id:id,url:'https://www.ebay.com/itm/'+id,raw_title:title,sold_price_cents:50000,shipping_cents:0,currency:'USD',condition_raw:'Used',condition_norm:'used',sold_at:raw.soldAt,captured_at:now(),raw_json:JSON.stringify(raw)}};return {hash:contentHash(item),...item};};
  const good=make();assert.equal(receiveComps({items:[good]})[0].status,'applied');assert.equal(d.query('SELECT sku_id FROM comps').get().sku_id,77);
  assert.equal(receiveComps({items:[good]})[0].status,'duplicate');
  assert.equal(receiveComps({items:[make('NVIDIA RTX 4070 Ti SUPER 16GB Graphics Card','123456789013')]})[0].status,'rejected');
  const forged=make();forged.comp.sold_price_cents=100;const {hash,...payload}=forged;forged.hash=contentHash(payload);assert.equal(receiveComps({items:[forged]})[0].status,'rejected');
  ensureCompOutbox(d);const target='https://fixture.invalid';d.run('INSERT INTO comp_outbox(target,hash,payload) VALUES(?,?,?)',[target,good.hash,JSON.stringify(good)]);
  globalThis.fetch=async()=>{throw new Error('network failed');};await assert.rejects(flushComps(d,target,'Bearer fixture'));assert.equal(d.query('SELECT status FROM comp_outbox').get().status,'pending');
  globalThis.fetch=async()=>new Response(JSON.stringify({acks:[{hash:good.hash,status:'duplicate'}]}));assert.equal(await flushComps(d,target,'Bearer fixture'),1);assert.equal(d.query('SELECT status FROM comp_outbox').get().status,'duplicate');
  d.run("UPDATE comp_outbox SET status='pending'");d.exec('CREATE TABLE catalog_outbox(target TEXT,hash TEXT,payload TEXT,state TEXT)');d.run('INSERT INTO catalog_outbox VALUES(?,?,?,?)',[target,'catalog',JSON.stringify({identity:sku}),'pending']);
  let requests=0;globalThis.fetch=async()=>{requests++;return new Response(JSON.stringify({acks:[{hash:good.hash,status:'rejected',reason:'fixture rejection'}]}));};
  assert.equal(await flushComps(d,target,'Bearer fixture'),0);assert.equal(requests,0);assert.equal(d.query('SELECT status FROM comp_outbox').get().status,'pending');
  d.run("UPDATE catalog_outbox SET state='applied'");assert.equal(await flushComps(d,target,'Bearer fixture'),0);assert.equal(requests,1);assert.equal(d.query('SELECT status FROM comp_outbox').get().status,'rejected');
`));
