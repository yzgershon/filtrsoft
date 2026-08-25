/**
 * Facebook Marketplace browser worker. **RUNS UNDER NODE, NOT BUN.**
 *
 * WHY A SEPARATE PROCESS: Playwright hangs under Bun on this machine — measured
 * 2026-08-24, `chromium.launch()` never resolves, while the identical script
 * under Node 24 launches Chrome in about three seconds. The rest of Assyze is
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
 * anywhere in Assyze, and there must never be.
 */
const ctx = await chromium.launchPersistentContext(opts.profileDir, {
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
    log(`${cards.length} cards`);

    for (const url of opts.detailUrls ?? []) {
      try {
        await pause(1500, 3500);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await pause(1200, 2400);

        // "See more" hides most of the description, and the description is
        // where the value-determining specs live.
        const more = page.locator('div[role="button"]:has-text("See more")').first();
        if (await more.count()) {
          await more.click().catch(() => {});
          await pause(400, 900);
        }

        const detail = await page.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll("img"))
            .map((i) => i.src)
            .filter((s) => s && /scontent|fbcdn/.test(s) && !/emoji|static|\/p\d\dx\d\d\//.test(s));
          const body = (document.body.innerText || "")
            .split("\n").map((l) => l.trim()).filter(Boolean);
          const h1 = document.querySelector("h1");
          return {
            title: (h1 && h1.innerText.trim()) || body[0] || "",
            bodyLines: body.slice(0, 200),
            photos: Array.from(new Set(imgs)).slice(0, 30),
          };
        });
        emit({ type: "detail", url, ...detail });
      } catch (e) {
        emit({ type: "error", msg: `${url}: ${String(e.message).slice(0, 120)}` });
      }
    }

    emit({ type: "done", stats: { cards: cards.length, raw: rawCount } });
  } else {
    emit({ type: "error", msg: `unknown command ${command}` });
  }
} catch (e) {
  emit({ type: "error", msg: String(e && e.message ? e.message : e) });
} finally {
  // Close the CONTEXT — that is what flushes the profile to disk. Killing the
  // process instead can lose the session and force a fresh login.
  await ctx.close().catch(() => {});
}
