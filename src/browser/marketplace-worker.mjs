/**
 * OfferUp and Mercari — used marketplaces. **RUNS UNDER NODE, NOT BUN.**
 *
 * **THESE ARE COMP SOURCES AS MUCH AS DEAL SOURCES, and Yish's correction on
 * 2026-08-25 is what makes the distinction matter.** They are used markets like
 * eBay, not local-pickup markets like Craigslist:
 *
 *   · **Mercari** is national, shipped, and takes ~10%. Its prices are
 *     eBay-BASIS and must NOT be discounted again by `netByChannel`.
 *   · **OfferUp** is mixed — mostly local pickup, but it has shipped listings
 *     too. Basis has to be decided per LISTING, not per source. Getting that
 *     wrong is the double-discount that read the NZXT build at $890 instead of
 *     $1,375.
 *
 * NEITHER NEEDS A LOGIN to browse search results, which is the whole reason
 * they are worth adding now: unlike Facebook, these can eventually run in the
 * container. They are browser-driven anyway because both render results client
 * side, exactly like Best Buy.
 *
 * DUMB WORKER: emits raw text lines, all parsing lives in TypeScript.
 */
import { openContext, emit, log, pause } from "./launch.mjs";

const [, , command, optsJson] = process.argv;
const opts = JSON.parse(optsJson ?? "{}");

const SOURCES = {
  offerup: {
    url: (q, o) =>
      `https://offerup.com/search?q=${encodeURIComponent(q)}` +
      `&radius=${o.radiusMiles ?? 30}&lat=${o.lat ?? 42.337}&lon=${o.lon ?? -71.2092}` +
      `&sort=-posted`,
  },
  mercari: {
    // `sortBy=2&orderBy=1` is newest-first. Deals go fast, so recency beats
    // relevance on a feed that is polled repeatedly.
    url: (q) =>
      `https://www.mercari.com/search/?keyword=${encodeURIComponent(q)}&sortBy=2&orderBy=1&itemStatuses=1`,
  },
};

const source = SOURCES[command];
if (!source) { emit({ type: "error", msg: `unknown source ${command}` }); process.exit(1); }

const ctx = await openContext({
  // One profile per site, same rule as every other worker here.
  profile: `mkt-${command}`,
  chromePath: opts.chromePath,
  headless: opts.headless ?? false,
});

try {
  const page = await ctx.newPage();

  for (const query of opts.queries ?? []) {
    log(`${command}: ${query}`);
    await page.goto(source.url(query, opts), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await pause(4500, 7000);

    const body = await page.evaluate(() => (document.body.innerText || "").slice(0, 400));
    if (/are you a human|access denied|unusual traffic|verify you are|checking your browser|press & hold/i.test(body)) {
      emit({ type: "error", msg: `bot challenge on "${query}"` });
      continue;
    }

    // Results lazy-load on both sites.
    for (let i = 0; i < (opts.scrolls ?? 3); i++) {
      await page.mouse.wheel(0, 1600);
      await pause(1200, 2200);
    }

    /**
     * Emit LINES and LINKS together. Prices and titles are in the text; the
     * item id is only in the href, and without an id there is no stable
     * `source_id`, so a re-crawl would insert duplicates instead of updating.
     */
    const { lines, links } = await page.evaluate(() => {
      const main = document.querySelector("main");
      const text = main && (main.innerText || "").length > 200
        ? main.innerText
        : (document.body.innerText || "");
      const hrefs = [...document.querySelectorAll("a[href]")]
        .map((a) => ({ href: a.getAttribute("href") || "", text: (a.innerText || "").trim().slice(0, 220) }))
        .filter((l) => /\/(item|p)\//.test(l.href) && l.text.length > 4);
      return { lines: text.split("\n").map((s) => s.trim()).filter(Boolean), hrefs };
    }).then((r) => ({ lines: r.lines, links: r.hrefs }));

    emit({ type: "cards", source: command, query, lines, links });
    await pause(3000, 5500);
  }

  emit({ type: "done", stats: { queries: (opts.queries ?? []).length } });
} catch (e) {
  emit({ type: "error", msg: String(e && e.message ? e.message : e) });
} finally {
  await ctx.close().catch(() => {});
}
