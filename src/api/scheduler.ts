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
 * **VISION IS OFF IN THIS LOOP** (`maxVision: 0`). The budget guard is $2/day
 * and an unattended loop is exactly how you wake up to it spent on listings
 * nobody asked about. The text layer produces every risk signal that matters;
 * vision runs on demand when someone actually opens a listing.
 */
import { crawl } from "../crawler/index.ts";
import { db } from "../db/index.ts";

/** Wall-clock gap between crawls. Craigslist does not turn over faster. */
const INTERVAL_MS = Number(process.env.ASSYZE_CRAWL_INTERVAL_MS ?? 45 * 60 * 1000);

/** Listings analysed per run. Bounded so one pass cannot run away. */
const LIMIT = Number(process.env.ASSYZE_CRAWL_LIMIT ?? 40);

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

let running = false;

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
    const st = await crawl({
      limit: p.limit,
      pages: 1,
      maxVision: 0,
      concurrency: 3,
      onProgress: (m) => console.log(`  crawl: ${m}`),
    });
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
}
