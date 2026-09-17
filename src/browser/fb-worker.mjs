import {acquireProfileLease} from "./profile-lease.mjs";
/**
 * Facebook Marketplace browser worker. **RUNS UNDER NODE, NOT BUN.**
 *
 * WHY A SEPARATE PROCESS: Playwright hangs under Bun on this machine — measured
 * 2026-08-24, `chromium.launch()` never resolves, while the identical script
 * under Node 24 launches Chrome in about three seconds. The rest of Filtrsoft is
 * Bun (it uses `bun:sqlite`, which Node cannot load), so the two cannot simply
 * swap. They split instead: Node drives the browser, Bun owns the database.
 *
 * WHY PLAIN .mjs: Node's TypeScript stripping does not extend to the rest of the
 * project's imports, and this file must not import anything from `src/` anyway —
 * the moment it does, it needs `bun:sqlite` and stops running.
 *
 * THIS FILE IS DELIBERATELY DUMB. It drives the browser and emits RAW text. All
 * parsing lives in `src/sources/facebook.ts`, in TypeScript, next to the rest of
 * the code and testable without a browser. A parser change must never require
 * launching Chrome to verify.
 *
 * Protocol: newline-delimited JSON on stdout.
 *   {"type":"log","msg":...}
 *   {"type":"cards","cards":[{href,text,img}]}
 *   {"type":"detail","url":...,"title":...,"bodyLines":[...],"photos":[...]}
 *   {"type":"graphql","body":...}
 *   {"type":"error","msg":...}
 *   {"type":"done","stats":{...}}
 */
import { chromium } from "playwright-core";
import { mkdirSync, existsSync } from "node:fs";
import readline from "node:readline";

const [, , command, optsJson] = process.argv;
const opts = JSON.parse(optsJson ?? "{}");

const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const log = (msg) => emit({ type: "log", msg });

// Seeded jitter. A constant delay between actions is itself a fingerprint.
let seed = Date.now() % 2147483647;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pause = (a = 800, b = 2200) => new Promise((r) => setTimeout(r, a + (b - a) * rnd()));

if (!existsSync(opts.chromePath)) {
  emit({ type: "error", msg: `Chrome not found at ${opts.chromePath}` });
  process.exit(1);
}
mkdirSync(opts.profileDir, { recursive: true });

/**
 * A persistent context IS the browser. Yish signs in once by hand and the
 * session lives in this profile on disk — there is no credential handling
 * anywhere in Filtrsoft, and there must never be.
 */
const releaseProfile=acquireProfileLease(opts.profileDir);
const ctx = await chromium.launchPersistentContext(opts.profileDir, {
  timeout:60_000,
  executablePath: opts.chromePath,
  headless: opts.headless ?? false,
  viewport: { width: 1280, height: 900 },
  locale: "en-US",
  timezoneId: "America/New_York",
  args: [
    // Drops the "controlled by automated software" banner and the matching
    // navigator.webdriver tell.
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check",
    /**
     * ⚠ HEADED BUT OFF-SCREEN. Same rule as `launch.mjs`: a real window is
     * needed, a visible one is not, and Yish uses this machine. `fb:login`
     * passes `background: false` because a sign-in he cannot see is a sign-in
     * he cannot complete.
     */
    ...((opts.background ?? true) && !(opts.headless ?? false)
      ? ["--window-position=-32000,-32000", "--window-size=1280,900"]
      : []),
  ],
});

const LOGIN_SEL = 'input[name="pass"], form[action*="login"]';

async function loggedIn(page) {
  if ((await page.locator(LOGIN_SEL).count()) > 0) return false;
  return (
    (await page.locator('a[href*="/marketplace/item/"]').count()) > 0 ||
    (await page.locator('[aria-label="Your profile"], [aria-label="Account"]').count()) > 0
  );
}

async function scroll(page, steps) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, 600 + Math.floor(rnd() * 500));
    await pause(500, 1400);
  }
}

try {
  if (command === "login") {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto("https://www.facebook.com/marketplace/", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await pause(1200, 2400);

    if (await loggedIn(page)) {
      log("already signed in — nothing to do");
      emit({ type: "done", stats: { loggedIn: true } });
    } else {
      await page.goto("https://www.facebook.com/login", { waitUntil: "domcontentloaded" });
      log("NOT signed in. Sign in in the Chrome window, open Marketplace once, then press Enter here.");
      const rl = readline.createInterface({ input: process.stdin });
      for await (const _ of rl) break;
      rl.close();
      await page.goto("https://www.facebook.com/marketplace/", { waitUntil: "domcontentloaded", timeout: 60_000 });
      await pause(1500, 2500);
      emit({ type: "done", stats: { loggedIn: await loggedIn(page) } });
    }
  } else if (command === "crawl") {
    const page = await ctx.newPage();

    // Keep the raw JSON the page fetches. The DOM shows what Facebook chose to
    // render; the GraphQL payload has fields it did not. Per the archive rule,
    // anything not captured now is gone.
    let rawCount = 0;
    page.on("response", async (res) => {
      if (!res.url().includes("/api/graphql")) return;
      if (rawCount >= (opts.maxRaw ?? 40)) return;
      try {
        const body = await res.text();
        if (body.includes("marketplace_search") || body.includes("marketplace_listing")) {
          rawCount++;
          emit({ type: "graphql", body: body.slice(0, 200_000) });
        }
      } catch { /* an unreadable body is not worth failing a crawl over */ }
    });

    let cardCount=0;
    if(!opts.detailsOnly) {
    log(`opening ${opts.searchUrl}`);
    await page.goto(opts.searchUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await pause(1500, 3000);

    if ((await page.locator(LOGIN_SEL).count()) > 0) {
      emit({ type: "error", msg: "not logged in — run `bun run fb:login` first" });
      await ctx.close();
      process.exit(2);
    }

    for (let i = 0; i < (opts.scrolls ?? 4); i++) {
      await scroll(page, 3);
      log(`scroll ${i + 1}/${opts.scrolls ?? 4}`);
    }

    /**
     * Read cards from the ANCHOR OUTWARD. Facebook's class names are generated
     * and change without notice; the `/marketplace/item/<id>/` URL shape has
     * not. Walking up to a container and taking its text survives a restyle in
     * a way no class selector does.
     */
    const cards = await page.evaluate(() => {
      const out = [];
      const seen = new Set();
      for (const a of document.querySelectorAll('a[href*="/marketplace/item/"]')) {
        const href = a.href.split("?")[0];
        if (seen.has(href)) continue;
        seen.add(href);
        let node = a;
        for (let i = 0; i < 3 && node.parentElement; i++) node = node.parentElement;
        const img = a.querySelector("img");
        out.push({ href, text: (node.innerText || "").trim(), img: img ? img.src : null });
      }
      return out;
    });
    emit({ type: "cards", cards });
    cardCount=cards.length;
    log(`${cards.length} cards`);
    }

    for (const url of opts.detailUrls ?? []) {
      const started=Date.now();
      try {
        await pause(1500, 3500);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await pause(1200, 2400);
        if((await page.locator(LOGIN_SEL).count())>0)throw new Error('Sign-in needs attention');

        // "See more" hides most of the description, and the description is
        // where the value-determining specs live.
        const more = page.locator('[role="main"]').getByText('See more',{exact:true}).first();
        if (await more.count()) {
          await more.click().catch(() => {});
          await pause(400, 900);
        }

        /**
         * Collect the listing's OWN photos, not the page's images.
         *
         * Measured on a real listing: 26 Facebook-CDN images on the page, of
         * which **20 were "More like this" thumbnails** and 4 were 36px icons.
         * Scraping all of them would have sent 20 other people's items to a paid
         * vision call and polluted the extracted specs with them.
         *
         * Two filters, both needed. `Seller information` is where the listing's
         * own content ends and the related-listing rail begins, so anything
         * positioned after that node is somebody else's item. Width >= 200 drops
         * avatars and UI icons that sit before it.
         */
        const collect = () =>
          page.evaluate(() => {
            const main = document.querySelector('[role="main"]') || document.body;
            const boundary = Array.from(main.querySelectorAll("h2,h3,span,div"))
              .find((e) => /^seller information/i.test((e.textContent || "").trim()));
            const out = [];
            for (const img of main.querySelectorAll("img")) {
              if (!/scontent|fbcdn/.test(img.src)) continue;
              if (boundary && boundary.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING) continue;
              if (img.getBoundingClientRect().width < 200) continue;
              out.push(img.src);
            }
            return out;
          });

        /**
         * Marketplace renders ONE carousel photo at a time, so a single pass
         * captures one image out of however many exist. The `View photo N`
         * labels state the real count, which is what makes "have we got them
         * all" answerable instead of a guess.
         *
         * THE RULE IS EVERY PHOTO, NEVER A SAMPLE — the Phase 0 miss was a
         * skipped third image holding the whole spec sheet.
         */
        const expected = await page.locator('[aria-label^="View photo "]').count();
        const photos = new Set(await collect());
        const next = page
          .locator('[aria-label="View next image"], [aria-label="See next photo"], [aria-label="Next photo"]')
          .first();

        if (await next.count()) {
          for (let k = 0; k < Math.max(expected, 1) + 2; k++) {
            if (expected && photos.size >= expected) break;
            await next.click({ timeout: 3000 }).catch(() => {});
            await pause(600, 1200);
            const before = photos.size;
            for (const s of await collect()) photos.add(s);
            if (photos.size === before) break;   // carousel wrapped or ended
          }
        }
        if (expected && photos.size < expected) {
          emit({ type: "log", msg: `${url}: got ${photos.size} of ${expected} photos` });
        }

        const detail = await page.evaluate(() => {
          /**
           * Text scoped to `[role="main"]` and sliced from the title.
           *
           * `document.body.innerText` dragged in ~34 lines of Facebook chrome —
           * "Notifications", "Create new listing", the whole category sidebar —
           * as the listing DESCRIPTION. The signal layer is regex over free
           * text, so that nav copy was being scanned for red flags and fed to
           * the catalog matcher.
           */
          const main = document.querySelector('[role="main"]') || document.body;
          const lines = (main.innerText || "").split("\n").map((l) => l.trim());
          const h1 = main.querySelector("h1");
          const title = (h1 && h1.innerText.trim()) || "";

          const start = title ? lines.findIndex((l) => l === title) : 0;
          const end = lines.findIndex((l,i) => i>start&&/^(seller information|more like this|comments|related listings)$/i.test(l));
          const content = lines.slice(start >= 0 ? start : 0, end > 0 ? end : undefined);

          // Facebook's own "Condition" field — a structured value the seller
          // picked from a list, which beats guessing from prose.
          const ci = content.findIndex((l) => /^condition$/i.test(l));
          const condition = ci >= 0 ? content[ci + 1] ?? null : null;

          const full=content.join('\n'),truncated=full.length>80000;
          return { title: title || content[0] || "", heading:title, bodyLines: full.slice(0,80000).split('\n'), condition,
            extraction:{complete:Boolean(title&&end>start&&!content.some(l=>/^see more$/i.test(l))&&!truncated),truncated,rawCharacters:full.length},
            actions:[...main.querySelectorAll('button,[role="button"]')].map(e=>e.innerText||e.getAttribute('aria-label')||'') };
        });

        emit({ type: "detail", url, finalUrl:page.url(), ...detail, photos: [...photos],readMs:Date.now()-started });
      } catch (e) {
        emit({ type: "error", msg: `${url}: ${String(e.message).slice(0, 120)}` });
      }
    }

    emit({ type: "done", stats: { cards: cardCount, raw: rawCount } });
  } else {
    emit({ type: "error", msg: `unknown command ${command}` });
  }
} catch (e) {
  emit({ type: "error", msg: String(e && e.message ? e.message : e) });
} finally {
  // Close the CONTEXT — that is what flushes the profile to disk. Killing the
  // process instead can lose the session and force a fresh login.
  await ctx.close().catch(() => {});
  releaseProfile();
}
