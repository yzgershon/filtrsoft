/**
 * eBay SOLD-listings worker. **RUNS UNDER NODE, NOT BUN.**
 *
 * THIS IS THE COMPS UNBLOCK, and it exists because Yish spotted what I had
 * missed. I had told him repeatedly that sold comps were gated behind eBay's
 * Marketplace Insights API — which is genuinely Limited Release and genuinely
 * closed to new users. All true, and all irrelevant: **eBay's own website shows
 * sold prices to any signed-in account.** The API door is shut; the front door
 * is open. Two sessions of planning were built around the wrong constraint.
 *
 * MEASURED 2026-08-24, in this order, which is worth keeping because each step
 * failed differently:
 *   headless, fresh profile   -> HTTP 403
 *   headed, fresh profile     -> 200 but "Security Measure | eBay" interstitial
 *   headed, warmed profile    -> homepage OK, ACTIVE search returns 62 items
 *   headed, sold filter       -> redirected to "Sign in or Register"
 *
 * So: headed, warmed, and signed in. `LH_Sold=1&LH_Complete=1` is the filter.
 *
 * WARMING IS NOT SUPERSTITION. Going straight to a search URL on a profile with
 * no cookies and no history is what triggered the interstitial. Loading the
 * homepage first is what a person does, and it is what makes the difference.
 */
import { openContext, emit, log, pause, scroll, profilePath } from "./launch.mjs";
import {readEbaySignInState,waitForManualSignIn} from './ebay-login-state.mjs';

const [, , command, optsJson] = process.argv;
const opts = JSON.parse(optsJson ?? "{}");

const ctx = await openContext({
  profile: "ebay",
  chromePath: opts.chromePath,
  headless: opts.headless ?? false,
  /**
   * ⚠ HEADED BUT OFF-SCREEN BY DEFAULT. Every automated run here opens a real
   * Chrome window, and Yish uses this machine — a window that appears and takes
   * focus mid-crawl is the automation interrupting the person it exists to
   * serve. The login commands opt OUT, because a sign-in he cannot see is a
   * sign-in he cannot complete.
   */
  background: opts.background ?? true,
});

const SIGNED_OUT = /^sign in or register/i;

async function warm(page) {
  await page.goto("https://www.ebay.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await pause(2500, 4500);
}

try {
  if (command === "login") {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await warm(page);

    if (await readEbaySignInState(page)) {
      log("signed-in account header verified");
      emit({ type: "done", stats: { loggedIn: true, verification: 'account-header' } });
    } else {
      /**
       * LAND ON THE PLAIN SIGN-IN PAGE AND THEN DO NOT TOUCH THE BROWSER.
       *
       * The previous version navigated straight to the sold-search URL, which
       * redirects through eBay's bot challenge — and Yish reported it "keeps
       * refreshing every 3 seconds so it doesn't give me time to complete the
       * captcha". Two causes, both fixed here:
       *
       *   1. it navigated a SECOND time right after the first, ~3s later
       *   2. if stdin never reached this process the Enter-wait fell straight
       *      through, so that second navigation happened immediately and the
       *      browser then CLOSED mid-captcha
       *
       * So: no challenge-triggering URL, and the wait can no longer fall
       * through. Enter finishes early; otherwise it simply waits, and the
       * window stays open the whole time.
       */
      await page.goto("https://www.ebay.com/signin/", { waitUntil: "domcontentloaded", timeout: 60_000 });
      log("Sign-in is unconfirmed. Sign in manually in the Chrome window,");
      log("including any 'I am not a robot' check. The window will stay open.");
      log("Press Enter here when you are done (or just wait; it checks on its own).");

      /**
       * Poll passively for the signed-in state. NO NAVIGATION — it reads the
       * page Yish is already on, so a captcha in progress is never interrupted.
       */
      const reason=await waitForManualSignIn({input:process.stdin,readSignedIn:()=>readEbaySignInState(page)});
      const loggedIn=await readEbaySignInState(page);
      emit({
        type: "done",
        stats: { loggedIn, verification: loggedIn?'account-header':'unconfirmed', reason },
      });
    }
  } else if (command === "sold") {
    const page = await ctx.newPage();
    await warm(page);

    for (const query of opts.queries ?? []) {
      const url =
        `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}` +
        `&LH_Sold=1&LH_Complete=1&_ipg=120` +
        (opts.categoryId ? `&_sacat=${opts.categoryId}` : "");

      log(`searching sold: ${query}`);
      /**
       * ⚠ ONE BAD NAVIGATION MUST NOT END THE WHOLE RUN.
       *
       * A 60-model backfill died on its second query with
       * `net::ERR_ADDRESS_UNREACHABLE` — a transient network blip — and took
       * the other 58 with it, storing nothing. These runs take an hour and are
       * exactly the thing you start and walk away from, so an unlucky second
       * is not a reason to abandon the batch.
       *
       * ONE RETRY, then skip: a genuinely unreachable host will not recover in
       * four seconds, and hammering a failing page is how a scraper gets
       * blocked. Anything already stored stays stored — `saveComps` writes per
       * query, not at the end.
       */
      let navigated = false;
      for (let attempt = 0; attempt < 2 && !navigated; attempt++) {
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
          navigated = true;
        } catch (navErr) {
          const msg = String(navErr && navErr.message ? navErr.message : navErr).slice(0, 120);
          if (attempt === 0) { log(`  navigation failed, retrying once: ${msg}`); await pause(4000, 7000); }
          else emit({ type: "error", msg: `skipped "${query}": ${msg}` });
        }
      }
      if (!navigated) { await pause(3000, 6000); continue; }
      await pause(2500, 4000);

      const title = await page.title();
      if (SIGNED_OUT.test(title)) {
        emit({ type: "error", msg: "not signed in — run `bun run ebay:login` first" });
        await ctx.close();
        process.exit(2);
      }
      if (/security measure/i.test(title)) {
        emit({ type: "error", msg: `eBay bot challenge on "${query}" — slow down or solve it in the window` });
        continue;
      }

      await scroll(page, 4);

      /**
       * Emit RAW rows. Every bit of parsing happens in TypeScript, in
       * `src/sources/ebay.ts`, where it can be tested without a browser — the
       * same split that made the Facebook parsers debuggable.
       *
       * Rows are read from the item ANCHOR outward. eBay's class names have
       * changed repeatedly (`s-item` -> `s-card`), so both are matched and the
       * container text is taken wholesale rather than trusting any one selector.
       */
      const rows = await page.evaluate(() => {
        const nodes = document.querySelectorAll(
          'li.s-item, li.s-card, [data-testid="item-card"]',
        );
        const out = [];
        for (const li of nodes) {
          const a = li.querySelector('a[href*="/itm/"]');
          if (!a) continue;
          const img = li.querySelector("img");
          /**
           * Take the title from the ANCHOR, not by guessing at the row's lines.
           * Picking "the longest line that is not a price" chose
           * "tspence007 100% positive (41)" — the SELLER — as the product name
           * on a real row. The link text is the title by construction.
           */
          const heading = li.querySelector('[role="heading"], .s-item__title, .s-card__title');
          out.push({
            href: a.href.split("?")[0],
            title: ((heading && heading.innerText) || a.innerText || "").trim(),
            text: (li.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean),
            img: img ? img.src : null,
          });
        }
        return out;
      });

      emit({ type: "sold", query, rows });
      log(`  ${rows.length} rows`);
      // A real person does not fire searches back to back.
      await pause(3000, 6000);
    }

    emit({ type: "done", stats: { queries: (opts.queries ?? []).length } });
  } else {
    emit({ type: "error", msg: `unknown command ${command}` });
  }
} catch (e) {
  emit({ type: "error", msg: String(e && e.message ? e.message : e) });
} finally {
  // Closing the CONTEXT is what flushes the profile to disk. Killing the
  // process can lose the session and force a fresh login.
  await ctx.close().catch(() => {});
}
void profilePath;
