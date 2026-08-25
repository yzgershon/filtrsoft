/**
 * Retail price worker — the CEILING. **RUNS UNDER NODE, NOT BUN.**
 *
 * WHY A CEILING IS WORTH HAVING, and why it is not just another comp source:
 * a buyer can always walk into Best Buy and get a NEW one today. That price is
 * a hard upper bound on what any used unit can fetch, and it is the one number
 * that is true regardless of how good or bad our sold-comp coverage is.
 *
 * It catches a failure mode comps cannot: **used priced at or above new.** It is
 * also the only independent check on the comps themselves — if a used median
 * comes out ABOVE new retail, the comps are wrong, and nothing else in the
 * system could have told us that.
 *
 * Nobody in the competitor set does this. They all compare used to used.
 *
 * DUMB WORKER, as with the others: it emits raw text lines and all parsing
 * happens in TypeScript where it can be tested without a browser.
 */
import { openContext, emit, log, pause } from "./launch.mjs";

const [, , command, optsJson] = process.argv;
const opts = JSON.parse(optsJson ?? "{}");

const ctx = await openContext({
  profile: "retail",
  chromePath: opts.chromePath,
  headless: opts.headless ?? false,
});

try {
  if (command === "bestbuy") {
    const page = await ctx.newPage();

    for (const query of opts.queries ?? []) {
      const url = `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(query)}`;
      log(`bestbuy: ${query}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await pause(4000, 6500);

      const body = await page.evaluate(() => (document.body.innerText || "").slice(0, 400));
      if (/are you a human|access denied|unusual traffic|verify you are/i.test(body)) {
        emit({ type: "error", msg: `bot challenge on "${query}"` });
        continue;
      }

      // Results lazy-load; a nudge down the page brings the rest in.
      await page.mouse.wheel(0, 1400);
      await pause(2000, 3200);

      const lines = await page.evaluate(() => {
        const main = document.querySelector("main") || document.body;
        return (main.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean);
      });

      emit({ type: "retail", source: "bestbuy", query, lines });
      // A real person does not fire searches back to back.
      await pause(3000, 5500);
    }

    emit({ type: "done", stats: { queries: (opts.queries ?? []).length } });
  } else {
    emit({ type: "error", msg: `unknown command ${command}` });
  }
} catch (e) {
  emit({ type: "error", msg: String(e && e.message ? e.message : e) });
} finally {
  await ctx.close().catch(() => {});
}
