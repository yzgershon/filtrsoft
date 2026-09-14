/** Public HTTP release receipt; no login, account creation or production writes. */
import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const base='https://filtrsoft.com',hash=b=>createHash('sha256').update(b).digest('hex');
const get=path=>fetch(base+path,{signal:AbortSignal.timeout(20000)});
const files=[...readdirSync('web/dist/assets').filter(f=>/\.(css|js)$/.test(f)).map(f=>'assets/'+f),...readdirSync('web/dist/art').map(f=>'art/'+f)];
const assets=await Promise.all(files.map(async path=>{const r=await get('/'+path),bytes=Buffer.from(await r.arrayBuffer());return {path,status:r.status,type:r.headers.get('content-type'),matches:r.ok&&hash(bytes)===hash(readFileSync('web/dist/'+path))};}));
const routes=await Promise.all(['/v1/feed','/v1/account/sync?account=1','/v1/market/products','/v1/follow-ups'].map(async path=>({path,status:(await get(path)).status})));
const health=await(await get('/v1/health')).json(),auth=await(await get('/v1/auth/me')).json(),privacy=await(await get('/privacy')).text(),html=await(await get('/')).text();
const entries=[...readFileSync('web/dist/index.html','utf8').matchAll(/\/assets\/([^"']+)/g)].map(m=>m[1]);
const report={at:new Date().toISOString(),commit:process.argv[2]??null,assets,routes,health,registrationOpen:auth.providers?.registrationOpen,googleConfigured:auth.providers?.google,privacy:privacy.includes('Privacy at Filtrsoft')&&privacy.includes('sync'),entryMatches:entries.every(name=>html.includes(name))};
report.ok=assets.every(a=>a.matches)&&assets.filter(a=>a.path.startsWith('art/')).every(a=>a.type?.startsWith('image/webp'))&&routes.every(r=>r.status===401)&&health.ok===true&&report.registrationOpen===true&&report.privacy&&report.entryMatches;
mkdirSync('docs/qa/account-sync',{recursive:true});writeFileSync('docs/qa/account-sync/production.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
