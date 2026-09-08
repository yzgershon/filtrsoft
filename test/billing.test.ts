import {test} from 'bun:test';
import {isolated} from './isolated.ts';

const fixture=`
  import {Hono} from '@/node_modules/hono/dist/index.js';
  import {db,now} from '@/src/db/index.ts';
  import {billingRoutes,ensureBillingTables,processBillingEvent,entitlementFor,handleBillingStatus} from '@/src/api/billing.ts';
  process.env.STRIPE_SECRET_KEY='fixture-not-a-secret';process.env.STRIPE_PRICE_ID='price_fixture';process.env.STRIPE_WEBHOOK_SECRET='fixture-webhook';
  globalThis.fetch=async()=>{throw new Error('network forbidden');};
  const d=db();ensureBillingTables();
  for(const id of [1,2]){
    d.run('INSERT INTO users(id,email,created_at,last_seen_at) VALUES(?,?,?,?)',[id,'billing'+id+'@example.invalid',now(),now()]);
    d.run('INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)',['fixture-'+id,id,now(),'2099-01-01T00:00:00.000Z']);
    d.run('INSERT INTO account_devices(device_ref,user_id,created_at) VALUES(?,?,?)',['fixture_ref_'+id,id,now()]);
  }
  const bind=(id)=>d.run('INSERT INTO billing_accounts VALUES(?,?,?,?,?)',[id,'cus_'+id,'create_'+id,'checkout_'+id,now()]);
  const active=(id=1)=>({id:'sub_'+id,customerId:'cus_'+id,status:'active',periodEnd:Math.floor(Date.now()/1000)+86400,priceIds:['price_fixture']});
  const event=(id,type='customer.subscription.updated',customer='cus_1')=>({id,type,data:{object:{id:'sub_1',customer,client_reference_id:'fixture_ref_2'}}});
  const request=(app,id,path,body={})=>app.request(path,{method:'POST',headers:{cookie:'filtrsoft_session=fixture-'+id,'content-type':'application/json'},body:JSON.stringify(body)});
`;

test('billing retries durable failures, deduplicates events and reconciles current state regardless of event order',()=>isolated(fixture+`
  bind(1);let reads=0;
  await assert.rejects(processBillingEvent(event('evt_a'),async()=>{throw new Error('provider down');}));
  assert.equal(d.query('SELECT status FROM billing_events').get().status,'retry');assert.equal(entitlementFor(1).active,false);
  await processBillingEvent(event('evt_a'),async()=>{reads++;return [active()];});
  assert.equal(entitlementFor(1).active,true);
  assert.deepEqual(await processBillingEvent(event('evt_a'),async()=>{throw new Error('duplicate read');}),{duplicate:true});
  // An old deletion arriving late cannot revoke a currently active renewal.
  await processBillingEvent(event('evt_old','customer.subscription.deleted'),async()=>[active()]);
  assert.equal(entitlementFor(1).active,true);
  await processBillingEvent(event('evt_cancel'),async()=>[{...active(),status:'canceled'}]);
  assert.equal(entitlementFor(1).active,false);assert.equal(entitlementFor(1).until,null);
  await assert.rejects(processBillingEvent(event('evt_unknown','checkout.session.completed','cus_unknown'),async()=>[active()]));
  assert.equal(d.query('SELECT COUNT(*) n FROM billing_accounts').get().n,1);
  await assert.rejects(processBillingEvent(event('evt_wrong'),async()=>[active(2)]));
  assert.equal(entitlementFor(2).active,false);
  assert.equal(d.query("SELECT attempts FROM billing_events WHERE event_id='evt_a'").get().attempts,2);
`));

test('billing customer leases fence old completions and reject concurrent reconciliations',()=>isolated(fixture+`
  bind(1);let release,started;const ready=new Promise(r=>started=r);
  const work=processBillingEvent(event('evt_first'),async()=>{started();return await new Promise(r=>release=r);});await ready;
  await assert.rejects(processBillingEvent(event('evt_second'),async()=>[active()]));
  d.run("UPDATE billing_locks SET token='successor'");release([active()]);await assert.rejects(work);
  assert.equal(entitlementFor(1).active,false);assert.equal(d.query('SELECT token FROM billing_locks').get().token,'successor');
  d.run('DELETE FROM billing_locks');await processBillingEvent(event('evt_second'),async()=>[active()]);assert.equal(entitlementFor(1).active,true);
`));

test('checkout and portal use session-owned customers and stable retry keys',()=>isolated(fixture+`
  const calls=[];let rows=[];
  const client={customers:{create:async(params,options)=>{calls.push(['customer',params,options]);return {id:'cus_1'};}},checkout:{sessions:{create:async(params,options)=>{calls.push(['checkout',params,options]);return {url:'https://example.invalid/checkout'};}}},billingPortal:{sessions:{create:async(params)=>{calls.push(['portal',params]);return {url:'https://example.invalid/portal'};}}}};
  const routes=billingRoutes(()=>client,async()=>rows),app=new Hono();app.post('/checkout',routes.checkout);app.post('/portal',routes.portal);app.get('/status',handleBillingStatus);
  assert.equal((await request(app,2,'/checkout',{ref:'fixture_ref_1'})).status,403);
  assert.equal((await request(app,1,'/checkout',{customer:'cus_2'})).status,400);
  assert.equal((await request(app,1,'/checkout')).status,200);assert.equal((await request(app,1,'/checkout')).status,200);
  const checkouts=calls.filter(c=>c[0]==='checkout');assert.equal(checkouts.length,2);assert.deepEqual(checkouts[0][2],checkouts[1][2]);assert.equal(checkouts[0][1].customer,'cus_1');
  assert.equal(calls.filter(c=>c[0]==='customer').length,1);
  assert.equal((await request(app,2,'/portal')).status,404);assert.equal((await request(app,2,'/portal',{ref:'fixture_ref_1'})).status,403);
  assert.equal((await request(app,1,'/portal')).status,200);assert.equal(calls.at(-1)[1].customer,'cus_1');
  rows=[active()];assert.equal((await request(app,1,'/checkout')).status,409);
  process.env.FILTRSOFT_OWNER_REF='fixture_ref_1';
  const status=await app.request('/status?ref=fixture_ref_1',{headers:{cookie:'filtrsoft_session=fixture-2'}});assert.equal(status.status,403);
  assert.equal(entitlementFor(1).status,'owner');assert.equal(entitlementFor(2).active,false);
`));

test('signed webhook failures return retryable status and invalid signatures never mutate entitlements',()=>isolated(fixture+`
  bind(1);let fail=true;
  const routes=billingRoutes(()=>({webhooks:{constructEventAsync:async(raw,sig)=>{if(sig!=='fixture-valid')throw new Error('invalid signature');return event('evt_signed');}}}),async()=>{if(fail)throw new Error('provider unavailable');return [active()];});
  const app=new Hono();app.post('/webhook',routes.webhook);
  const post=(sig)=>app.request('/webhook',{method:'POST',headers:{'stripe-signature':sig},body:'synthetic event'});
  assert.equal((await post('bad')).status,400);assert.equal(d.query('SELECT COUNT(*) n FROM billing_events').get().n,0);
  assert.equal((await post('fixture-valid')).status,503);assert.equal(entitlementFor(1).active,false);
  fail=false;assert.equal((await post('fixture-valid')).status,200);assert.equal(entitlementFor(1).active,true);
  assert.equal((await post('fixture-valid')).status,200);
`));

