/** Two loopback origins simulate independent devices against one disposable DB. */
import {resolve,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
const path=process.env.FILTRSOFT_DB;
if(!path||!resolve(path).startsWith(resolve(tmpdir())+sep)||!dirname(path).includes('filtrsoft-sync-'))throw Error('A disposable sync fixture database is required');
const {db}=await import('../db/index.ts'),{app}=await import('../api/index.ts'),{checkFetched}=await import('../engine/index.ts');
const {adoptDevice}=await import('../api/auth.ts');
const d=db(),at=new Date().toISOString();
for(const id of [1,2]){
  d.run('INSERT INTO users(id,email,name,created_at,last_seen_at) VALUES(?,?,?,?,?)',[id,`sync${id}@example.invalid`,id===1?'Sync preview':'Separate account',at,at]);
  d.run('INSERT INTO sessions VALUES(?,?,?,?,?)',[`sync-fixture-${id}`,id,at,'2099-01-01T00:00:00.000Z',null]);
}
globalThis.fetch=Object.assign(async()=>{throw Error('Fixture network forbidden');},{preconnect:()=>{}}) as typeof fetch;
const checked=await checkFetched({source:'craigslist',sourceId:'sync-demo',url:'https://boston.craigslist.org/gbs/sop/d/newton-graphics-card/9999999999.html',title:'NVIDIA RTX 3070 8GB',description:'One NVIDIA RTX 3070 8GB graphics card. Works well. Test it at pickup. Includes original box.',askingPriceCents:25050,location:'Newton, MA',postedAt:at,updatedAt:null,photoUrls:[],attributes:{},raw:{}},{persist:true,vision:false});
const ports=[0,1,2].map(n=>Number(process.env.PORT??3215)+n);
for(const port of ports)Bun.serve({hostname:'127.0.0.1',port,fetch(req){
  const u=new URL(req.url);
  if(u.pathname==='/__phone')return new Response('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Filtrsoft mobile preview</title><style>body{margin:0;background:#242a32;display:grid;place-items:center;min-height:100vh}iframe{width:375px;height:812px;border:0;background:#101319}</style><iframe title="Filtrsoft at 375 CSS pixels" src="/"></iframe>',{headers:{'Content-Type':'text/html'}});
  const fixtureOwner=/filtrsoft_session=sync-fixture-([12])/.exec(req.headers.get('cookie')??'')?.[1];
  if(fixtureOwner&&u.searchParams.has('ref'))adoptDevice(Number(fixtureOwner),u.searchParams.get('ref')!);
  if(u.pathname==='/__preview')return new Response(null,{status:302,headers:{Location:u.searchParams.get('screen')==='listing'?`/c/${checked.listingId}`:'/settings','Set-Cookie':`filtrsoft_session=sync-fixture-${u.searchParams.get('account')==='2'?2:1}; Path=/; HttpOnly; SameSite=Lax`}});
  if(u.pathname==='/__public')return new Response(null,{status:302,headers:{Location:'/','Set-Cookie':'filtrsoft_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'}});
  return app.fetch(req);
}});
console.log(JSON.stringify({ready:true,ports,listingId:checked.listingId}));
