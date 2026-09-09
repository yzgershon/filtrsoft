/** Built listing report: responsive evidence, truthful unknowns and interaction
 * regressions. Synthetic HTTP only; Node drives Chrome, never Bun. */
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {startDetailPreview,detailFixture} from './detail-preview.mjs';
const dir='docs/qa/listing-report'; await mkdir(dir,{recursive:true});
const server=await startDetailPreview(3198), base='http://127.0.0.1:3198';
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[],errors=[];
async function check(name,fn) { try { await fn();results.push({name,pass:true});console.log('PASS',name); } catch(e) { results.push({name,pass:false,error:e.message});console.log('FAIL',name,e.message); } }
async function context(width=390,height=844) {
  const c=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});
  await c.addInitScript(()=>localStorage.setItem('filtrsoft:settings','{"askOutcomes":false}'));
  await c.route('**/*',r=>['127.0.0.1','fonts.googleapis.com','fonts.gstatic.com'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
  const p=await c.newPage(); p.on('pageerror',e=>errors.push(e.message)); return {c,p};
}
async function go(p,id=101) { await p.goto(`${base}/c/${id}`);await p.locator('.verdict').waitFor();await p.evaluate(()=>document.fonts.ready); }
async function noOverflow(p) {
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow');
  const bad=await p.locator('.listing-report').evaluate(root=>[...root.querySelectorAll('h1,h2,p,dd,summary,.detail-metrics,.resale-channel')].filter(e=>e.getClientRects().length && e.closest('details:not([open])')===null).filter(e=>{const b=e.getBoundingClientRect();return b.left<0||b.right>innerWidth+1;}).map(e=>e.className||e.tagName));
  assert.deepEqual(bad,[],'content outside viewport');
}
async function shot(p,name,fullPage=true) { await p.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await p.screenshot({path:`${dir}/${name}.png`,fullPage,animations:'disabled'}); }
const row=(p,title)=>p.locator('.detail-row').filter({has:p.locator('summary b').filter({hasText:new RegExp(`^${title}$`)})});
try {
  await check('Six responsive widths: priced, unknown, risky, inventory and long-text reports',async()=>{
    const {c,p}=await context();
    for(const width of [360,390,430,768,1024,1440]) {
      await p.setViewportSize({width,height:width>=1024?1000:844});
      for(const id of [101,102,103,104,105]) {
        await go(p,id);await noOverflow(p);
        assert.equal(await p.locator('h1').count(),1);
        if([390,1440].includes(width) && [101,102,103,104].includes(id))await shot(p,`${id}-${width}`);
      }
    }
    await c.close();
  });
  await check('Disclosure keyboard access, complete evidence and coherent selected-channel arithmetic',async()=>{
    const {c,p}=await context();await go(p);
    assert.equal(await p.locator('.detail-row[open]').count(),0);
    const calc=row(p,'Offer calculator');await calc.locator('summary').focus();await p.keyboard.press('Enter');assert(await calc.getAttribute('open')!==null);
    assert((await p.locator('.offerout').textContent()).includes('$165'));
    await p.getByRole('button',{name:'eBay',exact:true}).click();assert((await p.locator('.detail-metrics').textContent()).includes('$70'));assert((await p.locator('.offerout').textContent()).includes('$70'));
    await p.locator('.offerslide').fill('70000');await p.getByRole('button',{name:'Local',exact:true}).click();assert.equal(await p.locator('.offerslide').inputValue(),'70000');assert((await p.locator('.offerout').textContent()).includes('$215'));
    await row(p,'Resale breakdown').locator('summary').click();assert((await row(p,'Resale breakdown').textContent()).includes('Estimated proceeds'));
    await row(p,'Sold-price evidence').locator('summary').click();assert.equal(await p.locator('.comp').count(),3);
    await row(p,'Seller description').locator('summary').click();assert.equal(await p.locator('.seller-description p').textContent(),detailFixture(101).meta.description);
    await row(p,'Listing details').locator('summary').click();assert((await row(p,'Listing details').textContent()).includes('Days listed'));
    await noOverflow(p);await shot(p,'expanded-mobile');await c.close();
  });
  await check('Missing prices stay unknown; risky evidence stays outside disclosures',async()=>{
    const {c,p}=await context();await go(p,102);
    assert.equal(await p.locator('.valuation-summary,.offerslide').count(),0);
    assert((await p.locator('.listing-ask').textContent()).includes('Not provided'));
    assert(await p.getByText('memory kit layout',{exact:true}).isVisible());
    assert(await p.getByRole('button',{name:'Back',exact:true}).isVisible());
    await go(p,103);assert(await p.getByText('Activation Lock',{exact:true}).isVisible());
    assert(await p.getByText('Seller asks for a deposit before showing the phone.',{exact:true}).isVisible());
    const defect=await p.locator('.disclosed-defects').boundingBox(),price=await p.locator('.valuation-summary').boundingBox();assert(defect.y<price.y);
    await c.close();
  });
  await check('Fourteen inventory offers retain exact cents, quantities, tiers and seller quotes',async()=>{
    const {c,p}=await context(360);await go(p,104);
    assert.equal(await p.locator('.inventory-item').count(),14);
    assert.equal(await p.locator('.offerslide,.valuation-summary').count(),0);
    assert(!(await p.locator('.listing-ask').textContent()).includes('$1'));
    const first=p.locator('.inventory-item').first(),tier=p.locator('.inventory-item').nth(1);
    assert((await first.textContent()).includes('$17.50'));assert((await first.textContent()).includes('7×'));
    assert((await tier.textContent()).includes('Conditional pricing'));
    await tier.locator('summary').click();assert(await p.getByText('$15', {exact:true}).count()===0);
    assert((await tier.locator('blockquote').textContent()).includes('$15 each, $10 each if you buy 10 or more'));
    assert((await p.locator('.inventory-item').nth(2).textContent()).includes('$0.50'));
    await noOverflow(p);await c.close();
  });
  await check('Decimal asking/offer values remain exact and zero-profit targets remain visible',async()=>{
    const {c,p}=await context();const d=detailFixture(101);d.listing.askingPriceCents=1750;d.verdict.requiredProfitCents=10000;d.verdict.channels=[{channel:'facebook',available:true,grossCents:1500,feesCents:0,shippingCents:0,netCents:1500}];
    await p.route('**/v1/checks/101?*',r=>r.fulfill({json:d}));await go(p);
    assert((await p.locator('.listing-ask').textContent()).includes('$17.50'));
    assert((await p.locator('.detail-metrics').textContent()).includes('$0'));
    await row(p,'Offer calculator').locator('summary').click();assert.equal(await p.locator('.offerslide').inputValue(),'1750');assert((await p.locator('.offerout').textContent()).includes('-$2.50'));await c.close();
  });
  await check('Gallery controls, full image, Back dismissal and failed-photo recovery',async()=>{
    const {c,p}=await context();await go(p);
    await p.getByRole('button',{name:'Next listing photo',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.gallery-controls span')?.textContent==='2 / 3');
    assert.equal(await p.locator('.galshot img').first().evaluate(e=>getComputedStyle(e).objectFit),'contain');
    await p.getByRole('button',{name:'Photo 2 of 3',exact:true}).click();await p.getByRole('dialog').waitFor();assert(await p.locator('.app').evaluate(e=>e.inert));
    await p.goBack();await p.getByRole('dialog').waitFor({state:'hidden'});assert.equal(new URL(p.url()).pathname,'/c/101');assert.equal(await p.getByRole('button',{name:'Photo 2 of 3',exact:true}).evaluate(e=>e===document.activeElement),true);
    await p.route('**/preview-assets/0',r=>r.abort());await go(p);await p.getByRole('button',{name:'Retry photo',exact:true}).waitFor();await p.unroute('**/preview-assets/0');await p.getByRole('button',{name:'Retry photo',exact:true}).click();await p.getByRole('button',{name:'Photo 1 of 3',exact:true}).waitFor();await c.close();
  });
  await check('Clipboard denial shows no success; confirmed copies contain exact questions',async()=>{
    const {c,p}=await context();await c.addInitScript(()=>{window.testClipboard=[];window.rejectCopy=true;Object.defineProperty(navigator,'clipboard',{value:{writeText:async t=>{if(window.rejectCopy)throw Error('denied');window.testClipboard.push(t);}}});});await go(p);
    await p.getByRole('button',{name:'Copy all',exact:true}).click();assert.equal(await p.locator('.copyall.ok').count(),0);
    await p.evaluate(()=>window.rejectCopy=false);await p.getByRole('button',{name:'Copy all',exact:true}).click();await p.locator('.copyall.ok').waitFor();assert.equal((await p.evaluate(()=>window.testClipboard))[0],detailFixture(101).verdict.questions.map((q,i)=>`${i+1}. ${q}`).join('\n'));await c.close();
  });
  await check('Review remains deliberate and errors preserve the label and decision token',async()=>{
    const {c,p}=await context();let writes=[];await p.route('**/v1/checks/101/override',r=>{writes.push(r.request().postDataJSON());return r.fulfill({status:503,json:{error:'synthetic failure'}});});await go(p);
    await p.getByRole('button',{name:'Review this listing',exact:true}).click();assert.equal(writes.length,0);await p.getByRole('dialog').getByRole('button',{name:/Fair/}).click();await p.getByRole('dialog').getByRole('alert').waitFor();assert.equal(writes[0].decisionToken,'synthetic-preview-token');assert((await p.locator('.verdict .vbadge').textContent()).includes('Buy it'));await p.keyboard.press('Escape');await p.getByRole('dialog').waitFor({state:'hidden'});
    await go(p,106);assert((await p.locator('.decision-owner').textContent()).includes('Your call'));assert((await p.locator('.engine-original').textContent()).includes('Verify first'));await c.close();
  });
  await check('Reduced motion, larger text and landscape keep controls and evidence usable',async()=>{
    const {c,p}=await context(360);await p.emulateMedia({reducedMotion:'reduce'});await go(p,105);
    await p.locator('.listing-report').evaluate(root=>{for(const e of root.querySelectorAll('h1,h2,p,dt,dd,summary b,summary small,.detail-label,.resale-channel>span'))e.style.fontSize=`${parseFloat(getComputedStyle(e).fontSize)*1.5}px`;});await noOverflow(p);
    await row(p,'Seller description').locator('summary').click();assert.equal(await p.locator('.seller-description .row-content').evaluate(e=>getComputedStyle(e).animationName),'none');await noOverflow(p);await shot(p,'larger-text');
    await p.setViewportSize({width:844,height:390});await go(p);await noOverflow(p);await p.getByRole('button',{name:'Photo 1 of 3',exact:true}).click();await p.getByRole('dialog').waitFor();const close=p.getByRole('button',{name:'Close photos',exact:true});assert(await close.isVisible());const bounds=await close.boundingBox();assert(bounds.y>=0&&bounds.y+bounds.height<=390);assert(await close.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));await close.click();await p.getByRole('dialog').waitFor({state:'hidden'});await c.close();
  });
} finally {
  await browser.close();await new Promise(r=>server.close(r));await writeFile(`${dir}/checks.json`,JSON.stringify({at:new Date().toISOString(),synthetic:true,results,errors},null,2));
}
if(results.some(r=>!r.pass)||errors.length){console.log(errors);process.exitCode=1;}
