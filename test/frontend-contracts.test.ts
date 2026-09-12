import {test} from 'bun:test';
import {isolated} from './isolated.ts';

const fixture=`
  import {db} from '@/src/db/index.ts';
  import {app} from '@/src/api/index.ts';
  import {ensureAlertTables,runAlerts} from '@/src/api/alerts.ts';
  import {upsertListingFacts} from '@/src/db/listings.ts';
  import {storeVerdict} from '@/src/db/verdicts.ts';
  const d=db(),at=new Date().toISOString(); ensureAlertTables();
  globalThis.fetch=async()=>{throw new Error('network forbidden');};
  for(const id of [1,2]){
    d.run('INSERT INTO users(id,email,created_at,last_seen_at) VALUES(?,?,?,?)',[id,'audit'+id+'@example.invalid',at,at]);
    d.run('INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)',['fixture-'+id,id,at,'2099-01-01T00:00:00.000Z']);
  }
  const request=(owner,path,method='GET',body=undefined)=>app.request(path,{method,headers:{cookie:'filtrsoft_session=fixture-'+owner,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let serial=0;
  const listing=(call='BUY',title='Nvidia RTX 4090',source='craigslist',price=40000)=>{
    const id=upsertListingFacts(d,{source,sourceId:String(++serial),url:'https://example.invalid/'+serial,title,description:'',askingPriceCents:price,location:null,postedAt:null,photoCount:0}).id;
    storeVerdict(id,'fixture',{call,netProfitCents:20000,channels:[{channel:'facebook',available:true,netCents:60000}]});return id;
  };
  const subscribe=async()=>{const r=await request(1,'/v1/push/subscribe','POST',{endpoint:'https://push.example.invalid/a',keys:{p256dh:'fixture',auth:'fixture'}});return (await r.json()).subId;};
`;

test('account searches save without push and reopen the exact feed criteria',()=>isolated(fixture+`
  const wanted=listing();listing('BUY','Nvidia RTX 4090','facebook');listing('VERIFY');listing('BUY','Nvidia RTX 4090 laptop');listing('BUY','Nvidia RTX 4090','craigslist',80000);
  const r=await request(1,'/v1/searches','POST',{label:'My cards',query:'RTX 4090',category:'gpu',source:'craigslist',quality:'ready',sort:'price',maxPriceCents:50000});
  assert.equal(r.status,200);const s=await r.json();assert.equal(s.notifications,false);assert.equal(s.sub_id,null);
  assert.equal(s.needsReview,false);assert.equal(s.openUrl,'/?quality=ready&q=RTX+4090&category=gpu&source=craigslist&maxPrice=50000&sort=price');
  const feed=await (await request(1,'/v1/feed'+s.openUrl.slice(1))).json();assert.deepEqual(feed.items.map(i=>i.id),[wanted]);
  assert.equal((await (await request(2,'/v1/searches')).json()).items.length,0);
  assert.equal((await request(2,'/v1/searches/'+s.id,'PATCH',{label:'stolen'})).status,404);
  assert.equal((await request(2,'/v1/searches/'+s.id,'DELETE')).status,404);
  assert.equal((await request(1,'/v1/searches','POST',{quality:'all',maxPriceCents:0})).status,400);
  assert.equal((await request(1,'/v1/searches/'+s.id,'DELETE')).status,200);
  assert.equal((await request(1,'/v1/searches/'+s.id,'DELETE')).status,404);
  const next=await (await request(1,'/v1/searches','POST',{quality:'all'})).json();assert.ok(next.id>s.id);
`));

test('matching preserves source, quality, category, price and explicit call constraints',()=>isolated(`
  import {matchesCriteria} from '@/src/api/search-criteria.ts';
  const s={query:'RTX 4090',category:'gpu',source:'craigslist',quality:'review',max_price_cents:50000,min_profit_cents:0,calls:'BUY,VERIFY'};
  const row={title:'Nvidia RTX 4090',price:40000,net:10000,call:'BUY',source:'craigslist',reviewed:false};
  assert.equal(matchesCriteria(s,row),true);
  for(const change of [{source:'facebook'},{reviewed:true},{price:null},{price:50001},{net:null},{call:'FAIR'},{title:'RTX 4090 laptop'}])assert.equal(matchesCriteria(s,{...row,...change}),false,JSON.stringify(change));
`));

test('notification watermarks skip backlog, move only for changed matching rules, and disable cleanly',()=>isolated(fixture+`
  const subId=await subscribe();
  const s=await (await request(1,'/v1/searches','POST',{quality:'ready',query:'RTX',subId})).json();
  d.run("UPDATE saved_searches SET notify_since='2000-01-01T00:00:00.000Z' WHERE id=?",[s.id]);
  let changed=await (await request(1,'/v1/searches/'+s.id,'PATCH',{category:'gpu'})).json();assert.ok(changed.notify_since>'2000');
  let same=await (await request(1,'/v1/searches/'+s.id,'PATCH',{category:'gpu'})).json();assert.equal(same.notify_since,changed.notify_since);
  same=await (await request(1,'/v1/searches/'+s.id,'PATCH',{label:'Renamed',sort:'price'})).json();assert.equal(same.notify_since,changed.notify_since);
  const off=await (await request(1,'/v1/searches/'+s.id,'PATCH',{subId:null})).json();assert.equal(off.notifications,false);assert.equal(off.sub_id,null);
  const legacy=await (await request(1,'/v1/searches','POST',{query:'RTX',calls:['BUY'],subId})).json();assert.equal(legacy.needsReview,true);assert.equal(legacy.notifications,false);assert.equal(legacy.openUrl,null);
  assert.equal((await request(1,'/v1/searches/'+legacy.id,'PATCH',{subId})).status,400);
  const reviewed=await (await request(1,'/v1/searches/'+legacy.id,'PATCH',{quality:'verify',category:'gpu'})).json();assert.equal(reviewed.calls,null);assert.equal(reviewed.query,null);assert.equal(reviewed.needsReview,false);
  assert.equal(reviewed.notifications,false);assert.equal(reviewed.notify_since,null);
`));

test('a delayed partial search body cannot undo a newer notification or criteria edit',()=>isolated(fixture+`
  const subId=await subscribe();const s=await (await request(1,'/v1/searches','POST',{quality:'ready',subId})).json();
  let release;const body=new ReadableStream({start(c){release=()=>{c.enqueue(new TextEncoder().encode(JSON.stringify({label:'Slow rename'})));c.close();};}});
  const slow=app.request(new Request('http://localhost/v1/searches/'+s.id,{method:'PATCH',headers:{cookie:'filtrsoft_session=fixture-1','content-type':'application/json'},body,duplex:'half'}));
  await new Promise(r=>setTimeout(r,5));
  assert.equal((await request(1,'/v1/searches/'+s.id,'PATCH',{category:'gpu',subId:null})).status,200);
  release();assert.equal((await slow).status,200);
  const current=d.query('SELECT * FROM saved_searches WHERE id=?').get(s.id);assert.equal(current.category,'gpu');assert.equal(current.sub_id,null);assert.equal(current.notify_since,null);
`));

test('legacy search migration preserves IDs, pauses incomplete criteria and never recycles delivery history',()=>isolated(`
  import {Database} from 'bun:sqlite';
  import {installSavedSearches} from '@/src/api/search-criteria.ts';
  const d=new Database(':memory:');d.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1); CREATE TABLE push_subs(id INTEGER PRIMARY KEY,user_id INTEGER); INSERT INTO push_subs VALUES(3,1); CREATE TABLE saved_searches(id INTEGER PRIMARY KEY,sub_id INTEGER NOT NULL REFERENCES push_subs(id),label TEXT,query TEXT,max_price_cents INTEGER,min_profit_cents INTEGER,calls TEXT,created_at TEXT,standing INTEGER); INSERT INTO saved_searches VALUES(7,3,'Old category name','RTX',50000,NULL,'BUY','2026-01-01',0); CREATE TABLE alert_sent(search_id INTEGER,listing_id INTEGER); INSERT INTO alert_sent VALUES(90,100); CREATE TABLE alert_deliveries(search_id INTEGER,listing_id INTEGER); INSERT INTO alert_deliveries VALUES(99,101);");
  installSavedSearches(d);installSavedSearches(d);
  const old=d.query('SELECT * FROM saved_searches WHERE id=7').get();assert.equal(old.user_id,1);assert.equal(old.query,'RTX');assert.equal(old.category,null);assert.equal(old.criteria_version,1);assert.equal(old.notify_since,null);
  assert.equal(d.query('SELECT search_id FROM alert_sent').get().search_id,90);assert.equal(d.query('SELECT search_id FROM alert_deliveries').get().search_id,99);
  d.run("INSERT INTO saved_searches(user_id,label,created_at) VALUES(1,'New','2026-01-02')");assert.ok(d.query("SELECT id FROM saved_searches WHERE label='New'").get().id>99);
  d.run('DELETE FROM push_subs WHERE id=3');assert.equal(d.query('SELECT sub_id FROM saved_searches WHERE id=7').get().sub_id,null);
`));

test('dead endpoints preserve account queries and in-flight edits stop subsequent deliveries',()=>isolated(fixture+`
  import webpush from '@/node_modules/web-push/src/index.js';
  const subId=await subscribe();d.run('DELETE FROM saved_searches WHERE standing=1');
  const s=await (await request(1,'/v1/searches','POST',{quality:'ready',query:'RTX',subId})).json();
  d.run("UPDATE saved_searches SET notify_since='2000-01-01T00:00:00.000Z' WHERE standing=0");listing();listing();
  d.run("UPDATE saved_searches SET created_at='2099-01-01T00:00:00.000Z' WHERE standing=1");
  let attempts=0;webpush.sendNotification=async()=>{attempts++;await request(1,'/v1/searches/'+s.id,'PATCH',{subId:null});return {};};
  assert.equal(await runAlerts(),1);assert.equal(attempts,1);
  await request(1,'/v1/searches/'+s.id,'PATCH',{subId});d.run("UPDATE saved_searches SET notify_since='2000-01-01T00:00:00.000Z'");
  webpush.sendNotification=async()=>{throw Object.assign(new Error('gone'),{statusCode:410});};
  assert.equal(await runAlerts(),0);const saved=d.query('SELECT * FROM saved_searches WHERE id=?').get(s.id);assert.ok(saved);assert.equal(saved.sub_id,null);assert.equal(saved.user_id,1);
`));

test('purchase reports separate recorded money, frozen decisions, current estimates and complete sale profit',()=>isolated(fixture+`
  const a=listing(),b=listing(),c=listing(),e=listing();
  d.run('DELETE FROM verdicts WHERE listing_id=?',[b]);
  const insert=(id,paid,sold,fees,shipping,kind,frozen)=>d.run("INSERT INTO outcomes(listing_id,user_id,action,purchase_price_cents,sold_price_cents,fees_cents,shipping_cents,evidence_kind,decision_json,created_at) VALUES(?,1,'bought',?,?,?,?,?,?,?)",[id,paid,sold,fees,shipping,kind,frozen,at]);
  insert(a,null,null,null,null,'personal_report',JSON.stringify({call:'FAIR',valuation:{medianCents:45000}}));
  insert(b,10000,null,null,null,'personal_report',null);
  insert(c,0,70000,0,0,'personal_transaction',JSON.stringify({call:'VERIFY'}));
  d.run("UPDATE outcomes SET other_costs_cents=0 WHERE listing_id=?",[c]);
  insert(e,20000,40000,null,0,'personal_transaction','{broken');
  d.run("UPDATE verdicts SET payload='{broken' WHERE listing_id=?",[e]);
  const r=await request(1,'/v1/purchases');assert.equal(r.status,200);const {items,summary}=await r.json();
  const first=items.find(i=>i.listingId===a);assert.equal(first.paidCents,null);assert.equal(first.marginCents,null);assert.equal(first.engineCall,'FAIR');assert.equal(first.currentEngineCall,'BUY');assert.equal(first.decisionWorthCents,45000);assert.equal(first.worthCents,60000);
  assert.equal(summary.spentCents,30000);assert.equal(summary.worthCents,120000);assert.equal(summary.marginCents,60000);assert.equal(summary.estimatedDifferenceCount,1);assert.equal(summary.paidMissingCount,1);
  assert.equal(summary.realizedProfitCents,70000);assert.equal(summary.completeSaleCount,1);assert.equal(summary.incompleteSaleCount,1);
  assert.equal(items.find(i=>i.listingId===e).engineCall,null);assert.equal(items.find(i=>i.listingId===e).worthCents,null);
  assert.equal((await (await request(2,'/v1/purchases')).json()).items.length,0);
`));

test('outcome retries acknowledge one committed record and reject conflicting reuse',()=>isolated(fixture+`
  const id=listing(),requestId=crypto.randomUUID(),path='/v1/checks/'+id+'/outcome';
  const body={action:'bought',requestId};
  assert.equal((await request(1,path,'POST',body)).status,200);
  const frozen=d.query('SELECT decision_json FROM outcomes WHERE request_id=?').get(requestId).decision_json;
  storeVerdict(id,'changed',{call:'PASS'});
  assert.equal((await (await request(1,path,'POST',body)).json()).totalOutcomes,1);
  assert.equal(d.query('SELECT decision_json FROM outcomes WHERE request_id=?').get(requestId).decision_json,frozen);
  assert.equal((await request(1,path,'POST',{...body,action:'passed'})).status,409);
  assert.equal((await request(2,path,'POST',body)).status,200);
  assert.equal((await (await request(1,'/v1/purchases')).json()).items.length,1);
`));


test('Personal listing removal is idempotent, account-owned and reversible across feeds and cursors',()=>isolated(fixture+`
  const first=listing(),second=listing();
  const before=await (await request(1,'/v1/feed?quality=all&limit=1')).json();
  assert.equal(before.items.length,1);const id=before.items[0].id;
  assert.equal((await app.request('/v1/checks/'+id+'/dismiss',{method:'PUT'})).status,401);
  assert.equal((await request(1,'/v1/checks/'+id+'/dismiss','PUT')).status,200);
  assert.equal((await request(1,'/v1/checks/'+id+'/dismiss','PUT')).status,200);
  assert.equal(d.query('SELECT COUNT(*) n FROM listing_dismissals').get().n,1);
  const mine=await (await request(1,'/v1/feed?quality=all')).json();assert(!mine.items.some(i=>i.id===id));
  const theirs=await (await request(2,'/v1/feed?quality=all')).json();assert(theirs.items.some(i=>i.id===id));
  const watch=await (await request(1,'/v1/watchlist?ids='+id)).json();assert.equal(watch.items.length,0);
  const hidden=await (await request(1,'/v1/dismissals')).json();assert.equal(hidden.items[0].id,id);
  assert.equal((await (await request(2,'/v1/dismissals')).json()).items.length,0);
  await request(2,'/v1/checks/'+id+'/dismiss','DELETE');assert.equal(d.query('SELECT COUNT(*) n FROM listing_dismissals').get().n,1);
  assert.equal(d.query('SELECT delisted_at FROM listings WHERE id=?').get(id).delisted_at,null);
  if(before.nextCursor){const page=await (await request(1,'/v1/feed?quality=all&limit=1&cursor='+encodeURIComponent(before.nextCursor))).json();assert(!page.items.some(i=>i.id===id));}
  await request(1,'/v1/checks/'+id+'/dismiss','DELETE');
  assert((await (await request(1,'/v1/feed?quality=all')).json()).items.some(i=>i.id===id));
`));

test('Detail specs use the displayed frozen evidence and feed photos retain ordered bounded fallbacks',()=>isolated(fixture+`
  import {checkStored,ENGINE_VERSION} from '@/src/engine/index.ts';
  import {syncPhotoUrls} from '@/src/vision/merge.ts';
  import {putThumb} from '@/src/photos/thumb.ts';
  const id=listing('BUY','RTX 4090 graphics card');
  d.run('UPDATE listings SET description=? WHERE id=?',['GPU: ASUS RTX 4090 24GB GDDR6X',id]);
  const urls=[0,1,2,3].map(i=>'https://example.invalid/photo-'+i);syncPhotoUrls(id,urls);
  const report=checkStored(id).verdict;storeVerdict(id,ENGINE_VERSION,report);
  d.run('UPDATE listings SET description=? WHERE id=?',['GPU: RTX 4060',id]);
  const detail=await (await request(1,'/v1/checks/'+id)).json();
  assert(detail.meta.specifications.fields.find(f=>f.key==='gpu').values.some(v=>v.value.includes('ASUS RTX 4090')));
  assert(!JSON.stringify(detail.meta.specifications).includes('RTX 4060'));
  const before=await (await request(1,'/v1/watchlist?ids='+id)).json();assert.deepEqual(before.items[0].thumbFallbacks,urls.slice(0,3));assert.equal(before.items[0].thumb,urls[0]);
  putThumb(id,urls[0],{bytes:new Uint8Array([1]),mime:'image/webp',width:1,height:1});
  const cached=await (await request(1,'/v1/watchlist?ids='+id)).json();assert.equal(cached.items[0].thumb,'/v1/thumb/'+id);assert.deepEqual(cached.items[0].thumbFallbacks,urls.slice(0,3));
`));
