/**
 * node src/browser/ui-verify.mjs <label> [baseUrl]
 *
 * Clicks the app and writes down what it measured.
 *
 * ── WHY A SCRIPT AND NOT A LOOK ────────────────────────────────────────────
 *
 * Two of the bugs in the 2026-08-30 audit were invisible in a screenshot. The
 * hero rendered unstyled for a week because a class was renamed on the JSX side
 * only, and the inner elements still matched, so the picture looked right. The
 * segment control said 20 while the view dead-ended at 13, which no single
 * frame shows either. **Trust the selector and the measurement, not the
 * screenshot** — the screenshots here are for the human, the assertions are
 * what actually pass or fail.
 *
 * Runs under NODE. Playwright hangs under Bun on this machine (see launch.mjs),
 * and `bun test` is where the pure logic is pinned, so the split holds: Bun
 * proves the functions, Node proves the running app.
 *
 * Widths are 375 / 768 / 1024 / 1440 — phone, tablet, small laptop, desktop.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const LABEL = process.argv[2] ?? "run";
const BASE = process.argv[3] ?? "http://localhost:3177";
const CHROME = process.env.ASSYZE_CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = join("docs", "ui", LABEL);
const WIDTHS = [375, 768, 1024, 1440];

mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

/** Settings live in localStorage, so each run starts from a known state. */
async function newPage(width, settings) {
  const ctx = await browser.newContext({
    viewport: { width, height: width < 500 ? 812 : 900 },
    deviceScaleFactor: 2,
    isMobile: width < 500,
    hasTouch: width < 500,
  });
  await ctx.addInitScript((s) => {
    if (s) localStorage.setItem("assyze:settings", JSON.stringify(s));
  }, settings ?? null);
  const page = await ctx.newPage();
  return { ctx, page };
}

const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });

/** The tab whose button is lit, read off the DOM rather than guessed. */
const litTab = (page) => page.evaluate(() => {
  const on = document.querySelector(".tabbar [aria-current='page']");
  return on ? (on.textContent || "").trim().toLowerCase() : null;
});

const detailOpen = (page) => page.evaluate(
  () => !!document.querySelector(".dtl, .detail, [data-screen='detail']"));

// ─────────────────────────────────────────────────── 1. navigation and Back
{
  console.log("\nnavigation");
  const { ctx, page } = await newPage(375);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".grid .gcard, .dealhero, .empty", { timeout: 20000 });

  ok("deals lights the Deals tab", (await litTab(page))?.includes("deals"));

  const cards = await page.locator(".grid .gcard, .dealhero").count();
  ok("the feed renders cards", cards > 0, `${cards} on page 1`);

  await page.locator(".grid .gcard .gopen, .dealhero").first().click();
  await page.waitForURL(/\/c\/\d+/, { timeout: 10000 });
  await page.waitForTimeout(1200);
  ok("a card opens its detail", /\/c\/\d+/.test(page.url()), page.url().replace(BASE, ""));
  ok("detail lights NO tab", (await litTab(page)) === null, String(await litTab(page)));

  await page.goBack();
  await page.waitForTimeout(800);
  /**
   * ⚠ THE BUG THIS PINS: Back changed the URL to `/` and left the detail on
   * screen, with the bottom bar lighting Check. Both halves are asserted.
   */
  ok("Back returns to the feed URL", new URL(page.url()).pathname === "/", page.url().replace(BASE, ""));
  ok("Back tears the detail DOWN", !(await detailOpen(page)));
  ok("Back re-lights Deals", (await litTab(page))?.includes("deals"));

  for (const [path, tab] of [["/check", "check"], ["/saved", "saved"]]) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    ok(`a refresh on ${path} stays on ${path}`, new URL(page.url()).pathname === path);
    ok(`${path} lights ${tab}`, (await litTab(page))?.includes(tab));
  }

  await page.goto(BASE + "/settings", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  ok("a refresh on /settings stays there", new URL(page.url()).pathname === "/settings");
  await ctx.close();
}

// ───────────────────────────────────────────── 2. the segment control counts
{
  console.log("\nsegments");
  const { ctx, page } = await newPage(375);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".grid .gcard, .dealhero", { timeout: 20000 });

  const chips = page.locator(".qbar button, .segbar button, [role='radiogroup'] button");
  const n = await chips.count();
  ok("the segment control renders", n >= 4, `${n} chips`);

  for (let i = 0; i < n; i++) {
    const label = ((await chips.nth(i).textContent()) ?? "").trim().replace(/\s+/g, " ");
    const claimed = Number(label.match(/(\d+)\s*$/)?.[1] ?? NaN);
    await chips.nth(i).click();
    await page.waitForTimeout(900);

    // Page until the app stops offering more, then count what is on screen.
    for (let guard = 0; guard < 12; guard++) {
      const more = page.getByRole("button", { name: /show more|more listings/i });
      if (!(await more.count()) || !(await more.first().isVisible())) break;
      await more.first().click();
      await page.waitForTimeout(700);
    }
    const reachable = await page.locator(".grid .gcard, .dealhero").count();
    /**
     * ⚠ THIS IS THE 20-VS-13 ASSERTION. The number on the chip must equal the
     * number of listings you can actually reach by pressing things.
     */
    if (Number.isFinite(claimed)) {
      ok(`"${label}" is reachable`, claimed === reachable, `chip ${claimed} · reached ${reachable}`);
    }
  }
  await ctx.close();
}

// ─────────────────────────────────────────────────── 3. Saved and its subtabs
{
  console.log("\nsaved");
  const { ctx, page } = await newPage(375);
  await page.goto(BASE + "/saved", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  ok("Saved always has an H1", ((await page.locator("h1").first().textContent()) ?? "").trim() === "Saved");

  const subs = page.locator(".subtabs button");
  ok("Saved has Listings/Alerts sub-tabs", (await subs.count()) === 2);
  ok("Listings is selected first", (await subs.nth(0).getAttribute("aria-selected")) === "true");

  if (await page.locator(".empty").count()) {
    ok("the empty state offers a way out", (await page.locator(".empty button").count()) > 0);
  }
  await shot(page, "375-saved-listings");

  await subs.nth(1).click();
  await page.waitForTimeout(800);
  ok("Alerts sub-tab selects", (await subs.nth(1).getAttribute("aria-selected")) === "true");
  ok("Alerts renders something", (await page.locator(".sec").first().innerText()).length > 40);
  await shot(page, "375-saved-alerts");

  await subs.nth(0).click();
  await page.waitForTimeout(500);
  ok("Listings sub-tab selects back", (await subs.nth(0).getAttribute("aria-selected")) === "true");

  // 44px is the audit's touch-target floor; measured, not assumed.
  const heights = await page.locator(".subtabs button").evaluateAll(
    (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  ok("sub-tabs are 44px+", heights.every((h) => h >= 44), heights.join(" / "));
  await ctx.close();
}

// ───────────────────────────────────────────── 4. settings do what they say
{
  console.log("\nsettings");
  const { ctx, page } = await newPage(375);
  await page.goto(BASE + "/settings", { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  const text = await page.locator("body").innerText();
  ok("Alerts is NOT in Settings", !/saved search|alert me/i.test(text));
  ok("no billing card while billing is off", !/upgrade|\$\d+\s*\/\s*mo/i.test(text));
  ok("no future-tense promises", !/is coming|coming soon/i.test(text));
  await shot(page, "375-settings");

  // Drive time: the stepper must move the number AND persist it.
  const num = page.locator(".stepper .num").first();
  const before = ((await num.textContent()) ?? "").trim();
  await page.locator("[aria-label='More driving time']").first().click();
  await page.waitForTimeout(200);
  await page.locator("[aria-label='More driving time']").first().click();
  await page.waitForTimeout(400);
  const after = ((await num.textContent()) ?? "").trim();
  ok("the drive stepper moves", before !== after, `${before} -> ${after}`);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("assyze:settings") || "{}"));
  ok("the drive setting persists", stored.driveMinutes === Number(after.replace("m", "")), JSON.stringify(stored));

  // Reduce motion: the class is the mechanism, so assert the class.
  const motionRow = page.locator(".srow", { hasText: /motion/i }).first();
  if (await motionRow.count()) {
    await motionRow.click();
    await page.waitForTimeout(400);
    const applied = await page.evaluate(() => document.documentElement.classList.contains("no-motion"));
    ok("reduce motion applies .no-motion", applied);
  }
  await ctx.close();
}

// ──────────────────── 5. hideGone and drive reach the SERVER, not just storage
{
  console.log("\nsettings reach the server");
  const a = await newPage(375, { driveMinutes: 15, hideGone: true, reduceMotion: false, askOutcomes: true });
  const aReqs = [];
  a.page.on("request", (r) => { if (r.url().includes("/v1/feed")) aReqs.push(r.url()); });
  await a.page.goto(BASE, { waitUntil: "networkidle" });
  await a.page.waitForSelector(".grid .gcard, .dealhero", { timeout: 20000 });
  ok("hideGone on does NOT ask for delisted rows", !aReqs.some((u) => u.includes("gone=1")), aReqs[0] ?? "none");
  const hidden = await a.page.evaluate(
    () => fetch("/v1/feed?limit=1&quality=all").then((r) => r.json()).then((d) => d.total));
  await a.ctx.close();

  const b = await newPage(375, { driveMinutes: 15, hideGone: false, reduceMotion: false, askOutcomes: true });
  const bReqs = [];
  b.page.on("request", (r) => { if (r.url().includes("/v1/feed")) bReqs.push(r.url()); });
  await b.page.goto(BASE, { waitUntil: "networkidle" });
  await b.page.waitForSelector(".grid .gcard, .dealhero", { timeout: 20000 });
  ok("hideGone off asks the server for delisted rows", bReqs.some((u) => u.includes("gone=1")), bReqs[0] ?? "none");
  const shown = await b.page.evaluate(
    () => fetch("/v1/feed?limit=1&quality=all&gone=1").then((r) => r.json()).then((d) => d.total));
  ok("delisted rows are a real difference", shown > hidden, `${hidden} hidden · ${shown} shown`);
  await b.ctx.close();

  const c = await newPage(375, { driveMinutes: 90, hideGone: true, reduceMotion: false, askOutcomes: true });
  const checks = [];
  c.page.on("request", (r) => { if (/\/v1\/checks\/\d+/.test(r.url())) checks.push(r.url()); });
  await c.page.goto(BASE, { waitUntil: "networkidle" });
  await c.page.waitForSelector(".grid .gcard, .dealhero", { timeout: 20000 });
  await c.page.locator(".grid .gcard .gopen, .dealhero").first().click();
  await c.page.waitForTimeout(1800);
  ok("the detail carries the drive time", checks.some((u) => u.includes("drive=90")), checks[0] ?? "none");
  await c.ctx.close();
}

// ────────────────────────────────────────────── 6. every width, every screen
console.log("\nscreens");
for (const w of WIDTHS) {
  const { ctx, page } = await newPage(w);
  for (const [path, name] of [["/", "deals"], ["/check", "check"], ["/saved", "saved"], ["/settings", "settings"]]) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(1100);
    await shot(page, `${w}-${name}`);
  }
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".grid .gcard, .dealhero", { timeout: 20000 });
  await page.locator(".grid .gcard .gopen, .dealhero").first().click();
  await page.waitForTimeout(1800);
  await shot(page, `${w}-detail`);

  /**
   * The bottom bar must be ON SCREEN, not at the end of the scroll content.
   * That was the original bug: `position: absolute` inside a fake phone frame
   * meant reaching it required scrolling past 285 listings.
   */
  const bar = await page.evaluate(() => {
    const el = document.querySelector(".tabbar");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      bottom: Math.round(r.bottom), h: Math.round(r.height), vh: window.innerHeight,
      pos: getComputedStyle(el).position,
    };
  });
  if (bar) {
    ok(`${w}px: the tab bar is on screen`, bar.pos === "fixed" && bar.bottom <= bar.vh + 2,
      `${bar.pos} bottom=${bar.bottom} vh=${bar.vh} h=${bar.h}`);
  }

  /**
   * ⚠ THE BAR MUST ACTUALLY BLUR, not merely declare that it does.
   *
   * Chrome does not support `-webkit-backdrop-filter`, and the minifier
   * collapsed the standard property into that alias — so the bar shipped as an
   * 86%-opacity wash with product titles reading straight through the tab
   * labels. The SOURCE looked correct the whole time, which is exactly why this
   * is asserted against the computed style of the running app.
   */
  const blur = await page.evaluate(() => {
    const el = document.querySelector(".tabbar");
    return el ? getComputedStyle(el).backdropFilter : null;
  });
  if (blur !== null) ok(`${w}px: the tab bar blurs what is behind it`, blur !== "none", blur);

  // No horizontal scroll at any width. A 2px overflow is a broken layout.
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(`${w}px: no horizontal overflow`, over <= 1, `${over}px`);
  await ctx.close();
}

await browser.close();
console.log(`\n\x1b[1mui-verify\x1b[0m  ${pass} pass · ${fail} fail  →  ${OUT}`);
process.exit(fail ? 1 : 0);
