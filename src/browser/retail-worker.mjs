/**
 * Retail price worker — the CEILING. **RUNS UNDER NODE, NOT BUN.**
 *
 * WHY A CEILING IS WORTH HAVING, and why it is not just another comp source:
 * a buyer can always walk in and get a NEW one today. That price is a hard
 * upper bound on what any used unit can fetch, and it is the one number that is
 * true regardless of how good or bad our sold-comp coverage is.
 *
 * It catches a failure mode comps cannot: **used priced at or above new.** It is
 * also the only independent check on the comps themselves — if a used median
 * comes out ABOVE new retail, the comps are wrong, and nothing else in the
 * system could have told us that.
 *
 * Nobody in the competitor set does this. They all compare used to used.
 *
 * THREE SOURCES, and the second and third exist because the first LIES about
 * the categories Yish actually trades:
 *
 *   · **bestbuy**    — good for consoles. Marked up badly on GPUs: it quoted
 *                      $795.59 for an RTX 5070 against a ~$549 MSRP, and a
 *                      ceiling 45% too high never binds on anything.
 *   · **newegg**     — the real price reference for PC parts. Covers the gpu
 *                      and component SKUs, which are also what `valueByParts`
 *                      needs for prebuilts.
 *   · **microcenter**— Yish's call, and it is a local one: the Cambridge MA
 *                      store is ~20 minutes from Newton, so for a Boston buyer
 *                      it is a REAL alternative, which is exactly what a
 *                      ceiling is supposed to measure. Their GPU pricing is
 *                      usually the lowest anywhere.
 *
 * DUMB WORKER, as with the others: it emits raw text lines and all parsing
 * happens in TypeScript where it can be tested without a browser.
 */
import { openContext, emit, log, pause } from "./launch.mjs";

const [, , command, optsJson] = process.argv;
const opts = JSON.parse(optsJson ?? "{}");

/**
 * Micro Center prices and stock are PER STORE, so the store id is not optional
 * — without it the site answers for whichever store it guesses from the IP, and
 * a ceiling from a Texas store is not a ceiling Yish's buyer can walk into.
 * 121 is Cambridge, MA.
 */
const MICROCENTER_STORE = opts.storeId ?? "121";

const SOURCES = {
  bestbuy: {
    url: (q) => `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(q)}`,
  },
  newegg: {
    url: (q) => `https://www.newegg.com/p/pl?d=${encodeURIComponent(q)}`,
  },
  microcenter: {
    url: (q) =>
      `https://www.microcenter.com/search/search_results.aspx?Ntt=${encodeURIComponent(q)}` +
      `&storeid=${MICROCENTER_STORE}`,
    // Micro Center serves the store's prices off a cookie, not just the query
    // string. Setting it up front means the FIRST query is already correct
    // rather than silently national.
    cookies: [
      { name: "storeSelected", value: MICROCENTER_STORE, domain: ".microcenter.com", path: "/" },
      { name: "myStore", value: "true", domain: ".microcenter.com", path: "/" },
    ],
  },
};

const source = SOURCES[command];
if (!source) {
  emit({ type: "error", msg: `unknown command ${command}` });
  process.exit(1);
}

const ctx = await openContext({
  // One profile per site, same rule as the other workers: a bot challenge on
  // one retailer must not take out the others.
  profile: `retail-${command}`,
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

try {
  if (source.cookies) await ctx.addCookies(source.cookies);
  const page = await ctx.newPage();

  for (const query of opts.queries ?? []) {
    log(`${command}: ${query}`);
    await page.goto(source.url(query), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await pause(4000, 6500);

    const body = await page.evaluate(() => (document.body.innerText || "").slice(0, 400));
    if (/are you a human|access denied|unusual traffic|verify you are|checking your browser/i.test(body)) {
      emit({ type: "error", msg: `bot challenge on "${query}"` });
      continue;
    }

    // Results lazy-load; a nudge down the page brings the rest in.
    await page.mouse.wheel(0, 1400);
    await pause(2000, 3200);

    /**
     * Read `main`, but FALL BACK TO BODY WHEN `main` IS HOLLOW.
     *
     * Micro Center returned zero lines for the RTX 5070 and 5090 while working
     * fine for the 4060, 5080 and 3060. The cause is not the query: `<main>`
     * exists on every one of those pages, so `querySelector("main") ||
     * document.body` picked the main element and then read an EMPTY string out
     * of it, because the results render into a sibling on some layouts. An
     * `||` fallback cannot help — the element was found, it just had nothing in
     * it. The length check is what actually catches this.
     *
     * A silent zero is the worst possible failure here: it reports as "nothing
     * parsed — the page layout may have changed", which sends the next person
     * to rewrite a parser that was never wrong.
     */
    const read = () => page.evaluate(() => {
      const main = document.querySelector("main");
      const text = main && (main.innerText || "").length > 200
        ? main.innerText
        : (document.body.innerText || "");
      return text.split("\n").map((s) => s.trim()).filter(Boolean);
    });

    let lines = await read();
    // One retry. An empty read is almost always a render that had not finished.
    if (lines.length < 10) {
      log(`${command}: "${query}" came back with ${lines.length} lines — retrying`);
      await pause(3500, 5000);
      lines = await read();
    }
    if (lines.length < 10) {
      emit({ type: "error", msg: `"${query}" rendered ${lines.length} lines after a retry` });
    }

    emit({ type: "retail", source: command, query, lines });
    // A real person does not fire searches back to back.
    await pause(3000, 5500);
  }

  emit({ type: "done", stats: { queries: (opts.queries ?? []).length } });
} catch (e) {
  emit({ type: "error", msg: String(e && e.message ? e.message : e) });
} finally {
  await ctx.close().catch(() => {});
}
