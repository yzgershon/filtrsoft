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
import { crawl } from "../crawler/index.ts";
import { sweep } from "../tracker/index.ts";
import { prunePhotos } from "../photos/index.ts";
import { runAlerts } from "./alerts.ts";
import { checkStored, ENGINE_VERSION } from "../engine/index.ts";
import { db, now } from "../db/index.ts";

/** Wall-clock gap between crawls. Craigslist does not turn over faster. */
const INTERVAL_MS = Number(process.env.ASSYZE_CRAWL_INTERVAL_MS ?? 45 * 60 * 1000);

/** Listings analysed per run. Bounded so one pass cannot run away. */
const LIMIT = Number(process.env.ASSYZE_CRAWL_LIMIT ?? 40);

/**
 * Listings whose photos get read per crawl run.
 *
 * Deliberately small. At Haiku rates a listing runs well under a cent, so 8 per
 * run against a 45-minute steady cadence is a few dollars a month — but the
 * $2/day guard inside `crawl()` is what actually enforces the ceiling, and it
 * is checked before every single call. This number only decides how fast the
 * budget could be reached, never whether it can be exceeded.
 */
const VISION_PER_RUN = Number(process.env.ASSYZE_CRAWL_VISION ?? 8);

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
   * A single-flight guard, because the interval does not wait for the previous
   * run. A slow crawl overlapping itself double-counts `discovered`, races on
   * the `seen` set and doubles the request rate at the source — the one thing
   * most likely to get the IP blocked.
   */
  if (running) { console.log("crawl: previous run still going, skipping"); return; }
  running = true;
  const t0 = Date.now();
  const p = pace();
  try {
    // Engine changes reach the FEED only through this. Cheap when there is
    // nothing stale, which is every run after the one following a deploy.
    const rescored = reverdictAll();
    if (rescored) console.log(`re-scored ${rescored} listings on engine ${ENGINE_VERSION}`);

    // New comps do not bump the engine version, so nothing above notices them.
    const repriced = reverdictUnpriced();
    if (repriced) console.log(`priced ${repriced} previously-unpriceable listings`);

    const st = await crawl({
      limit: p.limit,
      pages: 1,
      /**
       * Backfill mode reads NO photos. It exists to fill an empty feed fast,
       * and a 1,376-listing backlog at even a cent each is real money spent
       * before anyone has looked at the feed once. Vision starts when the
       * crawl settles into keeping up with new posts.
       */
      maxVision: VISION_ON && p.mode === "steady" ? VISION_PER_RUN : 0,
      concurrency: 3,
      onProgress: (m) => console.log(`  crawl: ${m}`),
    });
    /**
     * Alerts fire AFTER the crawl, so a saved search is matched against
     * listings that were analysed in this very run. Doing it on its own timer
     * would add up to a whole interval of delay to the one feature whose
     * entire value is latency.
     */
    try {
      const n = await runAlerts();
      if (n) console.log(`alerts: sent ${n} notification(s)`);
    } catch (e) {
      // Never let a push failure abort the crawl bookkeeping below.
      console.error("alerts failed:", (e as Error).message);
    }

    console.log(
      `crawl (${reason}, ${p.mode}) done in ${Math.round((Date.now() - t0) / 1000)}s — ` +
      `${st.discovered} discovered · ${st.alreadySeen} seen · ${st.analysed} analysed · ` +
      `${st.worthShowing} worth showing · ${st.failed} failed`,
    );
  } catch (e) {
    // Never throw out of the loop: an unhandled rejection here takes down the
    // whole server, and a failed crawl is not a reason to stop serving.
    console.error(`crawl (${reason}) failed:`, (e as Error).message);
  } finally {
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
 * The first version re-scored 400 per crawl tick. That is fine during backfill
 * (a tick every 3 minutes) and useless afterwards: once the feed passes 400
 * listings the loop drops to steady mode at 45-minute ticks, so a 945-listing
 * backlog took over two hours to clear. An engine fix that reaches users in
 * two hours has not really shipped.
 *
 * Draining is cheap — `checkStored` is a database read plus pure engine work,
 * around a millisecond each, so the whole backlog is about a second. The outer
 * cap exists only so a pathological database cannot spin the boot path forever.
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
 * Re-score listings that could not be priced.
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
 * Runs every crawl rather than being wired to the import, so it self-heals no
 * matter how comps arrive — archive import, a local push, a manual pull.
 * Cheap: these are pure recomputation with no network, and it is bounded.
 *
 * Only INSUFFICIENT_DATA. A listing that already has a real price does not
 * need re-deriving on a schedule, and re-scoring everything every 45 minutes
 * would burn the box for nothing.
 */
function reverdictUnpriced(limit = 200): number {
  const d = db();
  const rows = d.query(
    `SELECT l.id FROM listings l
       JOIN verdicts v ON v.id = (SELECT MAX(id) FROM verdicts WHERE listing_id = l.id)
      WHERE v.call = 'INSUFFICIENT_DATA' AND l.delisted_at IS NULL
      ORDER BY l.id DESC LIMIT $lim`,
  ).all({ $lim: limit }) as Array<{ id: number }>;
  if (!rows.length) return 0;

  const ins = d.query(
    `INSERT INTO verdicts (listing_id, engine_version, call, confidence, payload, created_at)
     VALUES ($lid,$v,$call,$conf,$p,$now)`,
  );
  let changed = 0;
  for (const r of rows) {
    try {
      const { verdict } = checkStored(r.id, {});
      // Only write when the answer actually moved. A no-op insert per listing
      // per crawl would grow the verdicts table without adding information.
      if (verdict.call === "INSUFFICIENT_DATA") continue;
      ins.run({
        $lid: r.id, $v: ENGINE_VERSION, $call: verdict.call,
        $conf: verdict.confidence, $p: JSON.stringify(verdict), $now: now(),
      });
      changed++;
    } catch { /* one bad listing must not stop the pass */ }
  }
  return changed;
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

  const ins = d.query(
    `INSERT INTO verdicts (listing_id, engine_version, call, confidence, payload, created_at)
     VALUES ($lid,$v,$call,$conf,$p,$now)`,
  );
  let n = 0;
  for (const r of rows) {
    try {
      const { verdict } = checkStored(r.id, {});
      ins.run({
        $lid: r.id, $v: ENGINE_VERSION, $call: verdict.call,
        $conf: verdict.confidence, $p: JSON.stringify(verdict), $now: now(),
      });
      n++;
    } catch {
      // One unparseable listing must not stop the sweep.
    }
  }
  return n;
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
