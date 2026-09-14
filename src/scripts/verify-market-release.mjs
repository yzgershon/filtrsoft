/** Public HTTP release checks only. No sessions, login, browser automation or writes to production. */
import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const base='https://filtrsoft.com',hash=b=>createHash('sha256').update(b).digest('hex');
const get=path=>fetch(base+path,{signal:AbortSignal.timeout(20000)});
const assets=await Promise.all(readdirSync('web/dist/assets').filter(f=>/\.(?:css|js)$/.test(f)).map(async name=>{
  const r=await get('/assets/'+name),bytes=Buffer.from(await r.arrayBuffer());
  return {name,status:r.status,matches:r.ok&&hash(bytes)===hash(readFileSync('web/dist/assets/'+name))};
}));
const routes=await Promise.all(['/v1/feed','/v1/follow-ups','/v1/market/products','/v1/market/products/1/history'].map(async path=>({path,status:(await get(path)).status})));
const health=await (await get('/v1/health')).json(),me=await (await get('/v1/auth/me')).json();
const privacyResponse=await get('/privacy'),privacy=await privacyResponse.text(),html=await (await get('/')).text();
const entryNames=[...readFileSync('web/dist/index.html','utf8').matchAll(/\/assets\/([^"']+)/g)].map(m=>m[1]);
const report={at:new Date().toISOString(),commit:process.argv[2]??null,assets,routes,health,registrationOpen:me.providers?.registrationOpen,googleConfigured:me.providers?.google,
  privacy:privacyResponse.ok&&privacy.includes('Privacy at Filtrsoft')&&privacy.includes('seller-link'),entryMatches:entryNames.every(name=>html.includes(name))};
report.ok=assets.every(a=>a.matches)&&routes.every(r=>r.status===401)&&health.ok===true&&report.registrationOpen===true&&report.privacy&&report.entryMatches;
mkdirSync('docs/qa/market',{recursive:true});writeFileSync('docs/qa/market/production.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(!report.ok)process.exitCode=1;
