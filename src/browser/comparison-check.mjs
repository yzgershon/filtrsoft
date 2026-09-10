/** Production-bundle comparison QA. Synthetic HTTP fixtures; no account,
 * database, external seller request or benchmark network traffic. */
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {startComparisonPreview} from './comparison-preview.mjs';
const dir='docs/qa/comparison';await mkdir(dir,{recursive:true});
const server=await startComparisonPreview(3205),base='http://127.0.0.1:3205';
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[],errors=[];
async function check(name,fn){try{await fn();results.push({name,pass:true});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL',name,e.message);}}
async function context(width=390,height=844,motion='reduce'){
 const c=await browser.newContext({viewport:{width,height},serviceWorkers:'block',reducedMotion:motion});
 await c.addInitScript(()=>localStorage.setItem('filtrsoft:settings','{"askOutcomes":false}'));
 await c.route('**/*',r=>['127.0.0.1','fonts.googleapis.com','fonts.gstatic.com'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 const p=await c.newPage();p.setDefaultTimeout(8000);p.on('pageerror',e=>errors.push(e.message));return {c,p};
}
async function go(p,query='ids=201,202'){await p.goto(`${base}/compare?${query}`);await p.locator(query.includes('ids=')?'.compare-results':'.compare-start').waitFor();await p.evaluate(()=>document.fonts.ready);}
async function overflow(p){const info=await p.evaluate(()=>({width:innerWidth,client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,bad:[...document.querySelectorAll('body *')].filter(e=>e.getClientRects().length&&getComputedStyle(e).position!=='fixed'&&!e.closest('.compare-kinds')).map(e=>({name:e.tagName,cls:typeof e.className==='string'?e.className:'svg',left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})).filter(b=>b.left<-.5||b.right>document.documentElement.clientWidth+.5).slice(0,12)}));assert(info.scroll<=info.client+1,JSON.stringify(info));}
try{
 await check('Responsive both-theme real bundle at 360/375/390/430/768/1024/1440',async()=>{
  const {c,p}=await context();
  for(const width of [360,375,390,430,768,1024,1440])for(const theme of ['dark','light']){
   await p.setViewportSize({width,height:width>=1024?1000:844});await go(p);
   await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);await overflow(p);
   assert.equal(await p.locator('.compare-message').count(),2);
   assert.equal(await p.locator('.compare-provider').getAttribute('href'),'https://gpu.userbenchmark.com/Compare/Nvidia-RTX-3070-vs-Nvidia-RTX-4070/4083vs4148');
   if([390,1440].includes(width))await p.screenshot({path:`${dir}/${theme}-${width}.png`,fullPage:true,animations:'disabled'});
  }await c.close();
 });
 await check('Picker keyboard selection restores focus; Escape and full report Back retain pair',async()=>{
  const {c,p}=await context();await go(p);
  await p.getByRole('button',{name:/Change listing A/}).click();await p.getByRole('searchbox').fill('3060');
  await p.locator('.compare-candidate').waitFor();await p.getByRole('searchbox').press('Tab');await p.keyboard.press('Enter');
  await p.getByRole('button',{name:/Change listing A: RTX 3060/}).waitFor();
  await p.waitForFunction(()=>document.activeElement?.getAttribute('data-contender')==='0');
  assert.match(p.url(),/ids=206%2C202/);
  await p.getByRole('button',{name:/Change listing A/}).click();await p.getByRole('searchbox').waitFor();await p.keyboard.press('Escape');await p.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(await p.evaluate(()=>document.activeElement?.getAttribute('data-contender')),'0');
  await p.locator('.contender-listing').first().click();await p.locator('.listing-report').waitFor();await p.goBack();await p.locator('.compare-results').waitFor();assert.match(p.url(),/ids=206%2C202/);
  await c.close();
 });
 await check('GPU families withheld; CPU rendering scored; workload and difference controls work',async()=>{
  const {c,p}=await context();await go(p);await p.getByRole('button',{name:'Rendering',exact:true}).click();
  await p.getByText('No fair score for this pair yet').waitFor();assert.equal(await p.locator('.score-numbers').count(),0);
  await go(p,'ids=203,204&kind=cpu&workload=rendering');await p.locator('.score-numbers strong').first().waitFor();assert.equal(await p.locator('.score-numbers strong').count(),2);
  const count=await p.locator('.compare-metrics-section .compare-metric-row').count();await p.getByRole('button',{name:'Differences only'}).click();assert((await p.locator('.compare-metrics-section .compare-metric-row').count())<count);
  await p.getByRole('button',{name:'Gaming',exact:true}).click();await p.getByText('Gaming measurements unavailable').waitFor();assert.equal(await p.locator('.score-numbers').count(),0);
  await c.close();
 });
 await check('Motion is optional, skippable, replayable and disabled for reduced motion',async()=>{
  const {c,p}=await context(390,844,'no-preference');await go(p,'ids=203,204&kind=cpu&workload=rendering');
  await p.getByRole('button',{name:'Skip animation',exact:true}).click();assert.equal(await p.locator('.is-revealing').count(),0);
  await p.getByRole('button',{name:'Replay',exact:true}).click();assert.equal(await p.locator('.is-revealing').count(),1);
  await p.emulateMedia({reducedMotion:'reduce'});await p.locator('.is-revealing').waitFor({state:'hidden'});
  assert.equal(await p.evaluate(()=>document.querySelector('.compare-contender').getAnimations().length),0);
  await c.close();
 });
 await check('Invalid pair, empty state, network retry and current response win over stale response',async()=>{
  const {c,p}=await context();await go(p,'kind=gpu');await p.getByRole('button',{name:/Choose listing A/}).click();await p.getByRole('dialog').waitFor();await p.keyboard.press('Escape');
  await p.goto(`${base}/compare?ids=999`);await p.getByRole('alert').waitFor();await p.getByRole('button',{name:'Choose different listings'}).click();await p.locator('.compare-start').waitFor();
  let first=true;await p.route('**/v1/compare?*',async r=>{if(first){first=false;return r.fulfill({status:503,contentType:'application/json',body:'{"error":"Preview outage"}'});}return r.continue();});
  await p.goto(`${base}/compare?ids=201,202`);await p.getByRole('alert').waitFor();await p.getByRole('button',{name:'Try again',exact:true}).click();await p.locator('.compare-results').waitFor();
  await p.unroute('**/v1/compare?*');await p.route('**/v1/compare?*',async r=>{if(r.request().url().includes('rendering'))await new Promise(resolve=>setTimeout(resolve,250));await r.continue().catch(()=>{});});
  await p.getByRole('button',{name:'Rendering',exact:true}).click();await p.waitForTimeout(40);await p.goBack();await p.goForward();
  await c.close();
 });
 await check('Landscape and 200 percent root text remain within the viewport',async()=>{
  const {c,p}=await context(844,390);await go(p);await overflow(p);await p.setViewportSize({width:390,height:844});await p.evaluate(()=>document.documentElement.style.fontSize='200%');await overflow(p);await c.close();
 });
 assert.deepEqual(errors,[]);
}finally{await writeFile(`${dir}/results.json`,JSON.stringify({results,errors},null,2));await browser.close();server.close();}
if(results.some(r=>!r.pass)||errors.length)process.exitCode=1;
