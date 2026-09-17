/**
 * The production crawl loop — what makes filtrsoft.com a marketplace rather than
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
 *   · `FILTRSOFT_VISION=off` kills it outright
 */
import { discover, drain, queueDepth } from "../crawler/queue.ts";
import { visionPass } from "../crawler/vision-pass.ts";
import { autoQueueCrawl } from "./jobs.ts";
import {startServerBackups} from './server-backup.ts';
import { sweep,sweepRecommendations } from "../tracker/index.ts";
import { prunePhotos } from "../photos/index.ts";
import { pruneThumbs, backfillThumbs } from "../photos/thumb.ts";
import { runAlerts } from "./alerts.ts";
import { pruneSessions } from "./auth.ts";
import { checkStored, ENGINE_VERSION } from "../engine/index.ts";
import { db, now } from "../db/index.ts";
import { scorePending } from "../db/scoring.ts";
import { retireRepeatedAppliances } from "../db/retire-appliances.ts";

/** Gap between ticks. A tick is 5 requests when nothing is new. */
const INTERVAL_MS = Number(process.env.FILTRSOFT_CRAWL_INTERVAL_MS ?? 3 * 60 * 1000);

/** Listings analysed per run. Bounded so one pass cannot run away. */
const LIMIT = Number(process.env.FILTRSOFT_CRAWL_LIMIT ?? 40);

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
/**
 * ⚠ RAISED FROM 3 TO 10 ON 2026-09-04, AND THE MONEY GUARD IS WHY THAT IS SAFE.
 *
 * Diagnosing Yish's *"the cant tells start around listing 200 out of 1000"*:
 * of 1,193 unpriceable listings, **692 are unpriceable only because a spec is
 * not stated in the text** — storage 326, gpu 162, cpu 133, ram 71. **653 of
 * those have photos, and vision had read 37 of them.** A photo of a spec
 * sticker or a Settings screen is exactly where that number lives.
 *
 * At 3 per tick the backlog was moving at about 96 reads a day against a $2
 * daily ceiling of which **five cents** was being spent. The whole 653-listing
 * backlog costs about $3.60. The ceiling, not this number, is the real bound —
 * `visionPass` checks the budget before EVERY listing, so the worst case of
 * raising this is that the budget is reached earlier in the day.
 */
const VISION_PER_RUN = Number(process.env.FILTRSOFT_CRAWL_VISION ?? 10);

/** `FILTRSOFT_VISION=off` kills photo reading without stopping the crawl. */
const VISION_ON = (process.env.FILTRSOFT_VISION ?? "on").toLowerCase() !== "off";

/**
 * ⚠ EXPORTED SO `/v1/health` CAN REPORT WHAT THE LOOP ACTUALLY SEES.
 *
 * There are TWO independent vision switches reading TWO different env vars,
 * and health only ever reported one of them:
 *
 *     visionKilled()  -> FILTRSOFT_VISION_ENABLED === "0"   (the kill switch)
 *     VISION_ON       -> FILTRSOFT_VISION !== "off"         (this loop)
 *
 * So `visionEnabled: true` was compatible with the pass never running once.
 * Diagnosing "no reads in three days" cost an hour partly because of this.
 * Anything that can stop the pass has to be visible from outside it.
 */
export const visionLoopEnabled = () => VISION_ON;
export const crawlPaceMode = () => pace().mode;

/** Set `FILTRSOFT_CRAWL=off` to disable — the local box does not need it. */
const ENABLED = (process.env.FILTRSOFT_CRAWL ?? "on").toLowerCase() !== "off";

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
const SWEEP_INTERVAL_MS = Number(process.env.FILTRSOFT_SWEEP_INTERVAL_MS ?? 24 * 60 * 60 * 1000);
const SWEEP_ON = (process.env.FILTRSOFT_SWEEP ?? "on").toLowerCase() !== "off";

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
/**
 * ⚠ RAISED 60 -> 150 ON 2026-08-31, AND THE CAP IS STILL THE POINT.
 *
 * Measured: a sweep sees ~660 listings in the search pages against ~990 live,
 * so ~330 are candidates for an individual probe and only 60 got one. At a
 * daily cadence that is a five-day drain on a backlog that grows every day —
 * which is why production had marked 7 of 725 delisted and Yish was looking at
 * listings that had already sold.
 *
 * 150 in one daily pass is still far below anything a marketplace would notice,
 * and the burst reasoning that set 60 stands: unprobed listings simply stay
 * live until tomorrow, so the backlog drains over days rather than arriving as
 * one spike.
 */
const SWEEP_PROBE_LIMIT = Number(process.env.FILTRSOFT_SWEEP_PROBE ?? 150);

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
    const retiredAppliances = retireRepeatedAppliances();
    if (retiredAppliances.length) console.log(`retired ${retiredAppliances.length} repeated household appliance listings`);
    const rescored=scorePending(50);
    if(rescored.checked || rescored.failed) console.log(`re-score: ${rescored.checked} checked, ${rescored.changed} changed, ${rescored.failed} failed, ${rescored.pending} pending`);

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
    // Delivery has its own timer below so a slow/disabled Craigslist crawl
    // cannot strand recommendations uploaded by the desktop.

    /**
     * Vision runs LAST and only in steady mode. The text verdict has already
     * landed and already fired any alert, so photos refine a listing somebody
     * can act on rather than delaying the news. Backfill reads no photos at
     * all: a 1,300-listing backlog at even a cent each is real money spent
     * before anyone has looked at the feed once.
     */
    // Enrichment has independent single-flight timers below.
    const vision=0;
    /**
     * ⚠ START A BROWSER CRAWL BY OURSELVES IF HIS PC IS ON. Yish, 2026-09-04:
     * *"if I have to even think to crawl then that adds friction."* The button
     * exists so a crawl can be started from a phone; it was never meant to be
     * the only way one ever begins. `autoQueueCrawl` refuses unless an agent is
     * actively polling, so this never builds a queue that fires all at once
     * when his machine next boots.
     */
    try { autoQueueCrawl((m) => console.log(`  ${m}`)); }
    catch (e) { console.error("auto-queue failed:", (e as Error).message); }

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
/** Bounded passes yield to discovery; durable per-row checkpoints resume next tick. */
export function reverdictWhenPricingDataChanges() { return scorePending(400); }
export function reverdictStale(limit=400):number { return scorePending(limit).checked; }

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
  startServerBackups();
  const deliver=async()=>{try{const n=await runAlerts();if(n)console.log(`alerts: sent ${n}`);}
    catch(e){console.error('alerts failed',String(e));}finally{setTimeout(()=>void deliver(),30000).unref?.();}};
  setTimeout(()=>void deliver(),30000).unref?.();
  // Scoring uploaded PC evidence must continue even when server discovery is off.
  const scoring=()=>{try{scorePending(50);}catch(e){console.error('scoring failed',String(e));}
    finally{setTimeout(scoring,1000).unref?.();}};
  setTimeout(scoring,5000).unref?.();
  if (!ENABLED) { console.log("crawl loop: disabled (FILTRSOFT_CRAWL=off)"); return; }

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

  // Schedule from start time, skipping overlap rather than accumulating ticks.
  const tick=async()=>{
    const started=Date.now();await runOnce("scheduled");
    setTimeout(()=>void tick(),Math.max(1000,pace().nextMs-(Date.now()-started))).unref?.();
  };
  setTimeout(()=>void tick(),first).unref?.();
  const enrichment=(work:()=>Promise<unknown>,every:number)=>{
    const step=async()=>{try {await work();}catch(e){console.error("enrichment failed",String(e));}
      finally {setTimeout(()=>void step(),every).unref?.();}};
    setTimeout(()=>void step(),first+1000).unref?.();
  };
  enrichment(async()=>{if(VISION_ON && pace().mode==='steady') await visionPass(VISION_PER_RUN,m=>console.log(`vision: ${m}`));},INTERVAL_MS);
  enrichment(async()=>{await backfillThumbs(25);},INTERVAL_MS);
  // Small scoring chunks yield to HTTP and discovery between transactions.
  enrichment(async()=>{if(SWEEP_ON){const result=await sweepRecommendations();if(result.checked||result.unknown)console.log('recommendation availability',JSON.stringify(result));}},30*60000);

  if (SWEEP_ON) startSweepLoop();
}

/**
 * The sweep loop, on its own chain rather than folded into the crawl.
 *
 * Two different cadences — 45 minutes against 24 hours — and a sweep must not
 * delay a crawl or vice versa. `sweeping` and `running` are separate flags so
 * they can overlap; they touch different rows and SQLite serialises the writes.
 *
 * ⚠ THE FIRST RUN IS SCHEDULED FROM THE LAST SWEEP, NOT FROM BOOT, AND THAT IS
 * A BUG FIX, NOT A REFINEMENT.
 *
 * It used to be a flat `setTimeout(tick, 10 minutes)` on every start, with the
 * 24-hour interval only re-armed AFTER a run. Nothing persisted when the last
 * sweep happened. So on a service that deploys often — and this one deployed
 * about fifteen times in five hours on 2026-08-31 — every restart pushed the
 * first sweep ten minutes into the future, and a deploy landing inside that
 * window reset it again. **The sweep can starve indefinitely while every log
 * line says the loop started.**
 *
 * The evidence: local sweeps ran on 08-27, 08-29 and 08-31 against a DAILY
 * interval, and production had marked **7 of 725** listings delisted. Yish:
 * *"there's a bunch of listings on Filtrsoft that are sold already, so once
 * something is sold it should get removed."* He was looking at the symptom of a
 * timer that could never fire.
 *
 * The `sweeps` table has recorded `started_at` all along and nothing read it.
 *
 * A cold container still gets a short head start, because the crawl is what
 * makes the feed non-empty and sweeping a database that is still filling spends
 * requests re-checking listings we just fetched. But 90 seconds, not ten
 * minutes, and only when we are not already overdue.
 */
function startSweepLoop() {
  const last = db()
    .query("SELECT started_at FROM sweeps ORDER BY id DESC LIMIT 1")
    .get() as { started_at: string } | null;
  const since = last ? Date.now() - Date.parse(last.started_at) : Infinity;
  const overdue = since >= SWEEP_INTERVAL_MS;
  const FIRST_MS = overdue
    ? 90_000
    : Math.max(90_000, SWEEP_INTERVAL_MS - since);
  console.log(
    `sweep loop: every ${Math.round(SWEEP_INTERVAL_MS / 3600_000)}h, ` +
    `probe cap ${SWEEP_PROBE_LIMIT}, ` +
    `last ${last ? `${Math.round(since / 3600_000)}h ago` : "never"}, ` +
    `first run in ${Math.round(FIRST_MS / 60000)}m`,
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
      /**
       * ⚠ EXPIRED SESSIONS ARE DELETED HERE, NOT ON READ. `currentUser` runs
       * on every authenticated request, and putting a DELETE on that path
       * means taking a SQLite write lock during a burst of reads. The rows are
       * already unusable — the session query filters on `expires_at` — so this
       * is housekeeping, not enforcement, and it belongs on the slow loop.
       */
      const sessions = pruneSessions();
      if (sessions) console.log(`pruned ${sessions} expired session(s)`);
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
