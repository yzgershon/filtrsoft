/** Regression and visual checks against built assets and a synthetic local API.
 * Run with Node. No accounts, database, real overrides, or external API calls. */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startPreview, detail } from './frontend-preview.mjs';

const output='docs/qa/frontend-redesign'; await mkdir(output,{recursive:true});
const server=await startPreview(3189), base='http://127.0.0.1:3189';
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[], errors=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let n=0;n<80;n++){if(await fn())return;await pause(50);}throw new Error(label);}
async function context(scenario='normal',width=1440,height=1000){
  const ctx=await browser.newContext({viewport:{width,height},serviceWorkers:'block',extraHTTPHeaders:{'x-preview-scenario':scenario}});
  await ctx.addInitScript(()=>localStorage.setItem('filtrsoft:watch','[101,102]'));
  await ctx.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'||u.hostname==='fonts.googleapis.com'||u.hostname==='fonts.gstatic.com'?route.continue():route.abort();});
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));return {ctx,page};
}
async function shot(page,name){
  await page.evaluate(async()=>{await document.fonts.ready;for(const i of document.images)i.loading='eager';await Promise.all([...document.images].map(i=>i.complete?null:new Promise(r=>{i.onload=r;i.onerror=r})));});
  await page.evaluate(()=>{document.activeElement?.blur?.();scrollTo({top:0,left:0,behavior:"instant"})});
  await pause(350);await page.screenshot({path:`${output}/${name}.png`,fullPage:true});
}
async function check(name,fn){try{await fn();results.push({name,pass:true});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL',name,e.message);}}
try{
  await check('Responsive built layouts, primary screens, and no horizontal overflow',async()=>{
    const {ctx,page}=await context();
    for(const [width,height] of [[360,800],[375,850],[768,1024],[1024,900],[1440,1000],[844,390]]){
      await page.setViewportSize({width,height});
      for(const route of ['/','/c/101','/check','/saved','/settings','/account','/notifications','/more']){
        await page.goto(base+route);await page.locator('.workspace-nav').waitFor({state:'attached'});
        if(route==='/')await page.locator('.dealhero').waitFor();
        if(route==='/c/101')await page.locator('.verdict').waitFor();
        await page.evaluate(()=>document.fonts.ready);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow ${route} at ${width}`);
        if((width===375||width===1440)&&['/','/c/101','/check','/saved','/settings'].includes(route))await shot(page,`${({'/':'discover','/c/101':'detail','/check':'check','/saved':'saved','/settings':'settings'})[route]}-${width===375?'mobile':'desktop'}`);
      }
    }
    await ctx.close();
  });
  await check('Landing and sign-in layout at mobile and desktop sizes',async()=>{
    const {ctx,page}=await context('landing');
    for(const width of [360,375,768,1440]){
      await page.setViewportSize({width,height:900});await page.goto(base);await page.locator('.landing-intro').waitFor();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`landing overflow ${width}`);
      if(width===375||width===1440)await shot(page,`landing-${width===375?'mobile':'desktop'}`);
      await page.locator('.mknavr').getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('.authform').waitFor();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`auth overflow ${width}`);
    }
    await ctx.close();
  });
  await check('Filters, keyboard dialog closure and explicit price sorting',async()=>{
    const {ctx,page}=await context();await page.goto(base+'/?quality=all');await page.locator('.dealhero').waitFor();
    await page.locator('.sort-trigger').click();await page.getByRole('dialog').getByRole('button',{name:/Cheapest/}).click();await page.locator('.gcard').first().waitFor();
    await until(async()=>new URL(page.url()).searchParams.get('sort')==='price'&&await page.locator('.dealhero').count()===0,'price sort applied');
    const prices=await page.locator('.gprice').allTextContents();assert(prices.every((v,i)=>i===0||Number(v.replace(/[^\d.]/g,''))>=Number(prices[i-1].replace(/[^\d.]/g,''))));
    await page.locator('.filter-action').click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert(await page.locator('.filter-action').evaluate(e=>e===document.activeElement));
    await page.getByRole('searchbox',{name:'Search listings'}).fill('Latitude');await page.locator('.discovery-search button').click();await until(async()=>await page.locator('.gbody b').count()===2,'filtered rows');assert((await page.locator('.gbody b').allTextContents()).every(x=>x.includes('Latitude')));
    await ctx.close();
  });
  await check('Browser Back + Forward followed by app Back preserves the filtered feed',async()=>{
    const {ctx,page}=await context();await page.goto(base+'/?quality=all');await page.locator('.dealhero').waitFor();
    await page.locator('.sort-trigger').click();await page.getByRole('dialog').getByRole('button',{name:/Cheapest/}).click();await page.locator('.gcard').first().waitFor();
    await page.locator('.gopen').first().click();await page.locator('.verdict').waitFor();await page.goBack();await page.locator('.gcard').first().waitFor();await page.goForward();await page.locator('.verdict').waitFor();await page.getByRole('button',{name:'Back',exact:true}).click();await page.locator('.gcard').first().waitFor();assert(new URL(page.url()).search.includes('sort=price'));
    await ctx.close();
  });
  await check('Deep-link Back and New check have working destinations',async()=>{
    const {ctx,page}=await context();await page.goto(base+'/c/101');await page.locator('.verdict').waitFor();await page.getByRole('button',{name:'Back',exact:true}).click();await page.locator('.dealhero').waitFor();assert.equal(new URL(page.url()).pathname,'/');
    await page.goto(base+'/c/101');await page.locator('.verdict').waitFor();await page.getByRole('button',{name:'New check',exact:true}).click();assert.equal(new URL(page.url()).pathname,'/check');await ctx.close();
  });
  await check('360-row restoration uses 200 + 160 cursor pages and preserves position',async()=>{
    const {ctx,page}=await context('large');const requests=[];page.on('request',r=>{if(r.url().includes('/v1/feed'))requests.push(new URL(r.url()));});
    await page.goto(base+'/?quality=all&sort=newest');await until(async()=>await page.locator('.gcard').count()===60,'first page');
    for(let n=120;n<=360;n+=60){await page.getByRole('button',{name:/Show more/}).click();await until(async()=>await page.locator('.gcard').count()===n,`page ${n}`);}
    const card=page.locator('.gcard').nth(249);await card.scrollIntoViewIfNeeded();const y=await page.evaluate(()=>scrollY);await card.locator('.gopen').click();await page.locator('.verdict').waitFor();requests.length=0;
    await page.getByRole('button',{name:'Back',exact:true}).click();await until(async()=>await page.locator('.gcard').count()===360,'restored window');await pause(350);
    assert.deepEqual(requests.map(u=>Number(u.searchParams.get('limit'))),[200,160]);assert(Math.abs(await page.evaluate(()=>scrollY)-y)<8,'restored offset');
    await page.getByRole('button',{name:/Show more/}).click();await until(async()=>await page.locator('.gcard').count()===420,'next cursor');await ctx.close();
  });
  await check('Detail network failure has a retry and obsolete responses cannot replace a new listing',async()=>{
    const {ctx,page}=await context();let failed=true;
    await page.route('**/v1/checks/101?*',r=>failed?r.abort():r.continue());await page.goto(base+'/c/101');await page.getByRole('button',{name:'Try again',exact:true}).waitFor();failed=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await page.locator('.verdict').waitFor();
    await page.goto(base);await page.locator('.dealhero').waitFor();let release;const wait=new Promise(r=>release=r);
    await page.unroute('**/v1/checks/101?*');await page.route('**/v1/checks/101?*',async r=>{await wait;await r.fulfill({json:detail(101)}).catch(()=>{});});
    await page.locator('.dealhero').click();await page.locator('.workspace-link').filter({hasText:'Discover'}).click();await page.locator('[data-listing-id="102"] .gopen').click();await page.locator('.lh h1').waitFor();release();await pause(100);assert((await page.locator('.lh h1').innerText()).includes('Latitude'));await ctx.close();
  });
  await check('All five Your call options save with the decision token in the synthetic API',async()=>{
    const {ctx,page}=await context();await page.goto(base+'/c/103');await page.locator('.verdict').waitFor();await page.getByRole('button',{name:'Review this listing'}).click();assert.equal(await page.locator('.mycall-options button').count(),5);
    const saved=page.waitForRequest(r=>r.url().endsWith('/override')&&r.method()==='POST');await page.locator('.call-choice.b-FAIR').click();const req=await saved;assert.equal(req.postDataJSON().call,'FAIR');assert.equal(req.postDataJSON().decisionToken,'synthetic-preview-token');await page.getByRole('button',{name:'Change your label'}).waitFor();await ctx.close();
  });
  await check('Canceled detail releases Check and hash Back keeps the feed loaded',async()=>{
    const {ctx,page}=await context();let release;const gate=new Promise(r=>release=r);
    await page.route('**/v1/checks/101?*',async r=>{await gate;await r.fulfill({json:detail(101)}).catch(()=>{});});
    await page.goto(base);await page.locator('.dealhero').waitFor();await page.locator('.skip-link').focus();assert.equal(await page.locator('.skip-link').evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Enter');await page.goBack();await page.locator('.dealhero').waitFor();
    await page.locator('.dealhero').click();await page.locator('.workspace-link').filter({hasText:'Check a listing'}).click();await page.locator('.paste').waitFor();await until(async()=>!(await page.locator('.paste').isDisabled()),'Check still disabled after cancel');release();await ctx.close();
  });
  await check('Failed long restoration retries on online with the full saved window',async()=>{
    const {ctx,page}=await context('large');await page.goto(base+'/?quality=all&sort=newest');await until(async()=>await page.locator('.gcard').count()===60,'initial');
    for(let n=120;n<=240;n+=60){await page.getByRole('button',{name:/Show more/}).click();await until(async()=>await page.locator('.gcard').count()===n,'next');}
    await page.locator('.gcard').nth(210).scrollIntoViewIfNeeded();const y=await page.evaluate(()=>scrollY);await page.locator('.gcard').nth(210).locator('.gopen').click();await page.locator('.verdict').waitFor();
    let fail=true;await page.route('**/v1/feed?*',r=>fail?r.abort():r.continue());await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('button',{name:'Try again',exact:true}).waitFor();fail=false;await page.evaluate(()=>dispatchEvent(new Event('online')));await until(async()=>await page.locator('.gcard').count()===240,'restored after reconnect');await pause(350);assert(Math.abs(await page.evaluate(()=>scrollY)-y)<8);await ctx.close();
  });
  await check('Persistent expired cursors stop with a recoverable error',async()=>{
    const {ctx,page}=await context('large');let cursorRequests=0;await page.route('**/v1/feed?*',r=>{if(new URL(r.request().url()).searchParams.has('cursor')){cursorRequests++;return r.fulfill({status:409,json:{error:'expired'}});}return r.continue();});
    await page.goto(base+'/?quality=all&sort=newest');await until(async()=>await page.locator('.gcard').count()===60,'initial cursor page');await page.getByRole('button',{name:/Show more/}).click();await until(async()=>await page.locator('.gcard').count()===120,'one bounded restart');
    await page.getByRole('button',{name:/Show more/}).click();await until(async()=>await page.locator('.gcard').count()===180,'second interaction');await page.getByRole('button',{name:/Show more/}).click();await page.getByRole('button',{name:'Try again',exact:true}).waitFor();const count=cursorRequests;await pause(200);assert.equal(cursorRequests,count);await ctx.close();
  });
  await check('Session transport failure is recoverable without rendering a signed-out landing page',async()=>{
    const {ctx,page}=await context();let fail=true;await page.route('**/v1/auth/me',r=>fail?r.abort():r.continue());await page.goto(base);await page.getByRole('button',{name:'Try again'}).waitFor();assert.equal(await page.locator('.landing-intro').count(),0);fail=false;await page.getByRole('button',{name:'Try again'}).click();await page.locator('.dealhero').waitFor();await ctx.close();
  });
  await check('Completed synthetic check synchronizes the detail route and Check navigation',async()=>{
    const {ctx,page}=await context();const d=detail(101);
    await page.route('**/v1/checks/stream?*',r=>r.fulfill({contentType:'text/event-stream',body:[['fetched',d.listing],['valued',{verdict:d.verdict,elapsedMs:20}],['done',{listingId:101,listing:d.listing,verdict:d.verdict,decisionToken:d.decisionToken}]].map(([event,data])=>`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')}));
    await page.goto(base+'/check');await page.getByRole('textbox',{name:'Listing URL'}).fill('https://example.test/listing');await page.locator('.field .cta').click();await page.locator('.screen-detail .verdict').waitFor();assert.equal(new URL(page.url()).pathname,'/c/101');await page.locator('.workspace-link').filter({hasText:'Check a listing'}).click();await page.locator('.paste').waitFor();assert.equal(await page.locator('.verdict').count(),0);await ctx.close();
  });
  await check('Reduced motion, larger text, and visible keyboard focus',async()=>{
    const {ctx,page}=await context('normal',375,850);await page.emulateMedia({reducedMotion:'reduce'});await page.goto(base);await page.locator('.dealhero').waitFor();assert.equal(await page.locator('.gcard').first().evaluate(e=>getComputedStyle(e).animationName),'none');
    await page.addStyleTag({content:'body,button,input,select {font-size: 20px !important} .gbody b,.review-intro p {font-size:18px !important}'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.getByRole('searchbox',{name:'Search listings'}).focus();await page.keyboard.press('Tab');assert(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle!=='none'));await shot(page,'large-text-mobile');await ctx.close();
  });
  await check('Leaving a pending check cancels its stream without hijacking the next screen',async()=>{
    const {ctx,page}=await context();let release;const gate=new Promise(r=>release=r);
    await page.route('**/v1/checks/stream?*',async r=>{await gate;await r.fulfill({contentType:'text/event-stream',body:'event: done\ndata: {"listingId":101}\n\n'}).catch(()=>{});});
    await page.goto(base+'/check');await page.getByRole('textbox',{name:'Listing URL'}).fill('https://example.test/listing');await page.locator('.field .cta').click();await page.locator('.workspace-link').filter({hasText:'Discover'}).click();await page.locator('.dealhero').waitFor();release();await pause(200);assert.equal(new URL(page.url()).pathname,'/');await page.locator('.workspace-link').filter({hasText:'Check a listing'}).click();await until(async()=>!(await page.locator('.paste').isDisabled()),'pending check did not cancel');await ctx.close();
  });
  assert.equal(errors.length,0,errors.join('\n'));
}finally{await browser.close();await new Promise(r=>server.close(r));await writeFile(`${output}/checks.json`,JSON.stringify({synthetic:true,results,pageErrors:errors},null,2));}
if(results.some(r=>!r.pass)||errors.length)process.exitCode=1;
