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
import { runWorker, searchUrl, parseCard, detailToListing, cardToListing, type FbCard } from "../sources/facebook.ts";
import {discoveryDecision} from '../crawler/search-policy.ts';
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
let rawCount = 0, workerErrors = 0;
const startedAt=now();

for await (const ev of runWorker("crawl", {
  searchUrl: url, scrolls: Number(arg("scrolls")) || 4, headless: has("headless"), detailUrls: [],
})) {
  if (ev.type === "log") console.log(`  ${ev.msg}`);
  else if (ev.type === "graphql") rawCount++;
  else if (ev.type === "cards") {
    for (const c of ev.cards) { const p = parseCard(c); if (p) cards.push(p); }
  } else if (ev.type === "error") { console.error(`\x1b[31m  ${ev.msg}\x1b[0m`); workerErrors++; }
}

if(workerErrors) process.exit(1);

const known = new Set(
  (db().query("SELECT source_id FROM listings WHERE source='facebook'").all() as Array<{ source_id: string }>)
    .map((r) => r.source_id),
);
/**
 * TRIAGE BEFORE OPENING ANYTHING.
 *
 * A "gaming pc" search returns computer desks, computer chairs and laptop bags,
 * and the previous run paid for VISION on a desk, a table and a chair (~3.4
 * cents) because vision was handed to the first N listings whatever they were.
 * Scope is now decided from the card title, before a single detail page is
 * fetched — so a desk costs nothing at all, not even a page load.
 */
const unseen = cards.filter((c) => !known.has(c.sourceId));
const rejected: Array<{ title: string; reason: string }> = [];
/**
 * The crawl requires `tech` — "unknown" is skipped too, which the VERDICT does
 * not do.
 *
 * The asymmetry is deliberate. A crawl is speculative spending on listings
 * nobody asked about, so an unrecognisable title is not worth a page fetch. A
 * pasted link is a direct request, so there the engine still answers. Real tech
 * with an odd title is rescued either way by the model-number rule
 * ("RTX 3080 FE" has no product noun and still resolves to tech).
 */
const inScope = unseen.filter((c) => {
  const p = discoveryDecision(c.title);
  if (!p.keep) {
    rejected.push({ title: c.title, reason: p.reason });
    return false;
  }
  return true;
});
const fresh = inScope.slice(0, limit);
console.log(JSON.stringify({type:'search-quality',source:'facebook',query:arg('query')??'electronics',parsed:cards.length,known:cards.length-unseen.length,eligible:inScope.length,rejected:unseen.length-inScope.length,selected:fresh.length}));

console.log(`\n${cards.length} cards · ${cards.length - unseen.length} already known`);
if (rejected.length) {
  console.log(`\x1b[90m${rejected.length} skipped as not-tech — no page fetched, no vision spend:\x1b[0m`);
  for (const r of rejected.slice(0, 10)) {
    console.log(`  \x1b[90m- ${r.title.slice(0, 42).padEnd(44)} ${r.reason.slice(0, 48)}\x1b[0m`);
  }
  if (rejected.length > 10) console.log(`  \x1b[90m  ...and ${rejected.length - 10} more\x1b[0m`);
}
console.log(`\x1b[1m${fresh.length} to open\x1b[0m\n`);

if (!fresh.length) process.exit(0);
if(has('dry')){for(const card of fresh)console.log(`candidate: ${card.title}`);process.exit(0);}

// Persist discoveries before any per-listing visits. The managed collector
// uploads this batch immediately; a slow detail page cannot hide newer cards.
if(has('cards-only')) {
  let failed=0;
  for(const card of fresh)try{await checkFetched(cardToListing(card),{persist:true,vision:false});}catch{failed++;}
  db().run('INSERT INTO crawls(started_at,discovered,analysed,vision_run,failed,created_at) VALUES(?,?,?,?,?,?)',[startedAt,cards.length,fresh.length-failed,0,failed,now()]);
  console.log(`${fresh.length-failed} new search cards saved; full descriptions await enrichment`);
  process.exit(failed?1:0);
}

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
  if (ev.type === "graphql") { rawCount++; continue; }
  if (ev.type === "error") { console.error(`\x1b[31m  ${ev.msg}\x1b[0m`); workerErrors++; continue; }
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
).run({ $s: startedAt, $d: cards.length, $a: analysed, $v: visionRun, $f: fresh.length - analysed, $n: now() });

console.log(`\ndone · ${analysed} analysed · ${visionRun} with photos read · ${rawCount} graphql payloads seen`);

// Partial facts survive, but a failed detail pass must not turn the crawl button green.
if(workerErrors || analysed < fresh.length) process.exitCode=1;
