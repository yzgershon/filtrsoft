import {test} from 'bun:test';
import {isolated} from './isolated.ts';
const fixture=`
 import {db} from '@/src/db/index.ts';
 import {app} from '@/src/api/index.ts';
 import {upsertListingFacts} from '@/src/db/listings.ts';
 import {storeVerdict} from '@/src/db/verdicts.ts';
 const d=db(),at=new Date().toISOString();
 globalThis.fetch=async()=>{throw new Error('Comparison must not access network');};
 for(const id of [1,2]){
  d.run('INSERT INTO users(id,email,created_at,last_seen_at) VALUES(?,?,?,?)',[id,'compare'+id+'@example.invalid',at,at]);
  d.run('INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)',['compare-'+id,id,at,'2099-01-01T00:00:00.000Z']);
 }
 const request=(user,path)=>app.request(path,{headers:{cookie:'filtrsoft_session=compare-'+user}});
 let serial=0;
 function listing(title='RTX 3070',category='gpu',description='GPU: RTX 3070'){
  const facts={source:'craigslist',sourceId:String(++serial),url:'https://boston.craigslist.org/gbs/sop/d/card/'+(7000000000+serial)+'.html',title,description,askingPriceCents:25000,location:'Newton',postedAt:at,photoCount:0};
  const id=upsertListingFacts(d,facts).id;
  storeVerdict(id,'fixture',{call:'VERIFY',provenance:{facts:{...facts,attributes:{}},signals:{category,signals:[]},visionEvidence:null},questions:['Can I test it?']});return id;
 }
`;
test('Comparison requires auth, validates inputs and separates each account removal',()=>isolated(fixture+`
 const a=listing(),b=listing('Ryzen 7 5800X','component','CPU: Ryzen 7 5800X');
 assert.equal((await app.request('/v1/compare?ids='+a)).status,401);
 assert.equal((await app.request('/v1/compare/candidates')).status,401);
 for(const query of ['ids=0','ids='+a+','+a,'ids=1,2,3','ids=9007199254740992','ids='+a+'&kind=unknown','ids='+a+'&workload=fps'])assert.equal((await request(1,'/v1/compare?'+query)).status,400,query);
 assert.equal((await request(1,'/v1/compare?ids=999999')).status,404);
 assert.equal((await request(1,'/v1/compare/candidates?before=no')).status,400);
 d.run('INSERT INTO listing_dismissals(user_id,listing_id,created_at) VALUES(?,?,?)',[1,a,at]);
 const one=await request(1,'/v1/compare?ids='+a),side=(await one.json()).sides[0];
 assert.equal(side.status,'removed');assert.match(one.headers.get('cache-control'),/no-store/);
 assert.equal((await (await request(2,'/v1/compare?ids='+a)).json()).sides[0].status,'active');
 assert.equal((await (await request(1,'/v1/compare/candidates')).json()).items.length,0);
 assert.deepEqual((await (await request(2,'/v1/compare/candidates')).json()).items.map(i=>i.id),[a]);
 assert.equal((await (await request(2,'/v1/compare?ids='+a+'&kind=cpu')).json()).sides[0].reference,null);
 const before=d.query('SELECT id,payload FROM verdicts ORDER BY id').all();
 await request(2,'/v1/compare?ids='+a+','+b);await request(2,'/v1/compare/candidates?q=RTX');
 assert.deepEqual(d.query('SELECT id,payload FROM verdicts ORDER BY id').all(),before);
`));
test('Candidate scan cursor advances past nonmatching rows without claiming end of results',()=>isolated(fixture+`
 const wanted=listing();
 for(let i=0;i<1005;i++)listing('Other component '+i,'component','Memory: 32GB');
 const first=await (await request(1,'/v1/compare/candidates?kind=gpu')).json();
 assert.equal(first.items.length,0);assert.ok(first.nextCursor);
 const next=await (await request(1,'/v1/compare/candidates?kind=gpu&before='+first.nextCursor)).json();
 assert.deepEqual(next.items.map(i=>i.id),[wanted]);assert.equal(next.nextCursor,null);
`));
test('Candidate pages exclude old, delisted, inventory and malformed evidence without network',()=>isolated(fixture+`
 const wanted=listing(),gone=listing(),old=listing(),broken=listing(),inventory=listing();
 d.run('UPDATE listings SET delisted_at=? WHERE id=?',[at,gone]);
 d.run("UPDATE listings SET posted_at='2001-01-01T00:00:00.000Z' WHERE id=?",[old]);
 d.run("UPDATE verdicts SET payload='{broken' WHERE listing_id=?",[broken]);
 const payload=JSON.parse(d.query('SELECT payload FROM verdicts WHERE listing_id=?').get(inventory).payload);payload.inventory={offers:[]};d.run('UPDATE verdicts SET payload=? WHERE listing_id=?',[JSON.stringify(payload),inventory]);
 const result=await (await request(1,'/v1/compare/candidates')).json();assert.deepEqual(result.items.map(i=>i.id),[wanted]);
 assert.equal((await (await request(1,'/v1/compare?ids='+old)).json()).sides[0].status,'stale');
 assert.equal((await (await request(1,'/v1/compare?ids='+gone)).json()).sides[0].status,'gone');
 assert.equal((await (await request(1,'/v1/compare?ids='+broken)).json()).sides[0].hardware.state,'unknown');
`));
test('New listing facts and pending assessments cannot inherit stale identity or valuation',()=>isolated(fixture+`
 const changed=listing('RTX 4090','gpu','GPU: RTX 4090'),queued=listing();
 d.run("UPDATE listings SET title='RTX 3070',description='GPU: RTX 3070',asking_price_cents=20000 WHERE id=?",[changed]);
 d.run("INSERT INTO listing_rechecks(listing_id,reason,requested_at) VALUES(?,'facts',?)",[queued,at]);
 for(const id of [changed,queued]){
  const side=(await (await request(1,'/v1/compare?ids='+id)).json()).sides[0];
  assert.equal(side.status,'updating');assert.equal(side.reference,null);assert.equal(side.manufacturer,null);assert.equal(side.worthCents,null);assert.equal(side.hardware.identity,null);
 }
 assert.equal((await (await request(1,'/v1/compare/candidates')).json()).items.length,0);
`));
test('Malformed JSON shapes cannot take down a comparison candidate page',()=>isolated(fixture+`
 const ids=[];
 for(const patch of [{questions:'ask me'},{riskChecks:{}},{provenance:{facts:{title:9},signals:{category:'gpu'}}},{provenance:{facts:{title:'RTX 3070',description:'GPU: RTX 3070',photoUrls:{},attributes:{cpu:7}},signals:{category:'gpu',signals:'hello'}}}]){
  const id=listing();ids.push(id);const payload=JSON.parse(d.query('SELECT payload FROM verdicts WHERE listing_id=?').get(id).payload);
  d.run('UPDATE verdicts SET payload=? WHERE listing_id=?',[JSON.stringify({...payload,...patch}),id]);
  assert.equal((await request(1,'/v1/compare?ids='+id)).status,200);
 }
 assert.equal((await request(1,'/v1/compare/candidates')).status,200);
`));
