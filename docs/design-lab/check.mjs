// Static, example-only design checks. Run under Node with serve.mjs on port 3192.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const output = 'docs/qa/design-directions', base = 'http://127.0.0.1:3192';
await mkdir(output, { recursive: true });
const results = [], errors = [], forbidden = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
async function setup(concept = 'shortlist', width = 390, height = 844, reduce = false) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: true, reducedMotion: reduce ? 'reduce' : 'no-preference', serviceWorkers: 'block' });
  await ctx.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith('/v1/') || !['127.0.0.1', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(u.hostname)) { forbidden.push(r.request().url()); return r.abort(); }
    return r.continue();
  });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + (concept ? '/?concept=' + concept : '/'));
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}
const click = (p, name, exact = true) => p.getByRole('button', { name, exact }).click();
async function closed(p) { await p.getByRole('dialog').waitFor({ state: 'hidden' }); }
async function shot(p, name, fullPage = false) { await p.screenshot({ path: `${output}/${name}.png`, fullPage, animations: 'disabled' }); }
async function check(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log('PASS', name); }
  catch (e) { results.push({ name, pass: false, error: e.message }); console.log('FAIL', name, e.message); }
}
try {
  await check('Three distinct home layouts, readable first asks, intact photos and no horizontal page overflow', async () => {
    for (const concept of ['shortlist', 'market', 'workbench']) for (const width of [360, 390, 430]) {
      const { page, ctx } = await setup(concept, width);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${concept} overflow at ${width}`);
      await page.locator('img').first().evaluate(img => img.decode());
      assert(await page.locator('.price').first().evaluate(e => e.getBoundingClientRect().bottom < innerHeight - 69), `${concept} ask hidden at ${width}`);
      assert.equal(await page.locator('.bottom-tabs button').count(), 4);
      assert(await page.locator('.demo-strip').innerText().then(t => t.includes('EXAMPLE DATA')));
      if (width === 390) await shot(page, concept);
      await ctx.close();
    }
  });
  await check('Comparison studio fits desktop and narrow widths', async () => {
    for (const width of [375, 768, 1024, 1440]) {
      const { page, ctx } = await setup(null, width, 1100);
      await page.locator('iframe').first().waitFor();
      for (const frame of page.frames().slice(1)) await frame.locator('h1').waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `studio overflow ${width}`);
      if (width === 1440) { await pause(250); await shot(page, 'compare-all', true); }
      await ctx.close();
    }
  });
  await check('Native sheet focus, Escape, phone Back, backdrop and focused settings destination', async () => {
    const { page, ctx } = await setup();
    await click(page, 'Account menu');
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.evaluate(()=>document.body.style.overflow), 'hidden');
    assert(await page.getByRole('dialog').evaluate(d => d.contains(document.activeElement)));
    await shot(page, 'account-menu');
    await page.keyboard.press('Escape'); await closed(page);
    assert(await page.getByRole('button', { name: 'Account menu', exact: true }).evaluate(b => b === document.activeElement));
    await click(page, 'Account menu'); await page.goBack(); await closed(page);
    await click(page, 'Account menu'); await page.mouse.click(3, 80); await closed(page);
    await click(page, 'Account menu'); await page.getByRole('dialog').getByRole('button', { name: /^Settings/ }).click(); await closed(page);
    await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
    assert(await page.getByRole('heading', { name: 'Settings', exact: true }).evaluate(e => e === document.activeElement));
    await ctx.close();
  });
  await check('Save, unsave and Undo update the candidate set; comparison contains explicit unknowns', async () => {
    const { page, ctx } = await setup();
    await click(page, 'Save NZXT gaming PC');
    await click(page, 'Saved');
    assert.equal(await page.locator('.list-card').count(), 3);
    await click(page, 'Unsave NZXT gaming PC'); assert.equal(await page.locator('.list-card').count(), 2);
    await click(page, 'Undo'); assert.equal(await page.locator('.list-card').count(), 3);
    await click(page, 'Compare'); await page.getByRole('table').waitFor();
    await shot(page, 'compare-candidates');
    await click(page, 'Browse');
    await click(page, 'Save Custom gaming desktop');
    await click(page, 'Unsave Dell Latitude 7420');
    await click(page, 'Saved'); await click(page, 'Compare');
    assert((await page.getByRole('table').innerText()).includes('Unknown'));
    await ctx.close();
  });
  await check('Saved searches retain selected category, exact search text and sorting without push permission', async () => {
    const { page, ctx } = await setup('market');
    await click(page, 'Phones');
    await page.getByRole('searchbox').fill('iPhone'); await page.getByRole('searchbox').press('Enter');
    await click(page, 'Filters and sort'); await click(page, 'Lowest ask'); await click(page, 'Show results'); await closed(page);
    assert.equal(await page.locator('.market-card').count(), 1);
    await page.locator('[data-action="save-search"]').click(); await click(page, 'Save example search'); await closed(page);
    await page.getByRole('heading', { name: 'Your searches' }).waitFor();
    assert.equal(await page.locator('[data-action="saved-search"]').count(), 4);
    await page.locator('[data-action="saved-search"]').first().click();
    assert.equal(await page.getByRole('searchbox').inputValue(), 'iPhone');
    assert.equal(await page.locator('.market-card').count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Phones', exact: true }).getAttribute('aria-pressed'), 'true');
    assert((await page.locator('.market-toolbar').innerText()).includes('Lowest ask'));
    await ctx.close();
  });
  await check('Explicit review, next example and queue progress do not silently label another item', async () => {
    const { page, ctx } = await setup();
    await click(page, 'Open NZXT gaming PC'); await page.getByRole('heading', { name: 'NZXT gaming PC', exact: true }).waitFor();
    await shot(page, 'shortlist-detail');
    await click(page, 'Evidence'); await click(page, 'Inspect');
    await page.locator('[data-check="1-0"]').check();
    await page.getByRole('textbox', { name: 'Your private note' }).fill('Ask for a load test.');
    await click(page, 'Decision'); await click(page, 'Inspect');
    assert(await page.locator('[data-check="1-0"]').isChecked());
    assert.equal(await page.getByRole('textbox', { name: 'Your private note' }).inputValue(), 'Ask for a load test.');
    await click(page, 'Your call'); await shot(page, 'review-choices');
    await page.locator('[data-action="record-review"][data-value="VERIFY"]').click();
    await page.getByRole('heading', { name: 'Review recorded', exact: true }).waitFor();
    await click(page, 'Undo this review'); await closed(page);
    await click(page, 'Your call'); await page.locator('[data-action="record-review"][data-value="VERIFY"]').click();
    await page.getByRole('heading', { name: 'Review recorded', exact: true }).waitFor();
    await click(page, 'Next listing'); await closed(page);
    await page.getByRole('heading', { name: 'Dell Latitude 7420', exact: true }).waitFor();
    await click(page, 'Review');
    assert.equal(await page.locator('.list-card').count(), 3);
    assert.equal(await page.locator('.circle-count').innerText(), '3');
    await ctx.close();
  });
  await check('Deal stage, note and inspection are personal state, while actual paid stays unrecorded', async () => {
    const { page, ctx } = await setup('workbench');
    await click(page, 'Open NZXT gaming PC'); await click(page, 'My deal');
    await page.getByRole('textbox', { name: 'Your private note' }).fill('Waiting for a time to inspect.');
    await click(page, 'Change stage'); await page.locator('[data-action="set-stage"][data-value="Meetup"]').click(); await closed(page);
    assert((await page.locator('.detail-section').innerText()).includes('Actual amount paid\nNot recorded'));
    await shot(page, 'workbench-deal');
    await click(page, 'My deals'); await click(page, 'Meetup');
    assert.equal(await page.locator('.desk-card').count(), 2);
    assert((await page.locator('.desk-card').filter({hasText:'NZXT gaming PC'}).innerText()).includes('Waiting for a time to inspect.'));
    await ctx.close();
  });
  await check('Dark appearance is reversible in all three concepts; reduced motion retains focus', async () => {
    for (const concept of ['shortlist', 'market', 'workbench']) {
      const { page, ctx } = await setup(concept);
      await click(page, 'Account menu'); await page.getByRole('dialog').getByRole('button', { name: /^Settings/ }).click(); await closed(page);
      const before = await page.locator('body').evaluate(e => getComputedStyle(e).backgroundColor);
      const toggle = page.locator('[data-setting="dark"]'); await toggle.click();
      assert.notEqual(await page.locator('body').evaluate(e => getComputedStyle(e).backgroundColor), before);
      await toggle.click(); assert.equal(await page.locator('body').evaluate(e => getComputedStyle(e).backgroundColor), before);
      await page.locator('[data-setting="reduce"]').check();
      assert(await page.locator('[data-setting="reduce"]').evaluate(e => e === document.activeElement));
      assert.equal(await page.locator('.app-main').evaluate(e => getComputedStyle(e).animationName), 'none');
      await ctx.close();
    }
  });
  await check('Landscape, text expansion and reduced-motion sheets remain reachable', async () => {
    for (const concept of ['shortlist', 'market', 'workbench']) {
      const { page, ctx } = await setup(concept, 844, 390, true);
      await click(page, 'Account menu'); await page.getByRole('dialog').waitFor();
      assert.equal(await page.getByRole('dialog').evaluate(e => getComputedStyle(e).animationName), 'none');
      assert(await page.getByRole('dialog').evaluate(e => { const r=e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
      await page.keyboard.press('Escape'); await closed(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => { const all=[...document.querySelectorAll('.proto-root *')]; const sizes=all.map(e=>parseFloat(getComputedStyle(e).fontSize)); all.forEach((e,i)=>e.style.fontSize=(sizes[i]*1.5)+'px'); });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await ctx.close();
    }
  });
  await check('Prototype performs no application API requests and produces no uncaught browser errors', async () => {
    assert.deepEqual(forbidden, []); assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
  await writeFile(`${output}/checks.json`, JSON.stringify({ date: new Date().toISOString(), scope: 'Static example-only prototypes, not production or backend validation', results, errors, forbidden }, null, 2));
}
if (results.some(r => !r.pass)) process.exitCode = 1;
