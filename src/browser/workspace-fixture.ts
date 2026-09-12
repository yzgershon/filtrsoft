/** Disposable local API for end-to-end QA. Never opens the project's database. */
import {resolve,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
if(!process.env.FILTRSOFT_DB||!resolve(process.env.FILTRSOFT_DB).startsWith(resolve(tmpdir())+sep)||!dirname(process.env.FILTRSOFT_DB).includes('filtrsoft-workspace-'))throw new Error('A disposable workspace fixture database is required');
const {db}=await import('../db/index.ts');
const {app}=await import('../api/index.ts');
const {checkFetched}=await import('../engine/index.ts');
const {recordReportedOutcome}=await import('../tracker/outcomes.ts');
const {putThumb}=await import('../photos/thumb.ts');
const sharp=(await import('sharp')).default;
globalThis.fetch=Object.assign(async()=>{throw new Error('Fixture network forbidden');},{preconnect:()=>{}}) as typeof fetch;
const d=db(),at=new Date().toISOString(),yesterday=new Date(Date.now()-86400000).toISOString();
for(const id of [1,2]) {
  d.run('INSERT INTO users(id,email,name,created_at,last_seen_at) VALUES(?,?,?,?,?)',[id,`fixture${id}@example.invalid`,'Workspace preview',at,at]);
  d.run('INSERT INTO sessions VALUES(?,?,?,?,?)',[`workspace-fixture-${id}`,id,at,'2099-01-01T00:00:00.000Z',null]);
  d.run('INSERT INTO account_devices(device_ref,user_id,created_at) VALUES(?,?,?)',[`workspace-device-${id}`,id,at]);
}
d.run("INSERT INTO skus(category,brand,model,attributes,created_at) VALUES('gpu','NVIDIA','RTX 3070','{}',?)",[at]);
for(let i=0;i<5;i++)d.run("INSERT INTO comps(source,source_item_id,raw_title,sold_price_cents,captured_at,sold_at,sku_id,raw_json,condition_norm,url) VALUES('ebay',?,'NVIDIA RTX 3070 8GB',?,?,?,?,?,'used',?)",[String(i),30000+i*1000,at,yesterday,1,JSON.stringify({soldAt:yesterday}),`https://www.ebay.com/itm/${900000000000+i}`]);
const result=await checkFetched({source:'craigslist',sourceId:'workspace-demo',url:'https://boston.craigslist.org/gbs/sop/d/newton-graphics-card/9999999999.html',title:'NVIDIA RTX 3070 8GB',description:'One NVIDIA RTX 3070 8GB graphics card. Works well. You can test it at pickup in Newton. Includes original box.',askingPriceCents:25050,location:'Newton, MA',postedAt:yesterday,updatedAt:null,photoUrls:[],attributes:{},raw:{}},{persist:true,vision:false});
if(result.listingId==null)throw new Error('Fixture listing was not persisted');
// Generated pixels exercise authenticated thumbnail delivery without fetching
// or retaining a seller's photo in this disposable database.
putThumb(result.listingId,'fixture-generated',{bytes:await sharp({create:{width:32,height:32,channels:3,background:'#45645d'}}).webp().toBuffer(),mime:'image/webp',width:32,height:32});
d.run('INSERT INTO listing_prices(listing_id,price_cents,observed_at) VALUES(?,?,?)',[result.listingId,22550,new Date().toISOString()]);
d.run('UPDATE listings SET asking_price_cents=22550,last_price_cents=22550 WHERE id=?',[result.listingId]);
recordReportedOutcome({userId:1,listingId:result.listingId,action:'bought',purchasePriceCents:25050,notes:'Synthetic purchase for browser QA.'});
const server=Bun.serve({hostname:'127.0.0.1',port:Number(process.env.PORT??3210),fetch:app.fetch});
console.log(JSON.stringify({ready:true,port:server.port,listingId:result.listingId}));
