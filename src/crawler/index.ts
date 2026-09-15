/**
 * The crawler — what turns Filtrsoft from a link checker into a marketplace.
 *
 * A feed means analysing EVERYTHING, not one listing on demand. Vision costs
 * ~60s per listing on the CLI, so analysing everything with vision is
 * impossible. The funnel is what makes it work:
 *
 *   1. discover      cheap    every listing in the category
 *   2. text pass     ~5ms     signals + valuation, no AI at all
 *   3. triage        free     is this even plausibly worth photos?
 *   4. vision        ~60s     ONLY on survivors
 *
 * Because the feed reads stored verdicts, serving it is instant no matter how
 * slow analysis is. Analysis is a background job; the feed is a database query.
 */
import { fetchSearchResults } from "../sources/craigslist.ts";
import {CRAIGSLIST_SEARCHES,craigslistQuery,discoveryDecision,hasHardwareCategory} from './search-policy.ts';
import { checkListing } from "../engine/index.ts";
import { resolveProductType } from "../signals/product-type.ts";
import { db, now } from "../db/index.ts";
import { budgetAvailable, spentTodayUsd, DAILY_BUDGET_USD } from "../api/guard.ts";

/** Craigslist categories inside our scope. Cameras are deliberately absent. */
export const CATEGORIES = CRAIGSLIST_SEARCHES;

export interface CrawlStats {
  discovered: number;
  alreadySeen: number;
  analysed: number;
  visionRun: number;
  /**
   * Of those, how many CHANGED the call. **This is the number that says
   * whether vision is worth running unattended**, and it did not exist while
   * vision was off. Cost per change is the honest unit, not cost per read.
   */
  visionChanged: number;
  failed: number;
  worthShowing: number;
}

/**
 * Should this listing get the expensive vision pass?
 *
 * The point is to spend 60 seconds only where it can change the answer. Two
 * cases qualify, and they're the two the product exists for:
 *   - the text pass couldn't value it (specs may be in the photos)
 *   - it looks cheap enough to matter, so the photos decide whether it's real
 *
 * Everything comfortably priced and fully specified is already answered.
 */
function deservesVision(v: { call: string; valuation: { medianCents: number | null } },
                        askingCents: number | null, title = "",
                        missingValueFields: string[] = []): boolean {
  // Never read photos of furniture. A "computers" category crawl surfaces desks
  // and chairs, and INSUFFICIENT_DATA below would otherwise send every one of
  // them to a paid vision call — which is exactly what happened on Facebook.
  if (title && resolveProductType(title).kind !== "tech") return false;
  if (v.call === "OUT_OF_SCOPE") return false;

  /**
   * INSUFFICIENT_DATA IS TWO DIFFERENT PROBLEMS AND ONLY ONE IS A PHOTO
   * PROBLEM. Sending both is how a vision budget gets spent on nothing.
   *
   *   "Can't be valued — cpu not stated"      the spec may be IN a photo. Yes.
   *   "No recent sold comps for this model"   the archive is thin. A photo
   *   "Couldn't identify the exact model"     cannot conjure a comp, and no
   *                                           amount of looking will help.
   *
   * Measured: a Dell 7310 with no comps cost $0.0095 and 15.6 seconds to read
   * six photos, and came back INSUFFICIENT_DATA for exactly the same reason it
   * went in. That is the whole class — and it is the LARGEST slice of
   * INSUFFICIENT_DATA, so gating on it is most of the cost.
   *
   * `missingValueFields` is the signal layer already saying "the seller did not
   * state X", which is precisely the case where a photo can.
   */
  if (v.call === "INSUFFICIENT_DATA") return missingValueFields.length > 0;
  if (v.call === "BUY" || v.call === "VERIFY") return true;
  if (v.call === "RISK") return true;                // confirm before we accuse
  // FAIR / PASS: only if it's near enough the line that photos could move it.
  const med = v.valuation.medianCents;
  if (med && askingCents && askingCents < med * 0.8) return true;
  return false;
}

export async function crawl(opts: {
  categories?: string[];
  pages?: number;
  maxVision?: number;
  /** Cap new listings analysed this run. Keeps a crawl bounded. */
  limit?: number;
  /** Parallel text passes. Each is one fetch; don't hammer the source. */
  concurrency?: number;
  onProgress?: (msg: string) => void;
} = {}): Promise<CrawlStats> {
  const cats = opts.categories ?? CATEGORIES.map((c) => c.cat);
  const pages = opts.pages ?? 1;
  const maxVision = opts.maxVision ?? 10;
  const log = opts.onProgress ?? (() => {});
  const st: CrawlStats = { discovered: 0, alreadySeen: 0, analysed: 0, visionRun: 0, visionChanged: 0, failed: 0, worthShowing: 0 };

  const seen = new Set(
    (db().query("SELECT source_id FROM listings").all() as Array<{ source_id: string }>)
      .map((r) => r.source_id),
  );

  // ---- 1. discover ----------------------------------------------------
  const urls: string[] = [];
  for (const cat of cats) {
    for (let p = 0; p < pages; p++) {
      try {
        const found = await fetchSearchResults(cat,p*120,craigslistQuery(cat));
        const selected=found.filter(r=>discoveryDecision(r.title,hasHardwareCategory('craigslist',cat)).keep);
        urls.push(...selected.map(r=>r.url));
        log(`  ${cat} p${p + 1}: ${found.length} cards, ${selected.length} tech candidates`);
      } catch (e) {
        log(`  ${cat} p${p + 1}: FAILED ${(e as Error).message}`);
      }
    }
  }

  const unique = [...new Set(urls)];
  st.discovered = unique.length;
  const fresh = unique.filter((u) => !seen.has(u.split("/").pop() ?? u));
  st.alreadySeen = unique.length - fresh.length;
  log(`\n${st.discovered} found · ${st.alreadySeen} already known · ${fresh.length} new`);

  // ---- 2+3. text pass on everything, triage for photos -----------------
  // Runs in small parallel batches: each check is one HTTP fetch plus ~5ms of
  // compute, so it is network-bound. Sequential made a 100-listing crawl take
  // minutes for no reason; 6 at a time is polite and roughly 6x faster.
  const candidates: Array<{ url: string; id: number; call: string }> = [];
  const todo = opts.limit ? fresh.slice(0, opts.limit) : fresh;
  const conc = opts.concurrency ?? 6;

  for (let i = 0; i < todo.length; i += conc) {
    const batch = todo.slice(i, i + conc);
    await Promise.all(batch.map(async (url) => {
      try {
        const r = await checkListing(url, { persist: true, vision: false });
        st.analysed++;
        if (r.listingId && deservesVision(r.verdict as any, r.listing.askingPriceCents, r.listing.title, r.signals?.missingValueFields ?? [])) {
          candidates.push({ url, id: r.listingId, call: r.verdict.call });
        }
      } catch {
        st.failed++;
      }
    }));
    log(`  analysed ${Math.min(i + conc, todo.length)}/${todo.length}`);
  }
  log(`\n${st.analysed} analysed · ${candidates.length} deserve photos`);

  // ---- 4. vision on the shortlist, best-looking first ------------------
  const order = { BUY: 0, VERIFY: 1, RISK: 2, INSUFFICIENT_DATA: 3 } as Record<string, number>;
  candidates.sort((a, b) => (order[a.call] ?? 9) - (order[b.call] ?? 9));

  /**
   * THE DAILY BUDGET IS CHECKED HERE, not just at the HTTP layer.
   *
   * `budgetAvailable()` guarded `/v1/checks` and nothing else, so the crawler
   * could spend without limit — which was survivable only because the crawl
   * loop ran with `maxVision: 0`. Turning vision ON for an unattended loop
   * without this is precisely how a $2/day cap becomes a surprise bill: the
   * loop wakes every 45 minutes forever and never asks anyone.
   *
   * Checked before EVERY call, not once per run, because the run itself is
   * what spends the money.
   */
  const startedUsd = spentTodayUsd();
  for (const c of candidates.slice(0, maxVision)) {
    if (!budgetAvailable()) {
      log(`  vision budget reached ($${spentTodayUsd().toFixed(3)} of $${DAILY_BUDGET_USD}) — stopping after ${st.visionRun}`);
      break;
    }
    try {
      const after = await checkListing(c.url, { persist: true, vision: true });
      st.visionRun++;
      /**
       * MEASURE WHETHER VISION EARNED ITS COST. It is ~$0.01-0.02 a listing,
       * and the case for running it unattended is a theory — that the sellers
       * who underprice are the ones who photograph the box instead of writing
       * the specs. Two hand-run calls on 2026-08-26 changed nothing, which is
       * not enough to conclude either way but is enough to stop assuming.
       *
       * Logging the before/after call is what turns "it should help" into a
       * number somebody can decide on after a week.
       */
      if (after.verdict.call !== c.call) {
        st.visionChanged++;
        log(`  photos CHANGED ${c.call} -> ${after.verdict.call}: ${c.url.split("/").slice(-2)[0].slice(0, 36)}`);
      } else {
        log(`  photos kept ${c.call}: ${c.url.split("/").slice(-2)[0].slice(0, 36)}`);
      }
    } catch {
      st.failed++;
    }
  }
  if (st.visionRun) {
    const spent = spentTodayUsd() - startedUsd;
    log(
      `  vision: ${st.visionRun} read · ${st.visionChanged} changed the call · ` +
      `$${spent.toFixed(4)} this run ($${(spent / Math.max(1, st.visionChanged)).toFixed(3)} per change) · ` +
      `$${spentTodayUsd().toFixed(3)} today`,
    );
  }

  st.worthShowing = (db().query(
    `SELECT COUNT(DISTINCT listing_id) n FROM verdicts
     WHERE call IN ('BUY','VERIFY') AND id IN (SELECT MAX(id) FROM verdicts GROUP BY listing_id)`,
  ).get() as { n: number }).n;

  db().query(
    `INSERT INTO crawls (started_at, discovered, analysed, vision_run, failed, created_at)
     VALUES ($s,$d,$a,$v,$f,$n)`,
  ).run({ $s: now(), $d: st.discovered, $a: st.analysed, $v: st.visionRun, $f: st.failed, $n: now() });

  return st;
}
