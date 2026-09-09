/** Built mobile interactions against a synthetic API only. Run under Node. */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startPreview, detail } from './frontend-preview.mjs';

const output = 'docs/qa/mobile-polish';
await mkdir(output, { recursive: true });
const server = await startPreview(3190), base = 'http://127.0.0.1:3190';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [], errors = [], measurements = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label) {
  for (let n = 0; n < 100; n++) { if (await fn()) return; await pause(50); }
  throw new Error(label);
}
async function context(width = 390, height = 844, settings = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', isMobile: width < 700, hasTouch: true });
  await ctx.addInitScript(settings => {
    localStorage.setItem('filtrsoft:settings', JSON.stringify({ askOutcomes: false, ...settings }));
    localStorage.setItem('filtrsoft:notes', JSON.stringify([{ id: 101, title: 'Saved preview alert', call: 'BUY', at: Date.now(), seen: false }]));
  }, settings);
  await ctx.route('**/*', r => ['127.0.0.1', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort());
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  return { ctx, page };
}
async function ready(page, path = '/') { await page.goto(base + path); await page.locator('.dealhero').waitFor(); await page.evaluate(() => document.fonts.ready); }
async function dismissed(page) { await page.getByRole('dialog').waitFor({ state: 'hidden' }); }
async function settled(page) { await page.locator('.popup-panel').evaluate(async e => { await Promise.all(e.getAnimations().map(a => a.finished)); }); }
async function shot(page, name) { if (await page.locator('.popup-panel').count()) await settled(page); await page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' }); }
async function check(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log('PASS', name); }
  catch (e) { results.push({ name, pass: false, error: e.message }); console.log('FAIL', name, e.message); }
}
try {
  await check('First price visible, large segment counts fit, and mobile menus stay within the screen', async () => {
    for (const width of [360, 390, 430]) {
      const { ctx, page } = await context(width);
      await page.route('**/v1/feed?*', async r => {
        const response = await r.fetch(), data = await response.json(); data.segments.all = 10052;
        await r.fulfill({ json: data });
      });
      await ready(page);
      const price = await page.locator('.hprice').boundingBox();
      assert(price.y + price.height < 470, `price below first viewport at ${width}`);
      measurements.push({ width, firstPriceBottom: Math.round(price.y + price.height) });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      if (width === 390) await shot(page, 'discover');
      await page.getByRole('button', { name: 'More', exact: true }).click();
      const dialog = page.getByRole('dialog'); await dialog.waitFor(); await settled(page);
      const box = await dialog.boundingBox();
      assert(box.x >= 10 && box.x + box.width <= width - 10 && box.y > 80 && box.y + box.height <= 844);
      if (width === 390) await shot(page, 'more');
      await ctx.close();
    }
  });
  await check('Menu focus, scroll lock, Escape, backdrop and phone Back preserve the feed', async () => {
    const { ctx, page } = await context(); await ready(page);
    await page.evaluate(() => scrollTo(0, 450)); const y = await page.evaluate(() => scrollY);
    const more = page.getByRole('button', { name: 'More', exact: true });
    await more.click(); await page.getByRole('dialog').waitFor();
    assert(await page.locator('.popup-close').evaluate(e => e === document.activeElement));
    assert(await page.locator('.app').evaluate(e => e.inert));
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
    await page.keyboard.press('Shift+Tab'); assert(await page.locator('.popup-footer-link').evaluate(e => e === document.activeElement));
    await page.keyboard.press('Tab'); assert(await page.locator('.popup-close').evaluate(e => e === document.activeElement));
    await page.keyboard.press('Escape'); await dismissed(page);
    assert(await more.evaluate(e => e === document.activeElement));
    assert(Math.abs(await page.evaluate(() => scrollY) - y) < 2);
    assert.equal(await page.locator('.app').evaluate(e => e.inert), false);
    await more.click(); await page.getByRole('dialog').waitFor(); await page.mouse.click(4, 80); await dismissed(page);
    await more.click(); await page.getByRole('dialog').waitFor(); await page.goBack(); await dismissed(page);
    assert.equal(new URL(page.url()).pathname, '/');
    assert(Math.abs(await page.evaluate(() => scrollY) - y) < 2);
    await ctx.close();
  });
  await check('Quick choices reach full settings and account, while notification preview keeps unread state', async () => {
    const { ctx, page } = await context(); await ready(page);
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^Settings/ }).click();
    await until(() => new URL(page.url()).pathname === '/settings', 'settings destination');
    await page.getByRole('button', { name: 'Back', exact: true }).click(); await page.locator('.dealhero').waitFor();
    await page.getByRole('button', { name: 'Account', exact: true }).click(); await shot(page, 'account');
    await page.getByRole('dialog').getByRole('button', { name: /^Account details/ }).click();
    await until(() => new URL(page.url()).pathname === '/account', 'account destination');
    await page.getByRole('button', { name: 'Back', exact: true }).click(); await page.locator('.dealhero').waitFor();
    await page.locator('.topbar button[aria-haspopup="dialog"]').first().click(); await page.getByRole('dialog').waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('filtrsoft:notes'))[0].seen), false);
    await shot(page, 'notifications');
    await page.getByRole('dialog').getByRole('button', { name: /All notifications/ }).click();
    await until(() => new URL(page.url()).pathname === '/notifications', 'notifications destination');
    await until(() => page.evaluate(() => JSON.parse(localStorage.getItem('filtrsoft:notes'))[0].seen), 'read after opening full page');
    await ctx.close();
  });
  await check('Sort and filter choices apply after dismissal and Back undoes each query once', async () => {
    const { ctx, page } = await context(); await ready(page, '/?quality=all');
    await page.locator('.sort-trigger').click(); await shot(page, 'sort');
    await page.getByRole('dialog').getByRole('button', { name: /Cheapest/ }).click();
    await until(() => new URL(page.url()).searchParams.get('sort') === 'price', 'sort query'); await dismissed(page);
    await until(async () => await page.locator('.dealhero').count() === 0 && await page.locator('.gprice').count() === 11, 'price rows');
    const prices = (await page.locator('.gprice').allTextContents()).map(p => Number(p.replace(/[^\d.]/g, '')));
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
    await page.locator('.filter-action').click(); await page.getByRole('dialog').waitFor();
    assert(await page.locator('.popup-close').evaluate(e => e === document.activeElement));
    await page.getByRole('dialog').getByRole('button', { name: /^Laptops/ }).click(); await shot(page, 'filters');
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await until(() => new URL(page.url()).searchParams.get('category') === 'laptop', 'category query'); await dismissed(page);
    await until(async () => await page.locator('.gcard').count() === 2, 'laptop rows');
    await page.goBack(); await until(() => !new URL(page.url()).searchParams.has('category'), 'Back undo category');
    assert.equal(new URL(page.url()).searchParams.get('sort'), 'price');
    await page.goBack(); await until(() => !new URL(page.url()).searchParams.has('sort'), 'Back undo sort'); await page.locator('.dealhero').waitFor();
    await ctx.close();
  });
  await check('Closed popup Forward entries do not add an invisible app Back stop', async () => {
    const { ctx, page } = await context(); await ready(page); await page.locator('.dealhero').click(); await page.locator('.verdict').waitFor();
    await page.getByRole('button', { name: 'Account', exact: true }).click(); await page.getByRole('dialog').waitFor();
    await page.locator('.popup-close').click(); await dismissed(page); await page.goForward();
    await until(() => page.evaluate(() => !history.state?.filtrsoftPopup), 'orphaned popup skipped');
    await page.getByRole('button', { name: 'Back', exact: true }).click(); await page.locator('.dealhero').waitFor();
    assert.equal(new URL(page.url()).pathname, '/'); await ctx.close();
  });
  await check('Review still refreshes after a slow successful save outlives its popup', async () => {
    const { ctx, page } = await context(); let release, saved = false;
    const gate = new Promise(r => { release = r; });
    await page.route('**/v1/checks/104/override', async r => { await gate; saved = true; await r.fulfill({ json: { ok: true } }); });
    await page.route('**/v1/checks/104?*', r => { const d = detail(104); if (saved) { d.verdict.call = 'FAIR'; d.verdict.overriddenFrom = 'PASS'; d.decisionToken = 'refreshed-preview-token'; } return r.fulfill({ json: d }); });
    await page.goto(base + '/c/104'); await page.locator('.verdict').waitFor();
    await page.getByRole('button', { name: 'Review this listing' }).click(); await shot(page, 'review');
    await page.locator('.call-choice.b-FAIR').click(); await page.locator('.popup-close').click(); await dismissed(page);
    release(); await page.getByRole('button', { name: 'Change your label' }).waitFor();
    assert((await page.locator('.verdict .vbadge').textContent()).includes('Fair')); await ctx.close();
  });
  await check('Review failure remains recoverable and closing without choosing sends no review', async () => {
    const { ctx, page } = await context(); let calls = 0;
    await page.route('**/v1/checks/105/override', r => { calls++; return r.fulfill({ status: 503, json: { error: 'temporary' } }); });
    await page.goto(base + '/c/105'); await page.locator('.verdict').waitFor();
    await page.getByRole('button', { name: 'Review this listing' }).click(); await page.locator('.popup-close').click(); await dismissed(page); assert.equal(calls, 0);
    await page.getByRole('button', { name: 'Review this listing' }).click(); await page.locator('.call-choice.b-FAIR').click();
    await page.getByRole('dialog').getByRole('alert').waitFor(); assert.equal(await page.locator('.call-choice.b-FAIR').isDisabled(), false);
    assert.equal(calls, 1); await ctx.close();
  });
  await check('OS and app reduced motion disable popup animation; landscape and large text remain usable', async () => {
    for (const mode of ['normal', 'os', 'app']) {
      const { ctx, page } = await context(390, 844, { reduceMotion: mode === 'app' });
      if (mode === 'os') await page.emulateMedia({ reducedMotion: 'reduce' });
      await ready(page); await page.getByRole('button', { name: 'More', exact: true }).click(); await page.getByRole('dialog').waitFor();
      const animation = await page.locator('.popup-panel').evaluate(e => getComputedStyle(e).animationName);
      assert.equal(animation === 'none', mode !== 'normal');
      await page.locator('.popup-close').click(); await dismissed(page);
      await page.setViewportSize({ width: 844, height: 390 });
      await page.getByRole('button', { name: 'Account', exact: true }).click(); await page.getByRole('dialog').waitFor();
      await settled(page);
      await page.getByRole('dialog').getByRole('button', { name: /How Filtrsoft works/ }).scrollIntoViewIfNeeded();
      const item = await page.getByRole('dialog').getByRole('button', { name: /How Filtrsoft works/ }).boundingBox();
      assert(item.y >= 0 && item.y + item.height < 391);
      await page.locator('.popup-close').click(); await dismissed(page);
      await page.setViewportSize({ width: 360, height: 844 });
      await page.addStyleTag({ content: '.quick-row b { font-size: 22px } .quick-row small { font-size: 17px } .popup-head h2 { font-size: 28px }' });
      await page.getByRole('button', { name: 'More', exact: true }).click(); await page.getByRole('dialog').waitFor();
      await settled(page);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.getByRole('dialog').getByRole('button', { name: /All options/ }).scrollIntoViewIfNeeded();
      const last = await page.getByRole('dialog').getByRole('button', { name: /All options/ }).boundingBox(); assert(last.y + last.height <= 844);
      await ctx.close();
    }
  });
  await check('Quick menus and Back select the intended Saved tab even when Saved is already open', async () => {
    const { ctx, page } = await context(); await page.goto(base + '/saved'); await page.getByRole('tab', { name: /^Listings/ }).waitFor();
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^Saved searches/ }).click(); await dismissed(page);
    assert.equal(await page.getByRole('tab', { name: 'Searches', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^Purchases/ }).click(); await dismissed(page);
    assert.equal(await page.getByRole('tab', { name: 'Bought', exact: true }).getAttribute('aria-selected'), 'true');
    await page.goBack(); await until(async () => await page.getByRole('tab', { name: 'Searches', exact: true }).getAttribute('aria-selected') === 'true', 'Back to alerts');
    await page.getByRole('tab', { name: /^Listings/ }).click();
    assert.equal(new URL(page.url()).search, ''); await ctx.close();
  });
} finally {
  await browser.close(); await new Promise(r => server.close(r));
  await writeFile(`${output}/checks.json`, JSON.stringify({ checkedAt: new Date().toISOString(), synthetic: true, results, measurements, errors }, null, 2) + '\n');
}
if (results.some(r => !r.pass) || errors.length) process.exitCode = 1;
