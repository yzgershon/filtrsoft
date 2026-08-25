/**
 * bun run fb:crawl [--query "rtx 3080"] [--cat electronics] [--loc boston]
 *                  [--limit 20] [--scrolls 4] [--vision N] [--headless]
 *
 * Requires `bun run fb:login` once first.
 *
 * Deliberately slow. Each listing is opened in a real window at human pace,
 * because the realistic penalty for looking like a bot is Yish's ACCOUNT, not a
 * rate-limit error. A crawl that takes ten minutes and keeps the account beats
 * one that takes ten seconds and does not.
 */
import { runWorker, searchUrl, parseCard, detailToListing, type FbCard } from "../sources/facebook.ts";
import { checkFetched } from "../engine/index.ts";
import { db, now } from "../db/index.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (k: string) => process.argv.includes(`--${k}`);
const money = (c: number | null) => (c == null ? "—" : `$${(c / 100).toFixed(0)}`);

const limit = Number(arg("limit")) || 20;
const maxVision = Number(arg("vision")) || 0;

const url = searchUrl({
  query: arg("query"), category: arg("cat"), location: arg("loc") ?? "boston",
  minPrice: arg("min") ? Number(arg("min")) : undefined,
  maxPrice: arg("max") ? Number(arg("max")) : undefined,
});

// ---- pass 1: collect the cards ---------------------------------------
const cards: FbCard[] = [];
const raws: string[] = [];

for await (const ev of runWorker("crawl", {
  searchUrl: url, scrolls: Number(arg("scrolls")) || 4, headless: has("headless"), detailUrls: [],
})) {
  if (ev.type === "log") console.log(`  ${ev.msg}`);
  else if (ev.type === "graphql") raws.push(ev.body);
  else if (ev.type === "cards") {
    for (const c of ev.cards) { const p = parseCard(c); if (p) cards.push(p); }
  } else if (ev.type === "error") { console.error(`\x1b[31m  ${ev.msg}\x1b[0m`); process.exit(1); }
}

const known = new Set(
  (db().query("SELECT source_id FROM listings WHERE source='facebook'").all() as Array<{ source_id: string }>)
    .map((r) => r.source_id),
);
const fresh = cards.filter((c) => !known.has(c.sourceId)).slice(0, limit);
console.log(`\n${cards.length} cards · ${cards.length - fresh.length} known or over limit · \x1b[1m${fresh.length} to open\x1b[0m\n`);

if (!fresh.length) process.exit(0);

// ---- pass 2: open each listing, run the engine -----------------------
// A SECOND browser session, on purpose. Pass 1 establishes what is worth
// opening; opening 100 detail pages to then discard 80 is exactly the traffic
// pattern that gets an account flagged.
const byUrl = new Map(fresh.map((c) => [c.url, c]));
let analysed = 0, visionRun = 0;

for await (const ev of runWorker("crawl", {
  searchUrl: url, scrolls: 0, headless: has("headless"), detailUrls: fresh.map((c) => c.url),
})) {
  if (ev.type === "log") continue;
  if (ev.type === "graphql") { raws.push(ev.body); continue; }
  if (ev.type === "error") { console.error(`\x1b[31m  ${ev.msg}\x1b[0m`); continue; }
  if (ev.type !== "detail") continue;

  try {
    const listing = detailToListing(ev, byUrl.get(ev.url));
    const wantVision = visionRun < maxVision;
    const r = await checkFetched(listing, { persist: true, vision: wantVision });
    if (wantVision && r.vision) visionRun++;
    analysed++;
    console.log(
      `  ${String(analysed).padStart(3)}/${fresh.length}  ${r.verdict.call.padEnd(18)}` +
      `${money(listing.askingPriceCents).padStart(7)}  ${listing.title.slice(0, 44)}`,
    );
  } catch (e) {
    console.log(`  \x1b[31mFAILED\x1b[0m ${(e as Error).message.slice(0, 80)}`);
  }
}

db().query(
  `INSERT INTO crawls (started_at, discovered, analysed, vision_run, failed, created_at)
   VALUES ($s,$d,$a,$v,$f,$n)`,
).run({ $s: now(), $d: cards.length, $a: analysed, $v: visionRun, $f: fresh.length - analysed, $n: now() });

console.log(`\ndone · ${analysed} analysed · ${visionRun} with photos read · ${raws.length} graphql payloads seen`);
