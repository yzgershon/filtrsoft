/** Local browser QA with the real API and unchanged packaged sale evidence. */
import {resolve,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
const fixturePath=process.env.FILTRSOFT_DB;
if(!fixturePath||!resolve(fixturePath).startsWith(resolve(tmpdir())+sep)||!dirname(fixturePath).includes('filtrsoft-market-'))throw new Error('A disposable market fixture database is required');
const {db}=await import('../db/index.ts');
const {readArchive,importArchive}=await import('../db/archive.ts');
const {app}=await import('../api/index.ts');
const d=db(),archive=readArchive();if(!archive)throw new Error('Packaged archive missing');importArchive(archive);
const at=new Date().toISOString();
for(const id of [1,2]){
  d.run('INSERT OR IGNORE INTO users(id,email,name,created_at,last_seen_at) VALUES(?,?,?,?,?)',[id,`market${id}@example.invalid`,'Market preview',at,at]);
  d.run('INSERT OR IGNORE INTO sessions VALUES(?,?,?,?,?)',[`market-fixture-${id}`,id,at,'2099-01-01T00:00:00.000Z',null]);
}
globalThis.fetch=Object.assign(async()=>{throw new Error('Fixture network forbidden');},{preconnect:()=>{}}) as typeof fetch;
const server=Bun.serve({hostname:'127.0.0.1',port:Number(process.env.PORT??3214),fetch(req){
  const u=new URL(req.url);
  if(u.pathname==='/__preview')return new Response(null,{status:302,headers:{Location:'/market','Set-Cookie':`filtrsoft_session=market-fixture-${u.searchParams.get('account')==='2'?2:1}; Path=/; HttpOnly; SameSite=Lax`}});
  return app.fetch(req);
}});
console.log(JSON.stringify({ready:true,port:server.port,fixture:'Packaged archive, disposable accounts; no production mutations'}));
