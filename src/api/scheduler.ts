/**
 * The production crawl loop — what makes assyze.com a marketplace rather than
 * a search box.
 *
 * **THE PROBLEM.** The deployed app served three Craigslist listings, all more
 * than two weeks old, with `lastCrawl: null`. The comps archive had just been
 * fixed so the engine COULD price — it simply had nothing to price, because
 * `crawl` is a CLI script and nothing in the container ever called it. A deal
 * feed that does not refresh is not a feed.
 *
 * **CRAIGSLIST RUNS HERE. FACEBOOK CANNOT, and that is architectural.**
 * `sources/craigslist.ts` is a plain `fetch()` — no browser, no session, so it
 * works in a container. Facebook Marketplace needs a logged-in Chrome profile
 * (`bun run fb:login` against a real browser Yish signs into by hand), and
 * shipping credentials into a server image is both a security problem and
 * against the rule that no credential handling gets added. Facebook listings
 * therefore have to be crawled locally and pushed.
 *
 * **VISION IS ON, BOUNDED** — Yish's call, 2026-08-26, after noticing his
 * Anthropic bill had not moved. It was `maxVision: 0` while the text layer was
 * still returning wrong answers, because paying to read photos of a listing you
 * are about to misprice is waste on top of waste. The text layer is solid now.
 *
 * **The value is specifically in the listings that CANNOT be priced from text.**
 * The low-knowledge sellers who underprice are exactly the ones who do not
 * write the specs — they photograph the box. `deservesVision` already ranks
 * INSUFFICIENT_DATA alongside BUY and VERIFY for that reason.
 *
 * Three independent bounds, because this loop runs unattended forever:
 *   · `VISION_PER_RUN` listings per crawl, best-looking first
 *   · the $2/day budget, checked before EVERY call inside `crawl()`
 *   · `ASSYZE_VISION=off` kills it outright
 */
import { discover, drain, queueDepth } from "../crawler/queue.ts";
import { visionPass } from "../crawler/vision-pass.ts";
import { sweep } from "../tracker/index.ts";
import { prunePhotos } from "../photos/index.ts";
import { pruneThumbs, backfillThumbs } from "../photos/thumb.ts";
import { runAlerts } from "./alerts.ts";
import { checkStored, ENGINE_VERSION } from "../engine/index.ts";
import { db, now } from "../db/index.ts";
import { storeVerdict } from "../db/verdicts.ts";

/** Gap between ticks. A tick is 5 requests when nothing is new. */
const INTERVAL_MS = Number(process.env.ASSYZE_CRAWL_INTERVAL_MS ?? 3 * 60 * 1000);

/** Listings analysed per run. Bounded so one pass cannot run away. */
const LIMIT = Number(process.env.ASSYZE_CRAWL_LIMIT ?? 40);

/**
 * Listings whose photos get read per TICK.
 *
 * **THIS HAD TO SHRINK WHEN THE TICK GOT 15x FASTER.** It was 8 per 45-minute
 * crawl, about 256 attempts a day. At the new 3-minute cadence the same 8 would
 * be 3,840 a day — measured at $0.0031 a listing, roughly $12/day against a $2
 * budget. The guard would have stopped it, but only after burning the whole
 * day's allowance in about four hours every morning.
 *
 * 3 per tick is ~1,440 attempts a day, and the pool is usually empty anyway
 * because a listing is only a candidate until its photos have been read once.
 *
 * **The $2/day budget is the real bound and it is checked before EVERY
 * listing**, not once per pass — a pass that checks once and then reads three
 * can overshoot by two, and a money guard that can be exceeded is not a guard.
 * This number only decides how fast the budget could be reached.
 */
const VISION_PER_RUN = Number(process.env.ASSYZE_CRAWL_VISION ?? 3);

/** `ASSYZE_VISION=off` kills photo reading without stopping the crawl. */
const VISION_ON = (process.env.ASSYZE_VISION ?? "on").toLowerCase() !== "off";

/** Set `ASSYZE_CRAWL=off` to disable — the local box does not need it. */
const ENABLED = (process.env.ASSYZE_CRAWL ?? "on").toLowerCase() !== "off";

/**
 * How many listings to analyse this run, and how long to wait afterwards.
 *
 * BACKFILL MODE exists because the first crawl found **1,376 live Craigslist
 * listings** and the steady-state limit of 40 would have taken about a day to
 * work through them. A marketplace with nothing in it is not worth waiting a
 * day for, and the analysis is cheap — text-only, no vision, 6 listings in 2
 * seconds. So while the feed is thin, crawl harder and more often; once it has
 * a real backlog, drop to a rate that just keeps up with new posts.
 */
function pace(): { limit: number; nextMs: number; mode: string } {
  const n = (db().query("SELECT COUNT(*) n FROM listings").get() as { n: number }).n;
  if (n < 400) return { limit: LIMIT * 4, nextMs: 3 * 60_000, mode: "backfill" };
  /**
   * STEADY IS NOW 3 MINUTES, NOT 45, AND THAT IS THE POINT OF THE SPLIT LOOP.
   *
   * The old 45-minute interval existed because a tick did discovery AND
   * analysis AND vision together, so running it often meant re-paying for all
   * three. A tick now costs 5 requests and ~1.4s when nothing is new, which is
   * roughly a person refreshing tabs, so it can run constantly.
   *
   * What that buys: detection latency drops from ~22 minutes average (half of
   * 45) to ~90 seconds. Every deal in this market is won on latency — a 4090 at
   * $1,100 is gone within the hour — so this is the difference between a feed
   * you check and a feed that tells you.
   *
   * Analysis stays bounded by `limit`, so a burst of new listings drains over
   * several ticks rather than making one tick run for an hour.
   */
  return { limit: LIMIT, nextMs: INTERVAL_MS, mode: "steady" };
}

/**
 * How often to re-check listings we have already seen.
 *
 * **THIS NEVER RAN IN PRODUCTION AND THAT WAS THE BIGGEST CREDIBILITY BUG IN
 * THE PRODUCT.** `sweep` was written, worked, and had a `package.json` script,
 * but nothing in the container called it — so the feed had never once checked
 * whether any of its listings were still up. 96 of the 200 rows it served on
 * 2026-08-26 were over two weeks old and nothing marked them dead. An app whose
 * entire promise is "worth driving for" was able to send you to something that
 * sold a fortnight ago.
 *
 * Daily, not hourly. A sweep re-fetches every live listing's SEARCH page and
 * then probes the missing ones individually; running it often would multiply
 * our request rate at the source for information that changes on the scale of
 * days. It also produces the clearing-price history that `outcomes` reads, and
 * every day it does not run is history nobody can refetch.
 */
const SWEEP_INTERVAL_MS = Number(process.env.ASSYZE_SWEEP_INTERVAL_MS ?? 24 * 60 * 60 * 1000);
const SWEEP_ON = (process.env.ASSYZE_SWEEP ?? "on").toLowerCase() !== "off";

/**
 * Cap the per-run individual probes.
 *
 * Step 3 of a sweep fetches EVERY listing the search pages did not return, one
 * request each. On the first production sweep that set is the entire backlog of
 * listings that expired while nothing was watching — hundreds of requests in a
 * burst, which is the single most likely way to get the IP blocked. Unprobed
 * listings simply stay live until the next sweep, so the backlog drains over
 * several days instead of arriving as one spike.
 */
const SWEEP_PROBE_LIMIT = Number(process.env.ASSYZE_SWEEP_PROBE ?? 60);

let running = false;
let sweeping = false;

async function runOnce(reason: string) {
  /**
   * Single-flight. The interval does not wait for the previous run, and two
   * overlapping passes double the request rate at the source — the single most
   * likely way to get the IP blocked.
   */
  if (running) { console.log("tick: previous run still going, skipping"); return; }
  running = true;
  const t0 = Date.now();
  const startedAt = now();
  const p = pace();
  const metrics = { discovered: 0, analysed: 0, vision: 0, failed: 0 };
  try {
    // Engine changes reach the FEED only through this. Cheap when nothing is
    // stale, which is every run after the one following a deploy.
    const rescored = reverdictAll();
    if (rescored) console.log(`re-scored ${rescored} listings on engine ${ENGINE_VERSION}`);

    /**
     * New comps, SKUs, aliases and retail quotes do not bump ENGINE_VERSION,
     * but they can change an answer just as much as code. Re-score once when
     * that data signature moves, not 200 unchanged rows on every 3-minute tick.
     * If stale engine rows were just drained, they already saw current data.
     */
    if (rescored) markPricingDataCurrent();
    else {
      const repriced = reverdictWhenPricingDataChanges();
      if (repriced.changed) {
        console.log(`pricing data changed: checked ${repriced.checked}, ${repriced.changed} verdict(s) moved`);
      }
    }

    /**
     * DISCOVER, THEN DRAIN. See `crawler/queue.ts` for why these are separate.
     *
     * Discovery is 5 requests and ~1.4s for the whole Boston feed, so it can
     * run every few minutes. Analysis is bounded per tick, so a 1,300-listing
     * backfill drains over several ticks instead of blocking one for an hour.
     */
    const d = await discover({ onProgress: (m) => console.log(`  discover: ${m}`) });
    const dr = await drain({
      limit: p.limit,
      concurrency: 3,
      onProgress: (m) => console.log(`  drain: ${m}`),
    });
    metrics.discovered = d.seen;
    metrics.analysed = dr.analysed;
    metrics.failed = d.failedPages + dr.failed + dr.dropped;

    /**
     * Alerts fire immediately after the drain, against listings analysed in
     * this very tick. On its own timer they would carry up to a full interval
     * of extra delay, on the one feature whose entire value is latency.
     */
    try {
      const n = await runAlerts();
      if (n) console.log(`alerts: sent ${n} notification(s)`);
    } catch (e) {
      console.error("alerts failed:", (e as Error).message);
    }

    /**
     * Vision runs LAST and only in steady mode. The text verdict has already
     * landed and already fired any alert, so photos refine a listing somebody
     * can act on rather than delaying the news. Backfill reads no photos at
     * all: a 1,300-listing backlog at even a cent each is real money spent
     * before anyone has looked at the feed once.
     */
    let vision = 0;
    if (VISION_ON && p.mode === "steady") {
      try {
        vision = await visionPass(VISION_PER_RUN, (m) => console.log(`  vision: ${m}`));
      } catch (e) {
        console.error("vision pass failed:", (e as Error).message);
      }
    }
    metrics.vision = vision;

    /**
     * ⚠ A FEW THUMBNAILS PER TICK, AND IT IS A RACE AGAINST AN EXPIRY.
     *
     * Facebook's CDN urls last about two days (measured; see
     * `photos/thumb.ts`), and the feed keeps a listing for 28. Anything not
     * copied in that window is a broken image for the rest of the listing's
     * life, and no later pass can recover it. Newly crawled listings get their
     * thumbnail from the bytes `persistPhotos` already downloaded, and pushed
     * ones get theirs at ingest — this is only the BACKLOG, which is why 25 a
     * tick is enough and why it must not be more.
     */
    try {
      const th = await backfillThumbs(25);
      /**
       * ⚠ REPORT THE MISSES, NOT JUST THE HITS. The first version logged only
       * successes, so "cached 5" looked like there were only five to do rather
       * than like twenty had failed — and the ~20% yield that exposed the
       * container's own contention was invisible in the logs for hours.
       */
      if (th.cached || th.missed) {
        console.log(`  thumbnails: cached ${th.cached}, missed ${th.missed} of ${th.tried}`);
      }
    } catch (e) {
      console.error("thumbnail backfill failed:", (e as Error).message);
    }

    const quiet = d.queued === 0 && dr.analysed === 0 && !vision;
    if (!quiet) {
      console.log(
        `tick (${reason}, ${p.mode}) ${Math.round((Date.now() - t0) / 1000)}s — ` +
        `seen ${d.seen} · new ${d.fresh} · queued ${d.queued}` +
        `${d.prioritised ? ` (${d.prioritised} matched a saved search)` : ""} · ` +
        `analysed ${dr.analysed} · queue ${dr.remaining} · vision ${vision}`,
      );
    }
  } catch (e) {
    // Never throw out of the loop: an unhandled rejection here takes down the
    // whole server, and a failed tick is not a reason to stop serving.
    console.error(`tick (${reason}) failed:`, (e as Error).message);
    metrics.failed++;
  } finally {
    recordTick(startedAt, metrics);
    running = false;
  }
}

/**
 * Re-score listings whose latest verdict came from an older engine.
 *
 * **WHY THIS HAS TO BE AUTOMATIC.** The matcher fix that stopped a $5 D-Link
 * Ethernet switch being priced as a Nintendo Switch 2 deployed cleanly — and
 * the two bad rows stayed on the live feed regardless, because the feed reads
 * STORED verdicts and the crawler skips listings it has already seen. Shipping
 * an engine fix therefore did not fix anything a user could see.
 *
 * `verdicts.engine_version` was already recorded and never used. Comparing it
 * to `ENGINE_VERSION` makes every future engine change self-healing: bump the
 * version, deploy, and production re-scores itself.
 *
 * `checkStored` re-runs signals, matching and valuation against the listing
 * text ALREADY in the database — no refetch, no network, no source traffic.
 */
/**
 * DRAIN THE BACKLOG, do not nibble at it.
 *
 * The first version re-scored 400 per crawl tick. That left a multi-tick window
 * where the live feed mixed old and new engine answers after every deploy.
 *
 * Draining is cheap — `checkStored` is a database read plus pure engine work,
 * about two milliseconds each after the condition-multiplier cache, so 936
 * listings take 1.87 seconds. The outer cap exists only so a pathological
 * database cannot spin the boot path forever.
 */
function reverdictAll(max = 5000): number {
  let total = 0;
  for (let pass = 0; pass < 20 && total < max; pass++) {
    const n = reverdictStale(400);
    if (!n) break;
    total += n;
  }
  return total;
}

/**
 * Re-score when valuation data changes without a code change.
 *
 * **`reverdictStale` only reacts to a CODE change** — it selects on
 * `engine_version IS NOT $v`. New DATA moves nothing. So an archive import can
 * add 1,313 comps and 47 SKUs to production and every INSUFFICIENT_DATA
 * verdict keeps its old answer forever, because the engine version it was
 * computed under is still current.
 *
 * That is exactly what happened after the volume was resized: the comps landed,
 * and "GAMING PC: I7 10700 / RTX 2080" still read "not enough component comps
 * to price it" against an archive that now had both parts.
 *
 * The old fix ran every crawl and only retried INSUFFICIENT_DATA. That burned
 * CPU on unchanged rows while leaving a BUY/PASS based on an old comp median
 * untouched forever. The data signature below makes this event-driven and
 * re-checks every stored answer exactly once per pricing-data revision.
 */
interface DataReverdictStats { checked: number; changed: number }

let lastPricingDataSignature: string | null = null;

/** A compact revision for every table that can change valuation without code. */
function pricingDataSignature(): string {
  const r = db().query(`
    SELECT
      (SELECT COALESCE(MAX(id),0) FROM comps) comps,
      (SELECT COALESCE(MAX(id),0) FROM skus) skus,
      (SELECT COALESCE(MAX(id),0) FROM sku_aliases) aliases,
      (SELECT COALESCE(MAX(id),0) FROM retail_prices) retail
  `).get() as { comps: number; skus: number; aliases: number; retail: number };
  return `${r.comps}|${r.skus}|${r.aliases}|${r.retail}`;
}

function markPricingDataCurrent() {
  lastPricingDataSignature = pricingDataSignature();
}

/**
 * Re-score every stored listing once when pricing inputs move.
 *
 * The old query retried the newest 200 INSUFFICIENT_DATA rows every tick. That
 * was both wasteful and incomplete: 268 rows existed, so the oldest 68 could
 * never be revisited, and already-priced listings never saw a changed comp
 * median or retail ceiling at all.
 */
export function reverdictWhenPricingDataChanges(): DataReverdictStats {
  const before = pricingDataSignature();
  if (before === lastPricingDataSignature) return { checked: 0, changed: 0 };

  const d = db();
  const rows = d.query("SELECT id FROM listings ORDER BY id").all() as Array<{ id: number }>;
  let changed = 0;
  for (const r of rows) {
    try {
      const { verdict } = checkStored(r.id, {});
      const stored = storeVerdict(r.id, ENGINE_VERSION, verdict);
      if (stored.inserted) changed++;
    } catch { /* one bad listing must not stop the pass */ }
  }
  // Generative matching may mint SKUs during the pass. Record the final state
  // so that expected side effect does not trigger another full pass next tick.
  lastPricingDataSignature = pricingDataSignature();
  return { checked: rows.length, changed };
}

function reverdictStale(limit = 400): number {
  const d = db();
  const rows = d.query(
    `SELECT l.id FROM listings l
       JOIN verdicts v ON v.id = (SELECT MAX(id) FROM verdicts WHERE listing_id = l.id)
      WHERE v.engine_version IS NOT $v
      ORDER BY l.id LIMIT $lim`,
  ).all({ $v: ENGINE_VERSION, $lim: limit }) as Array<{ id: number }>;
  if (!rows.length) return 0;

  let n = 0;
  for (const r of rows) {
    try {
      const { verdict } = checkStored(r.id, {});
      storeVerdict(r.id, ENGINE_VERSION, verdict);
      n++;
    } catch {
      // One unparseable listing must not stop the sweep.
    }
  }
  return n;
}

/**
 * Keep crawl observability bounded. The split scheduler originally stopped
 * writing `crawls`, so the API's lastCrawl froze on the final pre-split run.
 * Ten thousand 3-minute samples is about three weeks of history and prevents a
 * health table from becoming another unbounded archive.
 */
function recordTick(
  startedAt: string,
  metrics: { discovered: number; analysed: number; vision: number; failed: number },
) {
  try {
    const d = db();
    d.query(
      `INSERT INTO crawls (started_at, discovered, analysed, vision_run, failed, created_at)
       VALUES ($s,$d,$a,$v,$f,$now)`,
    ).run({
      $s: startedAt,
      $d: metrics.discovered,
      $a: metrics.analysed,
      $v: metrics.vision,
      $f: metrics.failed,
      $now: now(),
    });
    d.exec(`DELETE FROM crawls
             WHERE id < (SELECT id FROM crawls ORDER BY id DESC LIMIT 1 OFFSET 9999)`);
  } catch (e) {
    console.error("could not record crawl tick:", (e as Error).message);
  }
}

export function startCrawlLoop() {
  if (!ENABLED) { console.log("crawl loop: disabled (ASSYZE_CRAWL=off)"); return; }

  /**
   * First run is DEFERRED, not immediate.
   *
   * Boot already does the schema, the catalog seed and a 6,247-comp archive
   * import. Starting a crawl on top of that competes for the same SQLite
   * connection during the window the platform is deciding whether the
   * container came up healthy.
   */
  const first = (db().query("SELECT COUNT(*) n FROM listings").get() as { n: number }).n < 20
    ? 30_000        // nearly-empty feed: fill it soon, that is the whole product
    : 5 * 60_000;
  console.log(
    `crawl loop: every ${Math.round(INTERVAL_MS / 60000)}m, ${LIMIT} listings/run, ` +
    `first run in ${Math.round(first / 1000)}s`,
  );

  /**
   * A self-rescheduling chain, NOT `setInterval`.
   *
   * The delay has to be decided AFTER each run, because backfill mode drops it
   * from 45 minutes to 3 and a fixed interval could not switch back once the
   * feed filled. It also means the next run is scheduled from the END of the
   * last one, so a slow crawl can never stack up behind itself.
   */
  const tick = async (reason: string) => {
    await runOnce(reason);
    const p = pace();
    setTimeout(() => void tick("scheduled"), p.nextMs).unref?.();
  };
  setTimeout(() => void tick("first"), first).unref?.();

  if (SWEEP_ON) startSweepLoop();
}

/**
 * The sweep loop, on its own chain rather than folded into the crawl.
 *
 * Two different cadences — 45 minutes against 24 hours — and a sweep must not
 * delay a crawl or vice versa. `sweeping` and `running` are separate flags so
 * they can overlap; they touch different rows and SQLite serialises the writes.
 *
 * The first sweep waits 10 minutes. On a cold container the crawl is the thing
 * that makes the feed non-empty, and sweeping a database that is still filling
 * spends requests re-checking listings we just fetched.
 */
function startSweepLoop() {
  const FIRST_MS = 10 * 60_000;
  console.log(
    `sweep loop: every ${Math.round(SWEEP_INTERVAL_MS / 3600_000)}h, ` +
    `probe cap ${SWEEP_PROBE_LIMIT}, first run in ${Math.round(FIRST_MS / 60000)}m`,
  );

  const tick = async () => {
    if (sweeping) { console.log("sweep: previous run still going, skipping"); return; }
    sweeping = true;
    const t0 = Date.now();
    try {
      const st = await sweep({ pages: 1, probeLimit: SWEEP_PROBE_LIMIT });

      /**
       * Collect orphaned photo folders. Checks release their own photos, but a
       * check that dies between download and release leaves one behind, and
       * without a backstop those are permanent — which is how the volume
       * filled in the first place.
       */
      const pruned = prunePhotos();
      if (pruned.dirs) {
        console.log(`pruned ${pruned.dirs} orphaned photo folders (${(pruned.bytes / 1048576).toFixed(1)} MB)`);
      }

      /**
       * ⚠ AND THE THUMBNAIL CACHE, ON THE SAME SCHEDULE AND FOR THE SAME
       * REASON. It is small by construction (one 480px WebP per listing,
       * ~20 KB) but "small per row" is exactly what the 316 MB of full photos
       * was too. What bounds it is that thumbs for listings the feed can no
       * longer show — delisted, or posted more than 28 days ago — get deleted,
       * and the only thing that runs that is this line. See `photos/thumb.ts`.
       */
      const t = pruneThumbs();
      if (t.deleted) {
        console.log(`pruned ${t.deleted} thumbnails (${(t.freedBytes / 1048576).toFixed(1)} MB freed, ${(t.keptBytes / 1048576).toFixed(1)} MB held)`);
      }
      console.log(
        `sweep done in ${Math.round((Date.now() - t0) / 1000)}s — ` +
        `${st.stillUp} still up, ${st.delisted} delisted, ${st.priceMoves} price moves`,
      );
    } catch (e) {
      // A failed sweep must never take the API down with it. The feed is still
      // correct, just staler than it should be.
      console.error("sweep failed:", (e as Error).message);
    } finally {
      sweeping = false;
      setTimeout(() => void tick(), SWEEP_INTERVAL_MS).unref?.();
    }
  };
  setTimeout(() => void tick(), FIRST_MS).unref?.();
}
