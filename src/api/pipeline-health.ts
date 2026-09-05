/**
 * Is the pipeline actually working? Two questions health could not answer.
 *
 * Yish, 2026-09-03: *"there hasnt been a verify first or buy it listing thats
 * come in in the past 3 days I just want to make sure everything is still
 * working ... i think all the listings that have come in passively have been
 * cant tells."*
 *
 * Diagnosing that took an hour of pulling the live feed apart, and the two
 * things that turned out to matter were both INVISIBLE from outside:
 *
 *   1. **Whether vision ever runs.** `spentTodayUsd: 0` is ambiguous — it means
 *      either "nothing needed a photo read" or "the pass is broken", and those
 *      have opposite fixes.
 *   2. **Whether the comps have gone stale.** `valueSku` only counts a sale
 *      inside a **90-day window**, and the comps arrive frozen in a shipped
 *      archive. So the priceable share of the catalog DECAYS on its own, with
 *      no error anywhere, and the symptom is exactly what he reported: fewer
 *      and fewer real verdicts until the feed is all "can't tell".
 *
 * ⚠ THE SECOND ONE IS A CLOCK, NOT A STATE. Nothing here refills comps — that
 * is `bun run ebay:comps` on a machine with his eBay login — so "fine today"
 * is not "fine". `daysOfRunway` is the number that matters, and it only ever
 * goes down.
 */
import { db } from "../db/index.ts";

export interface CompsHealth {
  total: number;
  usable: number;
  /** Newest sale we hold. If this stops moving, nothing is refilling comps. */
  newestSoldAt: string | null;
  ageDays: number | null;
  skusTotal: number;
  skusPriceable: number;
  /** Roughly how long before the CURRENT stock ages out of the 90-day window. */
  daysOfRunway: number | null;
  warning: string | null;
}

/** Must match `valueSku`'s window, or this reports on a population nothing uses. */
export const COMP_WINDOW_DAYS = 90;

/** Read at call time: the scheduler owns the default, and env can override it. */
const VISION_PER_RUN = () => Number(process.env.FILTRSOFT_CRAWL_VISION ?? 10);

export function compsHealth(): CompsHealth {
  const d = db();
  const one = <T>(sql: string, ...a: unknown[]) => d.query(sql).get(...(a as [])) as T;

  const total = one<{ n: number }>("SELECT COUNT(*) n FROM comps").n;
  const usable = one<{ n: number }>(
    `SELECT COUNT(*) n FROM comps
      WHERE sold_at IS NULL OR sold_at >= date('now', '-${COMP_WINDOW_DAYS} days')`).n;
  const newest = one<{ m: string | null }>("SELECT MAX(sold_at) m FROM comps").m;
  const skusTotal = one<{ n: number }>("SELECT COUNT(*) n FROM skus").n;
  const skusPriceable = one<{ n: number }>(
    `SELECT COUNT(DISTINCT sku_id) n FROM comps
      WHERE sold_at IS NULL OR sold_at >= date('now', '-${COMP_WINDOW_DAYS} days')`).n;

  const ageDays = newest
    ? Math.floor((Date.now() - Date.parse(newest)) / 86_400_000)
    : null;

  /**
   * ⚠ RUNWAY IS MEASURED FROM THE NEWEST COMP, NOT FROM TODAY. The window is
   * 90 days wide and the freshest thing in it is already `ageDays` old, so the
   * last comp falls out `90 - ageDays` days from now. Nothing tops it up in
   * between.
   */
  const daysOfRunway = ageDays == null ? null : Math.max(0, COMP_WINDOW_DAYS - ageDays);

  let warning: string | null = null;
  if (!total) {
    warning = "no comps at all — every verdict will be INSUFFICIENT_DATA";
  } else if (daysOfRunway != null && daysOfRunway <= 14) {
    warning = `comps run out in ~${daysOfRunway} days. Run \`bun run ebay:comps\` and \`bun run archive\`, then redeploy.`;
  } else if (skusTotal && skusPriceable / skusTotal < 0.75) {
    warning = `only ${skusPriceable} of ${skusTotal} models can be priced; the rest have no sale inside ${COMP_WINDOW_DAYS} days.`;
  }

  return { total, usable, newestSoldAt: newest, ageDays, skusTotal, skusPriceable, daysOfRunway, warning };
}

export interface VisionHealth {
  reads24h: number;
  reads7d: number;
  lastReadAt: string | null;
  /** Listings eligible for a paid photo read right now. */
  candidatePool: number;
  /**
   * Listings this process tried and could not fetch, and gave up on.
   *
   * ⚠ A RISING NUMBER HERE IS NOT AN ERROR, IT IS THE EXPECTED COST OF
   * production having no browser: a Facebook listing pushed from his machine
   * can never be re-fetched from the container. It matters because it is what
   * distinguishes "the pass is working and skipping what it cannot read" from
   * the deadlock that hid for three days.
   */
  unreadable: number;
  /**
   * The shortlist AFTER the JS filters, i.e. what a tick would actually try.
   *
   * ⚠ `candidatePool` AND THIS CAN DISAGREE, AND THE GAP IS DIAGNOSTIC.
   * `visionCandidates` takes `limit * 3` rows from SQL and then drops anything
   * that is not `kind: "tech"` or that reads as an accessory. A big pool with
   * an empty shortlist means the pass returns 0 without attempting anything —
   * which records no read AND no failure, and is indistinguishable from a
   * broken pass in every other metric.
   */
  shortlist: number;
  warning: string | null;
}

/**
 * ⚠ `candidatePool` DELIBERATELY MIRRORS `visionCandidates`' SQL RATHER THAN
 * CALLING IT. That function applies two JS filters (product type, accessory)
 * and slices to a limit, so calling it would report "3" forever — the page
 * size — and say nothing about whether a backlog exists. This counts the
 * eligible population, which is the number that distinguishes "nothing to do"
 * from "not running".
 */
export function visionHealth(model: string, promptVersion: string): VisionHealth {
  const d = db();
  const one = <T>(sql: string, ...a: unknown[]) => d.query(sql).get(...(a as [])) as T;

  const reads24h = one<{ n: number }>(
    "SELECT COUNT(*) n FROM vision_results WHERE created_at >= datetime('now','-1 day')").n;
  const reads7d = one<{ n: number }>(
    "SELECT COUNT(*) n FROM vision_results WHERE created_at >= datetime('now','-7 days')").n;
  const lastReadAt = one<{ m: string | null }>("SELECT MAX(created_at) m FROM vision_results").m;

  const candidatePool = one<{ n: number }>(`
    SELECT COUNT(*) n
      FROM listings l
      JOIN verdicts v ON v.id = (SELECT MAX(id) FROM verdicts WHERE listing_id = l.id)
     WHERE l.delisted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM vision_results r
          WHERE r.listing_id = l.id AND r.model = ? AND r.prompt_version = ?
       )
       AND (
         v.call IN ('BUY','VERIFY','RISK')
         OR (v.call = 'INSUFFICIENT_DATA'
             AND json_extract(v.payload, '$.headline') LIKE '%not stated%')
       )`, model, promptVersion).n;

  /**
   * A backlog with no reads is the broken case, and it is the one that hides:
   * an empty pool with no reads is perfectly healthy and looks identical in
   * every other metric.
   */
  const unreadable = one<{ n: number }>(
    "SELECT COUNT(*) n FROM vision_misses WHERE tries >= 3").n;

  /** Imported lazily: `vision-pass` pulls in the engine, which is heavy. */
  let shortlist = -1;
  try {
    const { visionCandidates } = require("../crawler/vision-pass.ts");
    /**
     * ⚠ THE REAL PER-RUN COUNT, NOT A HARDCODED 3. This read `visionCandidates(3)`
     * while the loop ran a different number, so `shortlist: 3` was a statement
     * about this line rather than about what the next tick would do — and it
     * kept saying 3 after the per-run count was raised to 10, which is exactly
     * the kind of quiet lie that sends someone diagnosing the wrong thing.
     */
    shortlist = visionCandidates(VISION_PER_RUN()).length;
  } catch { /* leave -1, meaning "could not evaluate" */ }

  const warning = candidatePool > 20 && reads24h === 0
    ? `${candidatePool} listings are waiting on a photo read and none has run in 24h`
    : null;

  return { reads24h, reads7d, lastReadAt, candidatePool, unreadable, shortlist, warning };
}
