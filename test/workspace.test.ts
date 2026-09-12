import {test} from 'bun:test';
import {isolated} from './isolated.ts';

const fixture=`
  import {db} from '@/src/db/index.ts';
  import {app} from '@/src/api/index.ts';
  import {upsertListingFacts} from '@/src/db/listings.ts';
  const d=db(),at=new Date().toISOString();globalThis.fetch=async()=>{throw Error('network forbidden');};
  for(const id of [1,2]){
    d.run('INSERT INTO users(id,email,created_at,last_seen_at) VALUES(?,?,?,?)',[id,'workspace'+id+'@example.invalid',at,at]);
    d.run('INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)',['fixture-'+id,id,at,'2099-01-01T00:00:00.000Z']);
  }
  const listingId=upsertListingFacts(d,{source:'craigslist',sourceId:'one',url:'https://boston.craigslist.org/sys/d/example/123.html',title:'RTX 3070',description:'One card. Test at pickup.',askingPriceCents:25050,location:'Newton',postedAt:null,photoCount:0}).id;
  const frozen=JSON.stringify({call:'VERIFY',riskChecks:[{code:'LOCK',label:'Ownership',state:'unresolved',question:'Confirm ownership.',evidence:'Seller claim only.'}],valuation:{medianCents:30000},channels:[]});
  d.run('INSERT INTO verdicts(listing_id,engine_version,call,payload,created_at) VALUES(?,?,?,?,?)',[listingId,'fixture','VERIFY',frozen,at]);
  const request=(owner,path,method='GET',body=undefined)=>app.request(path,{method,headers:{...(owner?{cookie:'filtrsoft_session=fixture-'+owner}:{}),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const inspectionPath='/v1/checks/'+listingId+'/inspection';
  const payload=v=>({revision:v.revision,basis:v.basis,notes:v.notes,answers:v.checks.map(({id,state,note})=>({id,state,note}))});
`;

test('private registration closes password and new social accounts while preserving existing provider access',()=>isolated(fixture+`
  import {upsertIdentity,RegistrationClosed} from '@/src/api/auth.ts';
  delete process.env.FILTRSOFT_REGISTRATION;
  assert.equal((await request(null,'/v1/auth/signup','POST',{email:'new@example.invalid',password:'a long test password'})).status,403);
  assert.equal((await (await request(null,'/v1/auth/me')).json()).providers.registrationOpen,false);
  const claims={provider:'google',subject:'new-google',email:'new@example.invalid',emailVerified:true,name:null,picture:null};
  assert.throws(()=>upsertIdentity(claims),RegistrationClosed);
  assert.equal(upsertIdentity({...claims,email:'workspace1@example.invalid'}).id,1);
  assert.equal(upsertIdentity({...claims,email:null}).id,1);
  assert.throws(()=>upsertIdentity({...claims,subject:'unverified',email:'workspace1@example.invalid',emailVerified:false}),RegistrationClosed);
  assert.equal(d.query('SELECT COUNT(*) n FROM users').get().n,2);
  process.env.FILTRSOFT_REGISTRATION='open';
  assert.equal((await request(null,'/v1/auth/signup','POST',{email:{bad:true},password:'valid long password'})).status,400);
  assert.equal((await request(null,'/v1/auth/signin','POST',{email:[],password:'password'})).status,401);
`));

test('inspection requires authentication, owns notes and does not change engine evidence',()=>isolated(fixture+`
  assert.equal((await request(null,inspectionPath)).status,401);
  const a=await (await request(1,inspectionPath)).json();assert.equal(a.checks.length,4);assert.equal(a.revision,0);
  const body=payload(a);body.notes='Meet by the library';body.answers[0].state='passed';body.answers[0].note='Checked in person';
  const saved=await request(1,inspectionPath,'PUT',body);assert.equal(saved.status,200);assert.equal((await saved.json()).revision,1);
  assert.equal((await (await request(2,inspectionPath)).json()).notes,'');
  assert.equal(d.query('SELECT payload FROM verdicts').get().payload,frozen);
  assert.equal(d.query('SELECT COUNT(*) n FROM inspection_revisions').get().n,1);
  assert.equal((await request(1,inspectionPath,'PUT',body)).status,409);
  assert.equal((await request(1,'/v1/checks/99999/inspection')).status,404);
`));

test('changed listing evidence resets answers and rejects a save from the old question set',()=>isolated(fixture+`
  const initial=await (await request(1,inspectionPath)).json();const b=payload(initial);b.answers[0].state='passed';
  await request(1,inspectionPath,'PUT',b);
  const previous=await (await request(1,inspectionPath)).json();
  d.run('UPDATE listings SET description=? WHERE id=?',['Now selling a different card',listingId]);
  const fresh=await (await request(1,inspectionPath)).json();
  assert.notEqual(fresh.basis,previous.basis);assert.equal(fresh.checks[0].state,'pending');assert.equal(fresh.staleAnswerCount,1);
  assert.equal((await request(1,inspectionPath,'PUT',payload(previous))).status,409);
  const forged=payload(fresh);forged.answers[0].id='invented';assert.equal((await request(1,inspectionPath,'PUT',forged)).status,400);
  const dup=payload(fresh);dup.answers[1]=dup.answers[0];assert.equal((await request(1,inspectionPath,'PUT',dup)).status,400);
  const huge=payload(fresh);huge.notes='x'.repeat(4001);assert.equal((await request(1,inspectionPath,'PUT',huge)).status,400);
  const current=payload(fresh);current.answers[0].state='passed';await request(1,inspectionPath,'PUT',current);
  d.run('INSERT INTO listing_photos(listing_id,position,url,captured_at) VALUES(?,?,?,?)',[listingId,0,'https://example.invalid/changed-photo.jpg',at]);
  const changedPhoto=await (await request(1,inspectionPath)).json();assert.notEqual(changedPhoto.basis,fresh.basis);assert.equal(changedPhoto.checks[0].state,'pending');
`));

test('asking-price history pages actual observations and never invents a sale or baseline',()=>isolated(fixture+`
  const path='/v1/checks/'+listingId+'/price-history';
  assert.equal((await request(null,path)).status,401);
  for(let i=0;i<60;i++)d.run('INSERT INTO listing_prices(listing_id,price_cents,observed_at) VALUES(?,?,?)',[listingId,25000+i,new Date(Date.now()+1000*(i+1)).toISOString()]);
  d.run('INSERT INTO listing_prices(listing_id,price_cents,observed_at) VALUES(?,?,?)',[listingId,40000,'2001-01-01 00:00:00']);
  d.run('UPDATE listings SET delisted_at=? WHERE id=?',[at,listingId]);
  const count=d.query('SELECT COUNT(*) n FROM listing_prices').get().n;
  const first=await (await request(1,path)).json();assert.equal(first.items.length,50);assert.ok(first.unavailableAt);assert.equal(first.items[0].priceCents,25059);
  const next=await (await request(1,path+'?before='+first.nextBefore)).json();assert.equal(next.items.length,12);assert.equal(next.nextBefore,null);
  assert.equal(next.items.at(-1).priceCents,40000);
  assert.equal((await request(1,path+'?before=999999')).status,400);
  assert.equal(new Set([...first.items,...next.items].map(i=>i.id)).size,count);
  assert.equal((await request(1,path+'?before=-1')).status,400);
  d.run('DELETE FROM listing_prices');assert.deepEqual((await (await request(1,path)).json()).items,[]);
  assert.equal(d.query('SELECT COUNT(*) n FROM outcomes').get().n,0);
`));

test('listing facts and price history roll back together when a history write fails',()=>isolated(fixture+`
  const before=d.query('SELECT * FROM listings WHERE id=?').get(listingId);
  d.exec("CREATE TRIGGER reject_price BEFORE INSERT ON listing_prices BEGIN SELECT RAISE(ABORT,'fixture history failure'); END;");
  assert.throws(()=>upsertListingFacts(d,{source:'craigslist',sourceId:'one',url:before.url,title:'Changed title',description:'Changed description',askingPriceCents:10000,location:null,postedAt:null,photoCount:0}));
  const after=d.query('SELECT * FROM listings WHERE id=?').get(listingId);
  assert.equal(after.title,before.title);assert.equal(after.asking_price_cents,before.asking_price_cents);assert.equal(after.description,before.description);
  assert.throws(()=>upsertListingFacts(d,{source:'audit',sourceId:'invalid'},'not-a-date'));
`));

const bought=`
  await request(1,'/v1/checks/'+listingId+'/outcome','POST',{action:'bought',pricePaidCents:25050});
  const purchase=d.query('SELECT * FROM outcomes').get(),path='/v1/purchases/'+purchase.id;
  const sale={revision:0,paidCents:25050,soldPriceCents:35075,feesCents:1500,shippingCents:1000,otherCostsCents:525,soldChannel:'ebay',soldAt:at.slice(0,10),notes:'Replaced fan'};
`;
test('purchase sale records exact known costs, retains frozen decisions and fences concurrent edits',()=>isolated(fixture+bought+`
  assert.equal((await request(null,path,'PUT',sale)).status,401);assert.equal((await request(2,path,'PUT',sale)).status,404);
  const result=await request(1,path,'PUT',sale);assert.equal(result.status,200);assert.equal((await result.json()).realizedProfitCents,7000);
  const saved=d.query('SELECT * FROM outcomes').get();assert.equal(saved.decision_json,purchase.decision_json);assert.equal(saved.created_at,purchase.created_at);
  assert.equal(saved.evidence_kind,'personal_transaction');assert.equal(saved.transaction_revision,1);
  assert.equal(d.query('SELECT COUNT(*) n FROM outcome_revisions').get().n,1);
  assert.equal((await request(1,path,'PUT',sale)).status,409);
  const report=await (await request(1,'/v1/purchases')).json();assert.equal(report.summary.realizedProfitCents,7000);assert.equal(report.items[0].otherCostsCents,525);
  assert.equal(report.summary.inventory.count,0);assert.equal(report.summary.inventory.paidCents,null);assert.equal(report.summary.inventory.worthCents,null);
  assert.equal((await (await request(2,'/v1/purchases')).json()).items.length,0);
`));

test('unknown costs never become profit; sale corrections are recoverable and bounded',()=>isolated(fixture+bought+`
  const bad=[{...sale,feesCents:1.1},{...sale,otherCostsCents:-1},{...sale,soldAt:'2099-01-01'},{...sale,soldAt:'2026-02-30'},{...sale,soldChannel:null},{...sale,notes:'x'.repeat(4001)}];
  for(const value of bad)assert.equal((await request(1,path,'PUT',value)).status,400);
  const unknown=await request(1,path,'PUT',{...sale,otherCostsCents:null});assert.equal(unknown.status,200);assert.equal((await unknown.json()).realizedProfitCents,null);
  const clear=await request(1,path,'PUT',{...sale,revision:1,soldPriceCents:null,soldAt:null,soldChannel:null});assert.equal(clear.status,200);
  assert.equal(d.query('SELECT evidence_kind FROM outcomes').get().evidence_kind,'personal_report');
  const revisions=d.query('SELECT * FROM outcome_revisions ORDER BY revision').all();assert.equal(revisions.length,2);
  assert.equal(JSON.parse(revisions[1].before_json).sold_price_cents,35075);
  assert.equal(JSON.parse(revisions[1].after_json).sold_price_cents,null);
`));

test('purchases with pending facts withhold the stale current estimate',()=>isolated(fixture+bought+`
  d.run('INSERT INTO listing_rechecks(listing_id,reason,requested_at) VALUES(?,?,?)',[listingId,'changed identity',at]);
  const report=await (await request(1,'/v1/purchases')).json();
  assert.equal(report.items[0].worthCents,null);assert.equal(report.items[0].currentEngineCall,null);
  assert.equal(report.items[0].decisionWorthCents,30000);
`));

test('ordinary stored reads do not exhaust source checks or sign-in attempts',()=>isolated(fixture+`
  for(let i=0;i<45;i++)assert.equal((await request(1,inspectionPath)).status,200);
  assert.equal((await request(null,'/v1/auth/signin','POST',{email:'none@example.invalid',password:'invalid'})).status,401);
  for(let i=0;i<20;i++)assert.equal((await request(1,'/v1/checks','POST',{url:'https://example.invalid'})).status,400);
  assert.equal((await request(1,'/v1/checks','POST',{url:'https://example.invalid'})).status,429);
  assert.equal((await request(1,inspectionPath)).status,200);
`));

test('public health and thumbnails do not expose private workspace diagnostics',()=>isolated(fixture+`
  const publicHealth=await (await request(null,'/v1/health')).json();
  assert.equal(publicHealth.db,'ok');assert.equal('push' in publicHealth,false);assert.equal('crawlButton' in publicHealth,false);assert.equal('vision' in publicHealth,false);
  const own=await (await request(1,'/v1/health')).json();assert.ok(own.crawlButton);assert.ok(own.push);assert.ok(own.vision);
  assert.equal((await request(null,'/v1/thumb/'+listingId)).status,401);
  assert.equal((await request(1,'/v1/thumb/'+listingId)).status,404);
`));
