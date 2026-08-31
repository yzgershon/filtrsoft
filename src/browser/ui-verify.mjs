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
import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const LABEL = process.argv[2] ?? "run";
const BASE = process.argv[3] ?? "http://localhost:3177";
const CHROME = process.env.ASSYZE_CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = join("docs", "ui", LABEL);
/**
 * REAL DEVICE PROFILES, NOT HAND-PICKED WIDTHS.
 *
 * This used to be `[375, 390, 768, 1024, 1440]` with `isMobile: true` and a
 * DESKTOP user agent, which is Chrome resized into a phone shape rather than a
 * phone. Two things went wrong because of it:
 *
 *   · **The widths were guesses and they missed his actual device.** Yish is on
 *     a Galaxy S24, which is 360 CSS px — narrower than anything tested. The
 *     segment control clipped its last chip by 22px there while 375 and 390
 *     both looked perfect.
 *   · `isMobile` sets touch and viewport-meta handling but NOT the user agent
 *     or the device pixel ratio, so nothing under test ever saw an Android UA
 *     or a 3x screen.
 *
 * Playwright's descriptors carry viewport, DPR, UA, touch and mobile together.
 * The desktop entries stay as plain viewports because there is no "desktop"
 * descriptor and none is needed.
 */
const PHONES = ["iPhone SE", "Galaxy S24", "iPhone 14", "Pixel 7"];
/**
 * The phone every functional block runs on.
 *
 * It was a bare 375, a width no device in PHONES actually has. Yish is on a
 * Galaxy S24, so that is what the interaction tests drive; the geometry loop at
 * the bottom still sweeps all four profiles.
 */
const PHONE = "Galaxy S24";
const DESKTOPS = [768, 1024, 1440];

mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

/**
 * Settings live in localStorage, so each run starts from a known state.
 *
 * `spec` is either a device NAME from Playwright's registry (real UA, DPR,
 * viewport and touch) or a plain desktop width.
 */
async function newPage(spec, settings) {
  const opts = typeof spec === "string"
    ? { ...devices[spec] }
    : { viewport: { width: spec, height: 900 }, deviceScaleFactor: 2 };
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript((s) => {
    if (s) localStorage.setItem("assyze:settings", JSON.stringify(s));
  }, settings ?? null);
  const page = await ctx.newPage();
  return { ctx, page };
}

/**
 * ⚠ A CONTROL CAN OVERFLOW ITSELF WITHOUT THE PAGE SCROLLING, AND THAT IS THE
 * BUG THIS SUITE MISSED FOR FIVE COMMITS.
 *
 * The only overflow assertion here was `document.documentElement.scrollWidth`,
 * which is a PAGE-level measure. The segment control's chips were clipped 22px
 * past its right edge on a Galaxy S24 and the document reported zero overflow,
 * because the overflow was contained inside `.seg`.
 *
 * Measure the last child against its container's box. `scrollWidth` is not
 * enough either: `.seg button` is `flex: 1`, so the chips stretch to whatever
 * box they are given and `scrollWidth` tracks the container — it reads "fits"
 * at every width while the labels are visibly cut off.
 */
const clippedBy = (page, sel) => page.evaluate((s) => {
  const box = document.querySelector(s);
  if (!box) return null;
  let worst = 0;
  const b = box.getBoundingClientRect();
  for (const c of box.children) {
    const r = c.getBoundingClientRect();
    /**
     * SKIP WHAT IS NOT RENDERED, AND SKIP WHAT IS NOT IN FLOW.
     *
     * A `display: none` child reports a rect of all zeros, so a container that
     * does not start at x=0 reads as clipping it by exactly its own left
     * offset. That is how a perfectly fine 768px top bar reported "104px past
     * the edge": the hidden desktop nav sat at 0 while the centred shell
     * started at 104. Absolutely-positioned children (the sliding indicator)
     * are out of flow and cannot overflow anything either.
     */
    if (r.width === 0 && r.height === 0) continue;
    if (getComputedStyle(c).position === "absolute") continue;
    worst = Math.max(worst, Math.round(r.right - b.right), Math.round(b.left - r.left));
  }
  return worst;
}, sel);

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
  const { ctx, page } = await newPage(PHONE);
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
  const { ctx, page } = await newPage(PHONE);
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
  const { ctx, page } = await newPage(PHONE);
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
  const { ctx, page } = await newPage(PHONE);
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
  const a = await newPage(PHONE, { driveMinutes: 15, hideGone: true, reduceMotion: false, askOutcomes: true });
  const aReqs = [];
  a.page.on("request", (r) => { if (r.url().includes("/v1/feed")) aReqs.push(r.url()); });
  await a.page.goto(BASE, { waitUntil: "networkidle" });
  await a.page.waitForSelector(".grid .gcard, .dealhero", { timeout: 20000 });
  ok("hideGone on does NOT ask for delisted rows", !aReqs.some((u) => u.includes("gone=1")), aReqs[0] ?? "none");
  const hidden = await a.page.evaluate(
    () => fetch("/v1/feed?limit=1&quality=all").then((r) => r.json()).then((d) => d.total));
  await a.ctx.close();

  const b = await newPage(PHONE, { driveMinutes: 15, hideGone: false, reduceMotion: false, askOutcomes: true });
  const bReqs = [];
  b.page.on("request", (r) => { if (r.url().includes("/v1/feed")) bReqs.push(r.url()); });
  await b.page.goto(BASE, { waitUntil: "networkidle" });
  await b.page.waitForSelector(".grid .gcard, .dealhero", { timeout: 20000 });
  ok("hideGone off asks the server for delisted rows", bReqs.some((u) => u.includes("gone=1")), bReqs[0] ?? "none");
  const shown = await b.page.evaluate(
    () => fetch("/v1/feed?limit=1&quality=all&gone=1").then((r) => r.json()).then((d) => d.total));
  ok("delisted rows are a real difference", shown > hidden, `${hidden} hidden · ${shown} shown`);
  await b.ctx.close();

  const c = await newPage(PHONE, { driveMinutes: 90, hideGone: true, reduceMotion: false, askOutcomes: true });
  const checks = [];
  c.page.on("request", (r) => { if (/\/v1\/checks\/\d+/.test(r.url())) checks.push(r.url()); });
  await c.page.goto(BASE, { waitUntil: "networkidle" });
  await c.page.waitForSelector(".grid .gcard, .dealhero", { timeout: 20000 });
  await c.page.locator(".grid .gcard .gopen, .dealhero").first().click();
  await c.page.waitForTimeout(1800);
  ok("the detail carries the drive time", checks.some((u) => u.includes("drive=90")), checks[0] ?? "none");
  await c.ctx.close();
}

// ───────────────────────────────────────── 6. contrast, targets, semantics
/**
 * Everything in this block is a NUMBER the audit named, measured off the
 * running app. Contrast and hit area are exactly the kind of thing that looks
 * fine in a screenshot on a bright monitor and is unreadable in a driveway.
 */
{
  console.log("\naccessibility");
  const { ctx, page } = await newPage(PHONE);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".grid .gcard, .dealhero", { timeout: 20000 });

  /** WCAG relative luminance → contrast ratio, computed in the page. */
  await page.addScriptTag({
    content: `window.__ratio = (fg, bg) => {
      const lum = (c) => {
        const [r, g, b] = c.match(/[\\d.]+/g).slice(0, 3).map(Number).map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const a = lum(fg), b2 = lum(bg);
      return (Math.max(a, b2) + 0.05) / (Math.min(a, b2) + 0.05);
    };`,
  });

  const contrast = await page.evaluate(() => {
    /**
     * ⚠ A TRANSLUCENT BACKGROUND MUST BE COMPOSITED, NOT TREATED AS OPAQUE.
     *
     * The first version returned the first non-transparent ancestor colour,
     * and an ancestor painting `rgba(255,255,255,.09)` was read as WHITE — so
     * a perfectly legible label measured 1.99:1 and reported as a failure. A
     * checker that cries wolf is worse than none.
     *
     * Walk outwards blending each layer over the next until one is opaque.
     */
    const parse = (c) => {
      const n = (c.match(/[\d.]+/g) || []).map(Number);
      return { r: n[0] || 0, g: n[1] || 0, b: n[2] || 0, a: n.length > 3 ? n[3] : 1 };
    };
    const bgOf = (el) => {
      const layers = [];
      for (let n = el.parentElement; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c.a === 0) continue;
        layers.push(c);
        if (c.a === 1) break;
      }
      let out = layers.pop() || { r: 8, g: 7, b: 10, a: 1 };
      while (layers.length) {
        const top = layers.pop();
        out = {
          r: top.r * top.a + out.r * (1 - top.a),
          g: top.g * top.a + out.g * (1 - top.a),
          b: top.b * top.a + out.b * (1 - top.a),
          a: 1,
        };
      }
      return `rgb(${out.r}, ${out.g}, ${out.b})`;
    };
    const out = [];
    for (const sel of [".gloc", ".tab .tl", ".sect span", ".sec h4", ".dloc"]) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      out.push({
        sel,
        size: Math.round(parseFloat(cs.fontSize) * 10) / 10,
        ratio: Math.round(window.__ratio(cs.color, bgOf(el)) * 100) / 100,
      });
    }
    return out;
  });
  for (const c of contrast) {
    ok(`${c.sel} clears 4.5:1`, c.ratio >= 4.5, `${c.ratio}:1 at ${c.size}px`);
    ok(`${c.sel} is 11px+`, c.size >= 11, `${c.size}px`);
  }

  /**
   * ⚠ MEASURE THE BUTTON, NOT THE CIRCLE. The bookmark draws a 30px circle
   * inside a 44px target on purpose — a 44px circle would be a dinner plate
   * over the photo.
   */
  const targets = await page.evaluate(() => {
    const out = [];
    for (const sel of [".gsave", ".tab", ".seg button", ".brand"]) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        out.push({ sel, w: Math.round(r.width), h: Math.round(r.height) });
        break;
      }
    }
    return out;
  });
  for (const t of targets) {
    ok(`${t.sel} is a 44px target`, t.w >= 44 && t.h >= 44, `${t.w} x ${t.h}`);
  }

  /**
   * `aria-label="Open {title}"` REPLACED the card's contents as its accessible
   * name, so the price, verdict, profit and location — the entire reason the
   * card exists — were never announced.
   */
  const card = await page.evaluate(() => {
    const btn = document.querySelector(".grid .gcard .gopen");
    if (!btn) return null;
    const id = btn.getAttribute("aria-describedby");
    const d = id && document.getElementById(id);
    return { label: btn.getAttribute("aria-label"), desc: d ? d.textContent : null };
  });
  ok("a card has an accessible description", !!card?.desc, card?.desc?.slice(0, 60) ?? "none");
  ok("the description carries the price", /\$\d/.test(card?.desc ?? ""));
  ok("the description carries the verdict", /BUY|VERIFY|RISK|PASS|FAIR|CAN'T TELL/i.test(card?.desc ?? ""));

  // One H1 per screen, and it has to exist.
  for (const [path, expect] of [["/", 1], ["/check", 1], ["/saved", 1], ["/settings", 1]]) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const h1s = await page.locator("h1").count();
    ok(`${path} has exactly one H1`, h1s === expect, `${h1s}`);
  }
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".grid .gcard, .dealhero", { timeout: 20000 });
  await page.locator(".grid .gcard .gopen, .dealhero").first().click();
  await page.waitForTimeout(1800);
  ok("a detail has exactly one H1", (await page.locator("h1").count()) === 1);
  await ctx.close();
}

// ───────────────────────────────────────────── 7. keyboard and feedback
{
  console.log("\nkeyboard and feedback");
  const { ctx, page } = await newPage(1024);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".grid .gcard, .dealhero", { timeout: 20000 });

  /**
   * ⚠ ARROWING A RADIOGROUP LEFT FOCUS BEHIND. The checked option moved and
   * DOM focus did not, so focus sat on an element whose tabIndex had just
   * become -1: the next Tab left the group entirely.
   */
  await page.locator(".seg button[aria-checked='true']").focus();
  const before = await page.evaluate(() => document.activeElement?.dataset?.opt);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(600);
  const state = await page.evaluate(() => ({
    focused: document.activeElement?.dataset?.opt,
    checked: document.querySelector(".seg button[aria-checked='true']")?.dataset?.opt,
  }));
  ok("arrowing moves the selection", state.checked !== before, `${before} -> ${state.checked}`);
  ok("focus follows the selection", state.focused === state.checked,
    `focus ${state.focused} · checked ${state.checked}`);

  /**
   * Saving toasts, and the toast is announced rather than only drawn.
   *
   * BACK TO THE UNFILTERED FEED FIRST, and take EITHER bookmark. The arrow-key
   * test above leaves the segment on "Ready", and this assertion used to click
   * `.grid .gcard .gsave` from there — which passed locally where Ready had 3
   * rows and hung for 30s against production, where Ready has exactly ONE and
   * that one is promoted into the hero. A checker whose result depends on how
   * many deals happen to exist today is not checking the app.
   */
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".grid .gcard, .dealhero", { timeout: 20000 });
  const bookmark = page.locator(".gsave").first();
  await bookmark.click();
  await page.waitForTimeout(400);
  const t = await page.evaluate(() => {
    const el = document.querySelector(".toasts");
    return el ? { live: el.getAttribute("aria-live"), text: el.innerText.trim() } : null;
  });
  ok("saving shows a toast", !!t?.text, t?.text ?? "none");
  ok("the toast is announced", t?.live === "polite", String(t?.live));
  await bookmark.click();

  /**
   * The photo dialog opened with focus still on the button UNDERNEATH it, and
   * closing dropped focus on the document.
   */
  await page.locator(".grid .gcard .gopen, .dealhero").first().click();
  await page.waitForTimeout(1900);
  const shots = await page.locator(".galshot").count();
  if (shots) {
    await page.locator(".galshot").first().click();
    await page.waitForTimeout(500);
    ok("the dialog takes focus on open",
      await page.evaluate(() => !!document.activeElement?.closest?.(".lbx")),
      await page.evaluate(() => document.activeElement?.className ?? "?"));
    ok("the dialog names which photo",
      /Photo \d+ of \d+/.test(await page.locator(".lbx").getAttribute("aria-label") ?? ""),
      (await page.locator(".lbx").getAttribute("aria-label")) ?? "none");

    // Tab must not escape the dialog.
    for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
    ok("Tab is trapped inside the dialog",
      await page.evaluate(() => !!document.activeElement?.closest?.(".lbx")));

    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    ok("Escape closes it", (await page.locator(".lbx").count()) === 0);
    ok("focus returns to the photo that opened it",
      await page.evaluate(() => !!document.activeElement?.classList?.contains("galshot")),
      await page.evaluate(() => document.activeElement?.className ?? "?"));
  } else {
    console.log("  \x1b[90mskip\x1b[0m dialog — this listing has no photos");
  }
  await ctx.close();
}

// ─────────────────────────────────────── 8. a failed feed is not an empty feed
{
  console.log("\nfailure states");
  const { ctx, page } = await newPage(PHONE);
  // Kill the feed request only. Everything else loads, so this is the network
  // failing under a working app — the case that used to read "Nothing here yet".
  await page.route("**/v1/feed*", (r) => r.abort());
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const body = await page.locator("body").innerText();
  ok("a dropped feed does NOT claim there are no deals", !/nothing here yet/i.test(body));
  ok("it says the request failed", /couldn't load|no connection/i.test(body), body.slice(0, 80).replace(/\n/g, " "));
  const retry = page.getByRole("button", { name: /try again/i });
  ok("it offers a retry", (await retry.count()) > 0);

  // Let it through and press the retry: the feed must actually come back.
  await page.unroute("**/v1/feed*");
  if (await retry.count()) {
    await retry.first().click();
    await page.waitForTimeout(2500);
    ok("retry recovers the feed", (await page.locator(".grid .gcard, .dealhero").count()) > 0);
  }
  await ctx.close();
}

// ────────────────────────────────────────────────── 9. discovery filters
{
  console.log("\ndiscovery");
  const { ctx, page } = await newPage(PHONE);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".grid .gcard, .dealhero", { timeout: 20000 });

  ok("cards name their source",
    /craigslist|facebook|offerup|mercari/i.test(await page.locator(".gloc").first().innerText()),
    (await page.locator(".gloc").first().innerText()).replace(/\n/g, " "));

  ok("the hero can be saved", (await page.locator(".herosave").count()) > 0);

  // The sheet is a real dialog, same rules as the lightbox.
  await page.locator(".filtbtn").click();
  await page.waitForTimeout(500);
  ok("the filter sheet opens", (await page.locator(".sheet").count()) === 1);
  ok("it takes focus", await page.evaluate(() => !!document.activeElement?.closest?.(".sheet")));
  for (let i = 0; i < 10; i++) await page.keyboard.press("Tab");
  ok("Tab is trapped in the sheet", await page.evaluate(() => !!document.activeElement?.closest?.(".sheet")));

  await page.locator(".fld input").first().fill("rtx");
  await page.locator(".sheetfoot .cta").click();
  await page.waitForTimeout(1400);

  /**
   * ⚠ THE FILTER MUST REACH THE URL, THE SERVER AND THE COUNTS.
   *
   * Held in component state it is lost on every refresh and on every trip into
   * a listing and back; computed against the unfiltered population the chips
   * print numbers the search cannot reach.
   */
  ok("the search reaches the URL", page.url().includes("q=rtx"), page.url().replace(BASE, ""));
  const chip = await page.locator(".qbar button, .seg button").last().innerText();
  const claimed = Number(chip.match(/(\d+)\s*$/)?.[1] ?? NaN);
  const total = await page.evaluate(() =>
    fetch(location.search ? `/v1/feed?limit=1&quality=all&q=rtx` : "/v1/feed?limit=1").then((r) => r.json()).then((d) => d.total));
  ok("the segment count reflects the search", claimed === total, `chip ${claimed} · server ${total}`);
  ok("an active filter is shown with a way out", (await page.locator(".apill").count()) > 0);

  const titles = await page.locator(".grid .gcard b, .dealhero b").allInnerTexts();
  ok("every result matches the search", titles.every((t) => /rtx/i.test(t)),
    titles.length ? `${titles.length} rows` : "no rows");

  // A refresh must restore it; that is the whole reason it is in the URL.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  ok("a refresh restores the search", (await page.locator(".apill").count()) > 0);

  // Back must undo the search rather than leaving the feed.
  await page.goBack();
  await page.waitForTimeout(1200);
  ok("Back undoes the search", !page.url().includes("q=rtx"), page.url().replace(BASE, ""));

  // Clearing from the pill.
  await page.goto(`${BASE}/?q=rtx&category=gpu`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  ok("two filters show two pills", (await page.locator(".apill:not(.clear)").count()) === 2);
  await page.locator(".apill.clear").click();
  await page.waitForTimeout(1200);
  ok("Clear all removes them", (await page.locator(".apill").count()) === 0);
  await ctx.close();
}

// ────────────────────────────── 10. comp transparency and the offer sandbox
{
  console.log("\ncomps and offers");
  const { ctx, page } = await newPage(PHONE);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".grid .gcard, .dealhero", { timeout: 20000 });
  await page.locator(".grid .gcard .gopen, .dealhero").first().click();
  await page.waitForTimeout(2200);

  const slide = page.locator(".offerslide");
  if (await slide.count()) {
    const before = await page.locator(".offerout").innerText();
    // Drag the slider down and the net must fall with it.
    await slide.evaluate((el) => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(el, String(Number(el.min) + (Number(el.max) - Number(el.min)) * 0.1));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(500);
    const after = await page.locator(".offerout").innerText();
    ok("the offer slider recomputes the net", before !== after,
      `${before.replace(/\n/g, " ").slice(0, 40)} -> ${after.replace(/\n/g, " ").slice(0, 40)}`);
    ok("the result is announced", (await page.locator(".offerout").getAttribute("aria-live")) === "polite");
  } else {
    console.log("  \x1b[90mskip\x1b[0m offer slider — this listing has no priced channel");
  }

  const disc = page.locator(".disclose");
  if (await disc.count()) {
    ok("comps start collapsed", (await disc.getAttribute("aria-expanded")) === "false");
    await disc.click();
    await page.waitForTimeout(400);
    ok("comps open on demand", (await page.locator(".comp").count()) > 0,
      `${await page.locator(".comp").count()} rows`);
    ok("each comp names a price", /\$[\d,]+/.test(await page.locator(".cprice").first().innerText()));
  } else {
    console.log("  \x1b[90mskip\x1b[0m comps — this listing has no matched SKU");
  }
  await ctx.close();
}

// ────────────────────────────── 11. every real device, every screen
console.log("\nscreens");
for (const spec of [...PHONES, ...DESKTOPS]) {
  const { ctx, page } = await newPage(spec);
  const label = String(spec).replace(/\s+/g, '-');
  for (const [path, name] of [["/", "deals"], ["/check", "check"], ["/saved", "saved"], ["/settings", "settings"]]) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(1100);
    await shot(page, `${label}-${name}`);
  }
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".grid .gcard, .dealhero", { timeout: 20000 });

  // The real CSS width, whatever the descriptor calls the device.
  const w = await page.evaluate(() => window.innerWidth);
  const dpr = await page.evaluate(() => window.devicePixelRatio);

  /**
   * NO CONTROL MAY CLIP ITS OWN CHILDREN. This is the assertion that was
   * missing for five commits: page-level overflow read zero on every
   * device while the segment control cut its last chip off, because the
   * overflow lived inside `.seg` and the document never scrolled.
   */
  for (const sel of [".seg", ".topbar", ".tabbar"]) {
    const over = await clippedBy(page, sel);
    if (over === null) continue;
    ok(`${label}: ${sel} does not clip its children`, over <= 1, `${over}px past the edge`);
  }

  /**
   * Four-digit counts must not break it either; today's numbers are luck.
   *
   * A 320px screen genuinely cannot fit four labelled chips with four-digit
   * counts, so the pass condition is NOT "it fits" — it is "nothing becomes
   * unreachable". Overflow must be SCROLLABLE rather than clipped.
   */
  await page.evaluate(() => document.querySelectorAll(".segn").forEach((n) => { n.textContent = "1204"; }));
  await page.waitForTimeout(250);
  const stress = await page.evaluate(() => {
    const el = document.querySelector(".seg");
    const cs = getComputedStyle(el);
    return {
      over: el.scrollWidth > el.clientWidth + 1,
      scrollable: /auto|scroll/.test(cs.overflowX),
      reach: el.scrollWidth - el.clientWidth,
    };
  });
  ok(`${label}: 4-digit counts stay reachable`,
    !stress.over || stress.scrollable,
    stress.over ? `overflows ${stress.reach}px, scrollable=${stress.scrollable}` : "fits outright");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".grid .gcard, .dealhero", { timeout: 20000 });

  /**
   * ⚠ THE COLUMN COUNT IS MEASURED HERE, ON THE FEED, BEFORE OPENING ANYTHING.
   *
   * The detail has no `.grid`, so measuring it after the click reported "0
   * columns" at every width — a passing layout reading as a broken one.
   */
  const cols = await page.evaluate(() => {
    const g = document.querySelector(".grid");
    return g ? (getComputedStyle(g).gridTemplateColumns.match(/px/g) || []).length : null;
  });
  const wantCols = w >= 1024 ? 4 : w >= 520 ? 3 : 2;
  ok(`${label}: the feed grid is ${wantCols} columns`, cols === wantCols, `${cols} at ${w}px @${dpr}x`);

  await page.locator(".grid .gcard .gopen, .dealhero").first().click();
  await page.waitForTimeout(1800);
  await shot(page, `${label}-detail`);

  /**
   * The decision column has to sit BESIDE the photos and STICK. A stretched
   * grid item is as tall as its row, and `position: sticky` inside a
   * full-height box has nothing to stick within — it would simply never move,
   * which looks identical to working until you scroll.
   */
  const two = await page.evaluate(() => {
    const top = document.querySelector(".dtop");
    const side = document.querySelector(".dside");
    const gal = document.querySelector(".dtop .gal");
    if (!top || !side || !gal) return null;
    const s = side.getBoundingClientRect(), g = gal.getBoundingClientRect();
    return {
      cols: (getComputedStyle(top).gridTemplateColumns.match(/px/g) || []).length,
      sideLeft: Math.round(s.left), galRight: Math.round(g.right),
      sticky: getComputedStyle(side).position,
      align: getComputedStyle(top).alignItems,
      rowH: Math.round(top.getBoundingClientRect().height),
      sideH: Math.round(s.height), galH: Math.round(g.height),
    };
  });
  if (two) {
    if (w >= 1024) {
      ok(`${label}: the detail is two columns`, two.cols === 2, `${two.cols}`);
      ok(`${label}: the decision sits beside the photos`, two.sideLeft >= two.galRight - 2,
        `gallery ends ${two.galRight}, decision starts ${two.sideLeft}`);
      ok(`${label}: the decision column sticks`, two.sticky === "sticky", two.sticky);
      /**
       * ⚠ ASSERT `align-items: start`, NOT "the column is shorter".
       *
       * A stretched grid item is as tall as its row, and `position: sticky`
       * inside a full-height box has nothing to stick within — it never moves,
       * which looks identical to working until you scroll. That is what this
       * guards.
       *
       * Whether the decision column is the SHORTER one is a property of the
       * listing, not the layout: measured here it is the taller (837 vs a
       * 400px gallery at 1024), so sticky is inert on this listing and becomes
       * live on a listing with more photos. Demanding it be shorter would fail
       * on real content that is perfectly laid out.
       */
      ok(`${label}: neither column is force-stretched`, two.align === "start", two.align);
    } else {
      ok(`${label}: the detail is one column`, two.cols <= 1, `${two.cols}`);
    }
  }

  /**
   * ⚠ EXACTLY ONE NAV IS VISIBLE AT ANY WIDTH.
   *
   * Both render and CSS picks: the bottom bar is a phone control, the header
   * row is the desktop one. Two visible navs would be two answers to "where am
   * I"; zero would be an app you cannot leave the current screen from.
   */
  const nav = await page.evaluate(() => {
    const seen = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return null;
      const r = el.getBoundingClientRect();
      return { bottom: Math.round(r.bottom), h: Math.round(r.height), pos: cs.position };
    };
    const shell = document.querySelector(".app");
    const pad = shell ? getComputedStyle(document.querySelector(".scroll")) : null;
    return {
      tabbar: seen(".tabbar"), hnav: seen(".hnav"),
      vh: window.innerHeight,
      shellW: shell ? Math.round(shell.getBoundingClientRect().width) : 0,
      padL: pad ? Math.round(parseFloat(pad.paddingLeft)) : 0,
    };
  });
  ok(`${label}: exactly one nav is visible`, !!nav.tabbar !== !!nav.hnav,
    `tabbar ${nav.tabbar ? "on" : "off"} · header ${nav.hnav ? "on" : "off"}`);

  if (w >= 1024) {
    ok(`${label}: the shell is capped at 1180`, nav.shellW === Math.min(1180, w),
      `${nav.shellW}px`);
    ok(`${label}: gutters are ${w >= 1280 ? 32 : 24}px`, nav.padL === (w >= 1280 ? 32 : 24), `${nav.padL}px`);
    ok(`${label}: the desktop nav is in the header`, !!nav.hnav && nav.hnav.pos !== "fixed",
      nav.hnav ? nav.hnav.pos : "missing");
  } else {
    // The original bug: `position: absolute` inside a fake phone frame meant
    // reaching the bar required scrolling past 285 listings.
    ok(`${label}: the tab bar is fixed and on screen`,
      !!nav.tabbar && nav.tabbar.pos === "fixed" && nav.tabbar.bottom <= nav.vh + 2,
      nav.tabbar ? `${nav.tabbar.pos} bottom=${nav.tabbar.bottom} vh=${nav.vh}` : "missing");
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
    // Above 1024 the bottom bar is display:none, so the header is the glass.
    const el = document.querySelector(".tabbar");
    const use = el && getComputedStyle(el).display !== "none" ? el : document.querySelector(".topbar");
    return use ? getComputedStyle(use).backdropFilter : null;
  });
  if (blur !== null) ok(`${label}: the chrome blurs what is behind it`, blur !== "none", blur);

  // No horizontal scroll at any width. A 2px overflow is a broken layout.
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(`${label}: no horizontal overflow`, over <= 1, `${over}px`);
  await ctx.close();
}

await browser.close();
console.log(`\n\x1b[1mui-verify\x1b[0m  ${pass} pass · ${fail} fail  →  ${OUT}`);
process.exit(fail ? 1 : 0);
