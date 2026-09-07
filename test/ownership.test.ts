import {test} from "bun:test";
import {isolated} from "./isolated.ts";

const fixture=`
  import {db} from '@/src/db/index.ts';
  import {app} from '@/src/api/index.ts';
  import {ensureAlertTables} from '@/src/api/alerts.ts';
  import {upsertListingFacts} from '@/src/db/listings.ts';
  import {loadAccountOverrides} from '@/src/api/overrides.ts';
  const d=db(),at=new Date().toISOString();globalThis.fetch=async()=>{throw new Error('network forbidden');};
  ensureAlertTables();
  for(const id of [1,2]){
    d.run('INSERT INTO users(id,email,created_at,last_seen_at) VALUES(?,?,?,?)',[id,'audit'+id+'@example.invalid',at,at]);
    d.run('INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)',['fixture-'+id,id,at,'2099-01-01T00:00:00.000Z']);
    d.run('INSERT INTO account_devices(device_ref,user_id,created_at) VALUES(?,?,?)',['fixture_ref_'+id,id,at]);
  }
  const listingId=upsertListingFacts(d,{source:'audit',sourceId:'a',url:'https://example.invalid/a',title:'Unknown tech',description:'',askingPriceCents:60000,location:null,postedAt:null,photoCount:0}).id;
  const request=(owner,path,method='GET',body=undefined)=>app.request(path,{method,headers:{cookie:'filtrsoft_session=fixture-'+owner,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
`;

test("subscription routes deny another account including test-send and ID/endpoint takeover",()=>isolated(fixture+`
  const registered=await request(1,'/v1/push/subscribe','POST',{endpoint:'https://push.example.invalid/one',keys:{p256dh:'fixture-public',auth:'fixture-auth'}});
  assert.equal(registered.status,200);const {subId}=await registered.json();
  const created=await request(1,'/v1/searches','POST',{subId,query:'RTX',label:'Cards'});assert.equal(created.status,200);const {id}=await created.json();
  for(const [path,method,body] of [
    ['/v1/searches?subId='+subId,'GET',undefined],
    ['/v1/searches','POST',{subId,query:'stolen'}],
    ['/v1/searches/'+id+'?subId='+subId,'DELETE',undefined],
    ['/v1/searches/standing?subId='+subId,'PATCH',{verify:false}],
    ['/v1/push/test?subId='+subId,'POST',{}],
    ['/v1/push/subscribe','POST',{endpoint:'https://push.example.invalid/one',keys:{p256dh:'fixture-public',auth:'fixture-auth'}}],
  ])assert.equal((await request(2,path,method,body)).status,403,path);
  assert.equal((await request(1,'/v1/searches?subId='+subId)).status,200);
  assert.equal((await request(1,'/v1/searches/standing?subId='+subId,'PATCH',{verify:false})).status,200);
  assert.equal((await request(1,'/v1/searches/'+id+'?subId='+subId,'DELETE')).status,200);
`));

test("legacy subscription adoption requires browser-held endpoint keys, not just an ID",()=>isolated(fixture+`
  d.run('INSERT INTO push_subs(endpoint,p256dh,auth,created_at) VALUES(?,?,?,?)',['https://push.example.invalid/legacy','legacy-public','legacy-auth',at]);
  ensureAlertTables();const id=d.query("SELECT id FROM push_subs WHERE endpoint='https://push.example.invalid/legacy'").get().id;
  assert.equal((await request(1,'/v1/searches?subId='+id)).status,403);
  assert.equal((await request(1,'/v1/push/subscribe','POST',{endpoint:'https://push.example.invalid/legacy',keys:{p256dh:'wrong',auth:'wrong'}})).status,403);
  assert.equal((await request(1,'/v1/push/subscribe','POST',{endpoint:'https://push.example.invalid/legacy',keys:{p256dh:'legacy-public',auth:'legacy-auth'}})).status,200);
  assert.equal((await request(1,'/v1/searches?subId='+id)).status,200);
  assert.equal((await request(2,'/v1/searches?subId='+id)).status,403);
`));

test("overrides require owned refs and account reads never expose another person's labels",()=>isolated(fixture+`
  const path='/v1/checks/'+listingId+'/override';
  assert.equal((await request(1,path,'POST',{ref:'fixture_ref_1',call:'RISK'})).status,200);
  assert.equal((await request(2,path,'POST',{ref:'fixture_ref_1',call:'BUY'})).status,403);
  assert.equal((await request(2,path+'?ref=fixture_ref_1','DELETE')).status,403);
  assert.equal((await request(2,'/v1/feed?ref=fixture_ref_1')).status,403);
  assert.equal(loadAccountOverrides(1).get(listingId).call,'RISK');assert.equal(loadAccountOverrides(2).size,0);
  assert.equal((await request(1,path+'?ref=fixture_ref_1','DELETE')).status,200);
  assert.equal(loadAccountOverrides(1).size,0);
`));

test("purchases and outcome counts are account scoped; unassigned legacy rows stay private",()=>isolated(fixture+`
  d.run("INSERT INTO outcomes(listing_id,action,purchase_price_cents,created_at) VALUES(?,'bought',10000,?)",[listingId,at]);
  const posted=await request(1,'/v1/checks/'+listingId+'/outcome','POST',{action:'bought',pricePaidCents:20000});
  assert.equal(posted.status,200);assert.equal((await posted.json()).totalOutcomes,1);
  const own=await request(1,'/v1/purchases');assert.equal(own.status,200);assert.equal((await own.json()).items.length,1);
  const other=await request(2,'/v1/purchases');assert.equal(other.status,200);assert.equal((await other.json()).items.length,0);
`));
