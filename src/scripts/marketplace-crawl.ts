/**
 * bun run ou:crawl --query "rtx 4070"   [--limit 25] [--headless] [--dry]
 * bun run mc:crawl --query "iphone 15"
 *
 * OfferUp and Mercari. Used markets, so they feed the deal feed AND — once the
 * outcome loop is wired to them — a second opinion on clearing prices that does
 * not come from eBay.
 *
 * Basis matters here and is per SOURCE: Mercari is eBay-basis (national,
 * shipped, ~10% fee), OfferUp is local unless the card says shipping. See
 * `sources/marketplace.ts`.
 */
import { runMarketWorker, parseCards, cardToListing, MARKETPLACES, BASIS, type Marketplace } from "../sources/marketplace.ts";
import { checkFetched } from "../engine/index.ts";
import { resolveProductType } from "../signals/product-type.ts";
import { db } from "../db/index.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (k: string) => process.argv.includes(`--${k}`);

const source = (arg("source") ?? "offerup") as Marketplace;
if (!MARKETPLACES.includes(source)) {
  console.error(`--source must be one of: ${MARKETPLACES.join(", ")}`);
  process.exit(1);
}

/**
 * Default queries are the categories Yish trades, not "electronics".
 * These sites have no useful category browse — search is the only way in.
 *
 * ⚠ `ps5` AND `xbox series` WERE REMOVED ON 2026-09-04. Yish: *"get rid of all
 * the consoles on the app they are hard to resell. I dont want ANY consoles on
 * it."* The verdict engine now refuses them outright, but leaving the queries
 * here would keep spending crawl budget, browser time and description passes on
 * listings guaranteed to be thrown away — the Mercari run that finally worked
 * came back dominated by Xbox 360 games for exactly this reason.
 */
const DEFAULT_QUERIES = [
  "graphics card", "gaming pc", "macbook", "iphone", "laptop",
];
const queries = arg("query") ? [arg("query")!] : DEFAULT_QUERIES;
const limit = Number(arg("limit")) || 25;

console.log(`\x1b[1m${source}\x1b[0m (${BASIS[source]}-basis) · ${queries.length} query(s)`);

const seen = new Set(
  (db().query("SELECT source_id FROM listings WHERE source=$s").all({ $s: source }) as Array<{ source_id: string }>)
    .map((r) => r.source_id),
);

let found = 0, analysed = 0, skipped = 0;
/**
 * ⚠ TRACKED SEPARATELY FROM `found`, AND THE DISTINCTION IS THE POINT.
 *
 * `found` counts cards that PARSED. Zero of those is a normal outcome — a
 * search can legitimately return two hundred brackets and RGB strips and
 * nothing in scope. Zero LINKS across EVERY query is a different animal: it
 * means the page was never read, and the only honest responses are "you are
 * blocked" or "the selectors are dead".
 */
let linksSeen = 0, queriesRun = 0, blockedQueries = 0;
const tally: Record<string, number> = {};

for await (const ev of runMarketWorker(source, {
  queries, headless: has("headless"), scrolls: 3,
})) {
  if (ev.type === "log") console.log(`  ${ev.msg}`);
  else if (ev.type === "error") console.error(`\x1b[31m  ${ev.msg}\x1b[0m`);
  else if (ev.type === "cards") {
    const cards = parseCards(source, ev.links);
    found += cards.length;
    queriesRun++;
    linksSeen += ev.links.length;
    if ((ev as { blocked?: boolean }).blocked) blockedQueries++;
    console.log(`  \x1b[1m${ev.query}\x1b[0m: ${ev.links.length} links -> ${cards.length} cards`);

    const fresh = cards.filter((c) => !seen.has(c.sourceId));
    // Grammar gate BEFORE the engine, same as the Craigslist crawler: a search
    // for "graphics card" returns brackets, waterblocks and RGB strips.
    const inScope = fresh.filter((c) => resolveProductType(c.title).kind === "tech");
    skipped += fresh.length - inScope.length;

    for (const c of inScope.slice(0, limit)) {
      seen.add(c.sourceId);
      if (has("dry")) {
        console.log(`    $${c.priceCents ? (c.priceCents / 100).toFixed(0) : "—"} ${c.title.slice(0, 58)}`);
        continue;
      }
      try {
        const r = await checkFetched(cardToListing(c), { persist: true });
        tally[r.verdict.call] = (tally[r.verdict.call] ?? 0) + 1;
        analysed++;
        const C: Record<string, string> = { BUY: "\x1b[32m", VERIFY: "\x1b[35m", FAIR: "\x1b[36m" };
        if (["BUY", "VERIFY", "FAIR"].includes(r.verdict.call)) {
          console.log(`    ${C[r.verdict.call]}${r.verdict.call}\x1b[0m $${c.priceCents ? (c.priceCents / 100).toFixed(0) : "—"} ${c.title.slice(0, 52)}`);
        }
      } catch (e) {
        console.error(`    \x1b[31mfailed: ${(e as Error).message.slice(0, 70)}\x1b[0m`);
      }
    }
  }
}

console.log(`\n${found} cards seen · ${analysed} analysed · ${skipped} out of scope`);
if (Object.keys(tally).length) {
  console.log("  " + Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · "));
}

/**
 * ⚠ EXIT NON-ZERO WHEN NOTHING WAS READ AT ALL.
 *
 * `bun run agent` decides a source succeeded from the child's exit code, so a
 * crawler that reads a challenge page for every query and exits 0 reports
 * **"mercari: ok"** to the crawl button. That is precisely how Mercari sat dead
 * from 2026-08-26 to 2026-09-04 with a green tick beside it.
 *
 * The gate is `linksSeen`, never `found` — see the note above. A run where
 * every query came back with an unreadable page is a failed run, and it should
 * look like one everywhere: in the terminal, in the job row, and in the app.
 */
if (queriesRun > 0 && linksSeen === 0) {
  console.error(
    `\n\x1b[31m${source}: ${queriesRun} queries, not one readable result.\x1b[0m`,
  );
  /**
   * ⚠ "RUN IT HEADED ONCE AND THE PROFILE KEEPS THE CLEARANCE" IS FALSE, AND
   * THIS MESSAGE SAID IT FOR ONE COMMIT.
   *
   * Measured back to back on the same profile on 2026-09-04: headed read 28
   * links per query, headless straight afterwards read zero and was challenged
   * on all seven. Cloudflare fingerprints the browser, so no amount of warming
   * makes a headless run pass. Drop `--headless`, every time — telling someone
   * to warm a profile that cannot be warmed is worse than saying nothing.
   */
  console.error(
    blockedQueries > 0
      ? `  ${blockedQueries} of them served a bot challenge.\n  Re-run WITHOUT --headless: \`bun run ${source === "mercari" ? "mc" : "ou"}:crawl\`. A headed run does not leave a\n  clearance behind, so this source needs a real window EVERY time, not once.`
      : "  No challenge was detected either, so suspect the card selectors rather than a block.",
  );
  process.exit(3);
}
