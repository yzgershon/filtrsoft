/** Uses the real service worker and real CacheStorage against synthetic HTTP.
 * No credentials, private production data, SQLite, or provider requests. */
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {startPreview} from './frontend-preview.mjs';
const output='docs/qa/frontend-fixes';await mkdir(output,{recursive:true});
const html=await readFile('web/dist/index.html','utf8'),worker=await readFile('web/dist/sw.js','utf8');
let identity='A',status=200,failAPI=false,badAsset=false,revision=1;
const base='http://127.0.0.1:3196',results=[];
const server=await startPreview(3196,async(req,res)=>{
 const url=new URL(req.url,base),path=url.pathname;
 const send=(body,type='text/html',code=200)=>{res.writeHead(code,{'content-type':type,'cache-control':'no-store'});res.end(body);return true;};
 if(path==='/worker-fixture')return send('<!doctype html><title>Worker test</title><body>Worker fixture</body>');
 if(path==='/sw.js')return send(worker,'text/javascript');
 if(path==='/index.html'||path==='/next-shell')return send(revision===1?html:html.replace('</head>',`<script type="module" src="/assets/revision-${revision}.js"></script></head>`));
 if(path.startsWith('/assets/revision-'))return send(badAsset?'<html>Missing asset</html>':'window.syntheticRevision=true;',badAsset?'text/html':'text/javascript');
 if(path==='/v1/probe'){if(failAPI){req.socket.destroy();return true;}return send(JSON.stringify({identity,status,method:req.method}),'application/json',status);}
 if(path==='/assets/cache-check.js')return send('window.cacheCheck=true;','text/javascript');
 return false;
});
const browser=await chromium.launch({channel:'chrome',headless:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}throw Error('worker condition timed out');}
async function check(name,fn){let timer;try{await Promise.race([fn(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('check timed out')),20000);})]);results.push({name,pass:true});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL',name,e.message);}finally{clearTimeout(timer);}}
let c,p;
try{
 c=await browser.newContext({serviceWorkers:'allow'});p=await c.newPage();await p.goto(base+'/worker-fixture');
 await p.evaluate(async()=>{await(await caches.open('filtrsoft-v1-api')).put('/v1/probe',new Response('{"identity":"OLD"}'));await(await caches.open('other-app')).put('/keep',new Response('keep'));});
 await p.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;});await until(()=>p.evaluate(()=>!!navigator.serviceWorker.controller));
 await check('Worker upgrade removes old private caches and keeps unrelated caches',async()=>{const keys=await p.evaluate(()=>caches.keys());assert(!keys.includes('filtrsoft-v1-api'));assert(keys.includes('other-app'));});
 await check('Account A then B never replays cached API data; HTTP status passes through',async()=>{for(const account of ['A','B']){identity=account;assert.equal(await p.evaluate(async()=> (await(await fetch('/v1/probe')).json()).identity),account);}for(const code of [401,409,429,503]){status=code;assert.equal(await p.evaluate(async()=> (await fetch('/v1/probe')).status),code);}status=200;const privateKeys=await p.evaluate(async()=>{const hits=[];for(const n of await caches.keys())for(const k of await(await caches.open(n)).keys())if(k.url.includes('/v1/'))hits.push(k.url);return hits;});assert.deepEqual(privateKeys,[]);});
 await check('Transport failures and offline writes produce explicit 503 without acknowledgements',async()=>{failAPI=true;const r=await p.evaluate(async()=>{const r=await fetch('/v1/probe',{method:'POST',body:'example'});return {status:r.status,...await r.json()};});assert.equal(r.status,503);assert.equal(r.offline,true);failAPI=false;await c.setOffline(true);assert.equal(await p.evaluate(async()=> (await fetch('/v1/probe')).status),503);await c.setOffline(false);});
 await check('First installed shell has all referenced JS/CSS before offline navigation',async()=>{await until(()=>p.evaluate(async()=>!!await(await caches.open('filtrsoft-v2-shell')).match('/index.html')));const complete=await p.evaluate(async()=>{const cache=await caches.open('filtrsoft-v2-shell'),r=await cache.match('/index.html'),html=await r.text();const urls=[...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(m=>m[1]);return (await Promise.all(urls.map(u=>cache.match(u)))).every(Boolean);});assert(complete);await c.setOffline(true);const res=await p.goto(base+'/offline-launch');assert.equal(res.status(),200);await p.getByRole('button',{name:'Try again'}).waitFor();assert.equal(await p.locator('.landing-intro').count(),0);await c.setOffline(false);await p.goto(base+'/worker-fixture');});
 await check('Online updates refresh a complete shell; HTML masquerading as JavaScript is rejected',async()=>{revision=2;await p.goto(base+'/next-shell');await until(()=>p.evaluate(async()=> (await(await(await caches.open('filtrsoft-v2-shell')).match('/index.html')).text()).includes('revision-2.js')));revision=3;badAsset=true;await p.goto(base+'/next-shell');await sleep(500);const shell=await p.evaluate(async()=>{const cache=await caches.open('filtrsoft-v2-shell');return (await cache.match('/index.html')).text();});assert(shell.includes('revision-2.js'));assert(!shell.includes('revision-3.js'));assert.equal(await p.evaluate(async()=>!!await(await caches.open('filtrsoft-v2-shell')).match('/assets/revision-3.js')),false);badAsset=false;});
 await check('Cache failures preserve successful network assets and explicit offline fallback',async()=>{
  await p.goto(base+'/worker-fixture');const active=c.serviceWorkers()[0];
  await active.evaluate(()=>{self.originalCacheOpen=CacheStorage.prototype.open;self.originalCachePut=Cache.prototype.put;Cache.prototype.put=async()=>{throw Error('synthetic quota');};});
  assert.equal(await p.evaluate(async()=> (await fetch('/assets/cache-check.js?put')).status),200);
  await active.evaluate(()=>{Cache.prototype.put=self.originalCachePut;CacheStorage.prototype.open=async()=>{throw Error('synthetic storage');};});
  assert.equal(await p.evaluate(async()=> (await fetch('/assets/cache-check.js?open')).status),200);
  assert.equal(await p.evaluate(async()=> (await fetch('/v1/probe')).status),200);
  await c.setOffline(true);const r=await p.goto(base+'/no-storage-offline');assert.equal(r.status(),503);await p.getByText('Connection unavailable',{exact:true}).waitFor();
  await c.setOffline(false);await active.evaluate(()=>{CacheStorage.prototype.open=self.originalCacheOpen;});
 });
}finally{await browser.close();await new Promise(r=>server.close(r));await writeFile(`${output}/worker-checks.json`,JSON.stringify({at:new Date().toISOString(),actualServiceWorker:true,syntheticHTTP:true,results},null,2));}
if(results.some(r=>!r.pass))process.exitCode=1;
