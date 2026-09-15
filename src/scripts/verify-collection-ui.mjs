import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const bun=process.argv[2];if(!bun)throw new Error('Pass the existing Bun executable');
const base='http://127.0.0.1:3194',out=resolve('docs/qa/collector');mkdirSync(out,{recursive:true});
const database=resolve(`backups/collection-fixture-${Date.now()}/fixture.db`);
const child=spawn(bun,['run','src/scripts/collection-fixture.ts'],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,FILTRSOFT_DB:database,FILTRSOFT_CRAWL:'off',FILTRSOFT_VISION:'off',PORT:'3194'}});
let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
let browser;
try {
  const deadline=Date.now()+15000;while(!log.includes('fixture ready')&&Date.now()<deadline&&child.exitCode===null)await new Promise(r=>setTimeout(r,100));
  assert.ok(log.includes('fixture ready'),log);
  browser=await chromium.launch({executablePath:process.env.FILTRSOFT_CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const context=await browser.newContext();await context.addCookies([{name:'filtrsoft_session',value:'collection-fixture',url:base}]);
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const checks=[];
  for(const width of [390,1280])for(const theme of ['dark','light']) {
    await page.setViewportSize({width,height:900});await page.goto(base+'/settings');await page.locator('#collection-title').waitFor();
    await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    const panel=page.locator('#collection');await panel.scrollIntoViewIfNeeded();assert.equal(await panel.locator('.collection-machines').getByText('Gaming desktop',{exact:true}).count(),1);
    assert.ok(await panel.getByText('Marketplace challenge',{exact:true}).isVisible());assert.ok(await panel.getByText('Not recorded',{exact:true}).count()>0);
    await panel.getByText('Primary computer & fallback',{exact:true}).click();await panel.getByLabel('Primary computer',{exact:true}).selectOption('00000000-0000-4000-8000-000000000001');
    await panel.getByLabel('Use a backup after this many minutes offline').fill('5');await panel.getByRole('button',{name:'Save preference',exact:true}).click();
    await page.waitForFunction(async()=>{const r=await fetch('/v1/collection/health');return (await r.json()).policy.preferredNode==='00000000-0000-4000-8000-000000000001';});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false);
    const targets=await panel.locator('button:visible,select:visible,input:visible').evaluateAll(els=>els.map(e=>({tag:e.tagName,height:e.getBoundingClientRect().height})));assert.ok(targets.every(t=>t.height>=44),JSON.stringify(targets));
    await panel.screenshot({path:resolve(out,`collection-${width}-${theme}.png`)});
    await panel.getByText('Primary computer & fallback',{exact:true}).click();
    await panel.evaluate(el=>window.scrollTo({top:el.getBoundingClientRect().top+window.scrollY-85,behavior:'instant'}));
    await page.screenshot({path:resolve(out,`viewport-${width}-${theme}.png`)});checks.push({width,theme,overflow,targets});
  }
  assert.deepEqual(errors,[]);writeFileSync(resolve(out,'ui.json'),JSON.stringify({at:new Date().toISOString(),checks,errors,fixture:true},null,2));console.log(JSON.stringify({ok:true,checks:checks.length}));
}finally{await browser?.close();child.kill();}
