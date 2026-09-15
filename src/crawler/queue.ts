/**
 * Split-loop crawling: DISCOVERY is cheap, ANALYSIS is what costs.
 *
 * **THE MEASUREMENT THAT DECIDES THE DESIGN.** One discovery pass over all five
 * Craigslist categories is **5 requests and 1.35 seconds**, returning ~1,357
 * listing ids. Finding out *whether* something new exists is nearly free.
 * Deciding *what it is worth* is the expensive part — a fetch of the detail
 * page, the engine, and sometimes a paid vision call.
 *
 * The old loop did both together every 45 minutes, which is fatal for alerts.
 * A 4090 at $1,100 posted at 2:03pm is gone by 2:30; a 45-minute cycle means an
 * average detection delay of 22 minutes and a worst case of 45, before analysis
 * even starts. You would be alerted to deals that are already gone, which is
 * worse than no alert because it teaches you to ignore the notification.
 *
 * "Just crawl faster" does not work: analysis is the expensive half, most
 * cycles find nothing (the last production crawl analysed **0** new listings),
 * and hammering the source is how the crawler gets blocked — which would take
 * the delisting tracker and the comps archive with it.
 *
 * So: discover often and cheaply, queue what is new, and drain the queue at
 * whatever rate is affordable. Cost then tracks NEW-LISTING VOLUME rather than
 * wall-clock. On a quiet night the loop does five requests and stops.
 *
 * ── WHY A TABLE AND NOT AN IN-MEMORY ARRAY ─────────────────────────────────
 *
 * Backfill discovers ~1,300 listings at once and the container restarts on
 * every deploy. An in-memory queue loses the backlog on each restart and the
 * same listings get rediscovered forever, so the work never finishes. The queue
 * survives restarts because it is a table.
 */
import { db, now } from "../db/index.ts";
import { fetchSearchResults } from "../sources/craigslist.ts";
import { CATEGORIES } from "./index.ts";
import { checkListing } from "../engine/index.ts";
import {craigslistQuery,discoveryDecision,hasHardwareCategory} from './search-policy.ts';

export interface DiscoverStats {
  seen: number;
  fresh: number;
  queued: number;
  prioritised: number;
  failedPages: number;
  skipped: number;
  ms: number;
}

export function ensureQueue() {
  db().run(`
    CREATE TABLE IF NOT EXISTS crawl_queue (
      url           TEXT PRIMARY KEY,
      source_id     TEXT NOT NULL,
      title         TEXT,
      priority      INTEGER NOT NULL DEFAULT 0,
      attempts      INTEGER NOT NULL DEFAULT 0,
      discovered_at TEXT NOT NULL
    )`);
  db().run("CREATE INDEX IF NOT EXISTS idx_queue_order ON crawl_queue(priority DESC, discovered_at ASC)");
}

/**
 * Titles that somebody is waiting on, so their listings can jump the queue.
 *
 * **The alert path must be the FASTEST path through the system**, not the
 * slowest. A saved search is a standing request; a listing that satisfies one
 * is worth more than a listing that satisfies nobody, and analysing it 40
 * minutes later than it could have been is the whole failure this redesign
 * exists to fix.
 *
 * Read once per discovery pass rather than per listing — it is a handful of
 * rows and the pass compares every title against all of them.
 */
function savedSearchTerms(): string[][] {
  try {
    const rows = db().query(
      "SELECT query FROM saved_searches WHERE query IS NOT NULL AND query != ''",
    ).all() as Array<{ query: string }>;
    return rows.map((r) => r.query.toLowerCase().split(/\s+/).filter(Boolean));
  } catch {
    // The alerts tables may not exist yet on a fresh volume. No searches is a
    // perfectly good answer.
    return [];
  }
}

/**
 * Fetch the search pages, queue anything not already known.
 *
 * Uses `fetchSearchResults` rather than `fetchSearchUrls` because it returns
 * the TITLE in the same request, at no extra cost, which is what lets a
 * saved-search match be prioritised before the detail page is ever fetched.
 */
export async function discover(opts: {
  categories?: string[];
  onProgress?: (m: string) => void;
} = {}): Promise<DiscoverStats> {
  ensureQueue();
  const t0 = Date.now();
  const cats = opts.categories ?? CATEGORIES.map((c) => c.cat);
  const log = opts.onProgress ?? (() => {});
  const st: DiscoverStats = { seen: 0, fresh: 0, queued: 0, prioritised: 0, failedPages: 0, skipped:0, ms: 0 };

  const known = new Set(
    (db().query("SELECT source_id FROM listings").all() as Array<{ source_id: string }>)
      .map((r) => r.source_id),
  );
  const terms = savedSearchTerms();

  const ins = db().prepare(
    `INSERT INTO crawl_queue (url, source_id, title, priority, discovered_at)
     VALUES ($u,$s,$t,$p,$d) ON CONFLICT(url) DO NOTHING`,
  );

  for (const cat of cats) {
    try {
      const found = await fetchSearchResults(cat, 0,craigslistQuery(cat));
      st.seen += found.length;
      for (const r of found) {
        if (known.has(r.sourceId)) continue;
        st.fresh++;
        if(!discoveryDecision(r.title,hasHardwareCategory('craigslist',cat)).keep){st.skipped++;continue;}
        /**
         * EVERY word of a saved search must appear, the same rule the alert
         * matcher uses. "rtx 4090" prioritising on "rtx" alone would put every
         * graphics card at the front of the queue, which is the same as having
         * no priority at all.
         */
        const hay = r.title.toLowerCase();
        const hit = terms.length > 0 && terms.some((ws) => ws.every((w) => hay.includes(w)));
        if (hit) st.prioritised++;
        const res = ins.run({ $u: r.url, $s: r.sourceId, $t: r.title, $p: hit ? 1 : 0, $d: now() });
        if (res.changes) st.queued++;
      }
    } catch (e) {
      // A failed page is a coverage hole, not an empty category. Never treat it
      // as "nothing new" — that would be indistinguishable from success.
      st.failedPages++;
      log(`  ${cat}: FAILED ${(e as Error).message}`);
    }
  }

  st.ms = Date.now() - t0;
  return st;
}

export interface DrainStats {
  analysed: number;
  failed: number;
  dropped: number;
  remaining: number;
}

/**
 * Analyse queued listings, highest priority and oldest first.
 *
 * Text-only. Vision is deliberately NOT run here: the text verdict is what
 * fires an alert, and making somebody wait on a photo read to be told about a
 * 4090 spends the latency this whole design exists to recover. Photos are read
 * afterwards by the separate vision pass.
 */
export async function drain(opts: {
  limit?: number;
  concurrency?: number;
  onProgress?: (m: string) => void;
} = {}): Promise<DrainStats> {
  ensureQueue();
  const limit = opts.limit ?? 40;
  const conc = opts.concurrency ?? 6;
  const log = opts.onProgress ?? (() => {});
  const st: DrainStats = { analysed: 0, failed: 0, dropped: 0, remaining: 0 };

  const rows = db().query(
    `SELECT url, attempts FROM crawl_queue
      ORDER BY priority DESC, discovered_at ASC LIMIT $lim`,
  ).all({ $lim: limit }) as Array<{ url: string; attempts: number }>;
  if (!rows.length) return st;

  const del = db().prepare("DELETE FROM crawl_queue WHERE url = $u");
  const bump = db().prepare("UPDATE crawl_queue SET attempts = attempts + 1 WHERE url = $u");

  for (let i = 0; i < rows.length; i += conc) {
    await Promise.all(rows.slice(i, i + conc).map(async (r) => {
      try {
        await checkListing(r.url, { persist: true, vision: false });
        del.run({ $u: r.url });
        st.analysed++;
      } catch {
        /**
         * THREE STRIKES, THEN DROP. A listing deleted between discovery and
         * analysis fails forever, and without a ceiling it would be retried on
         * every tick until the end of time — a slow, permanent, self-inflicted
         * load on the source.
         */
        if (r.attempts >= 2) { del.run({ $u: r.url }); st.dropped++; }
        else { bump.run({ $u: r.url }); st.failed++; }
      }
    }));
  }

  st.remaining = (db().query("SELECT COUNT(*) n FROM crawl_queue").get() as { n: number }).n;
  log(`  drained ${st.analysed}, ${st.remaining} left`);
  return st;
}

export function queueDepth(): number {
  try {
    ensureQueue();
    return (db().query("SELECT COUNT(*) n FROM crawl_queue").get() as { n: number }).n;
  } catch { return 0; }
}
