/**
 * bun run retail [--query "iphone 15 128gb"] [--skus N] [--headless] [--dry] [--replay]
 *
 * Pulls NEW retail prices from Best Buy — the ceiling on what a used unit can
 * fetch, and the only check on our comps that is not derived from our comps.
 *
 * Every run archives the raw page lines to `docs/testset/retail-lines.json`, so
 * the parser can be re-tested and fixed WITHOUT re-scraping. Best Buy's layout
 * will change; when it does, the fixture is what makes that a ten-minute fix
 * instead of another live session.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  runRetailWorker, parseBestBuy, retailCeiling, saveRetail, saveNoRetail, noCeilingReason,
  retailQueryForSku, skusNeedingRetail,
} from "../sources/retail.ts";
import { db } from "../db/index.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (k: string) => process.argv.includes(`--${k}`);

const FIXTURE = join(import.meta.dir, "../../docs/testset/retail-lines.json");

const single = arg("query");
const targets = single
  ? [{ id: null as number | null, label: single, query: single, category: arg("category") ?? null }]
  : skusNeedingRetail(Number(arg("skus")) || 8).map((s) => ({
      id: s.id,
      label: `${s.brand} ${s.model}${s.observed ? ` (last seen ${s.observed.slice(0, 10)})` : " (never)"}`,
      query: retailQueryForSku(s),
      category: s.category as string | null,
    }));

if (!targets.length) { console.log("nothing to look up"); process.exit(0); }

console.log(`Best Buy: ${targets.length} query(s)`);
for (const t of targets) console.log(`  · ${t.label}  ->  "${t.query}"`);
console.log();

const bySku = new Map(targets.map((t) => [t.query, t.id]));
const catBy = new Map(targets.map((t) => [t.query, t.category ?? null]));
const archive: Record<string, string[]> = existsSync(FIXTURE)
  ? JSON.parse(readFileSync(FIXTURE, "utf8"))
  : {};
let saved = 0;

/**
 * `--replay` re-scores the ARCHIVED pages instead of scraping.
 *
 * Every parser fix so far has been found by staring at lines already captured
 * — the accessory that became a ceiling, the nav tile, the review text read as
 * a title. Re-running the browser to re-test a pure function is slow, is
 * another session Best Buy sees, and re-introduces the one variable you were
 * trying to hold still. This replays instead, so a fix costs seconds.
 */
const events = has("replay")
  ? (async function* () {
      for (const t of targets) {
        const lines = archive[t.query];
        if (!lines) { console.log(`  \x1b[90mno archived page for "${t.query}"\x1b[0m`); continue; }
        yield { type: "retail" as const, source: "bestbuy", query: t.query, lines };
      }
    })()
  : runRetailWorker("bestbuy", {
      queries: targets.map((t) => t.query), headless: has("headless"),
    });

for await (const ev of events) {
  if (ev.type === "log") console.log(`  ${ev.msg}`);
  else if (ev.type === "error") console.error(`\x1b[31m  ${ev.msg}\x1b[0m`);
  else if (ev.type === "retail") {
    archive[ev.query] = ev.lines;

    const offers = parseBestBuy(ev.lines);
    const found = retailCeiling(offers, ev.query, catBy.get(ev.query) ?? null);
    const ceiling = found.offer;
    const newOffers = offers.filter((o) => o.isNew).length;

    console.log(
      `  \x1b[1m${ev.query}\x1b[0m: ${ev.lines.length} lines -> ${offers.length} offers ` +
      `(${newOffers} new, ${offers.length - newOffers} pre-owned)`,
    );

    if (!ceiling) {
      /**
       * Say WHICH kind of nothing this is. "No ceiling" covers three different
       * facts and only one of them is a scrape problem:
       *   · sold out / financing-only -> Best Buy has stopped selling it new,
       *     which means the used market has no ceiling at all. That is the
       *     answer, not a miss.
       *   · retailer sells it used only -> same conclusion.
       *   · nothing parsed -> the page changed and the parser needs the fixture.
       */
      const why = noCeilingReason(offers, found.rejected);
      console.log(`    \x1b[90mno ceiling: ${why}\x1b[0m`);
      // Record the absence, so the queue stops re-asking dead questions.
      if (!has("dry")) saveNoRetail(bySku.get(ev.query) ?? null, ev.query, why);
      for (const o of offers.slice(0, 3)) {
        console.log(`    \x1b[90m· ${o.financedOnly ? "  /mo" : `$${(o.priceCents / 100).toFixed(0)}`} ${o.isNew ? "[new] " : "[used] "}${o.title.slice(0, 58)}\x1b[0m`);
      }
      continue;
    }

    console.log(`    \x1b[32mnew from $${(ceiling.priceCents / 100).toFixed(2)}\x1b[0m  ${ceiling.title.slice(0, 68)}`);
    // Show what the gate threw out. A wrong ceiling is otherwise silent, and
    // the iPhone 16e nearly became the iPhone 16's new price exactly this way.
    for (const r of found.rejected.slice(0, 4)) {
      console.log(`    \x1b[90m  rejected: ${r.title.slice(0, 54)} — ${r.why}\x1b[0m`);
    }
    if (!has("dry")) { saveRetail(bySku.get(ev.query) ?? null, ceiling, ev.query); saved++; }
  }
}

mkdirSync(join(import.meta.dir, "../../docs/testset"), { recursive: true });
writeFileSync(FIXTURE, JSON.stringify(archive, null, 1));

const n = db().query("SELECT COUNT(*) n FROM retail_prices WHERE is_new=1").get() as { n: number };
const covered = db().query(
  "SELECT COUNT(DISTINCT sku_id) n FROM retail_prices WHERE sku_id IS NOT NULL AND is_new=1",
).get() as { n: number };
console.log(`\n${saved} stored this run · ${n.n} retail prices · ${covered.n} SKUs with a ceiling`);
console.log(`raw lines archived for ${Object.keys(archive).length} queries -> docs/testset/retail-lines.json`);
