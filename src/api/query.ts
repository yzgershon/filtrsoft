/**
 * Feed segmentation and query parsing — the part of the API that has to be
 * self-consistent, extracted so a test can prove it is.
 *
 * ── WHY THIS IS A FILE ─────────────────────────────────────────────────────
 *
 * The 2026-08-30 audit's first P0 was that the Deals control said 20 and the
 * view dead-ended at 13. Seven listings were unreachable by any interaction:
 * the count came from one population and the rows came from another. That is
 * not a bug you can see in a screenshot, and it is not one you can catch by
 * reading a route handler either — you catch it by asserting that the count and
 * the page are computed from the SAME set, which needs both to be functions.
 *
 * ⚠ THE INVARIANT: for every segment, `segmentCounts(rows)[q]` MUST equal
 * `applyQuality(rows, q).length`. `test/backend-pure.test.ts` asserts it for
 * every segment on the same fixture. Break it and the UI starts lying again.
 */

/** The only shape either function needs. Everything else on a feed row is noise. */
export interface Scoped {
  call: string;
  askingPriceCents?: number | null;
}

/**
 * The segment vocabulary. Audit §4: **RISK is never a deal**, and a listing
 * that needs an answer is not ready to act on.
 *
 *   ready   BUY only            — go now
 *   verify  VERIFY              — one message settles it
 *   risky   RISK                — its own state, never counted as a deal
 *   browse  FAIR + PASS         — priced, and not worth it
 *   all     everything the feed already allows
 *
 * `INSUFFICIENT_DATA` is deliberately reachable ONLY under `all`. It is the
 * largest bucket and the one that can never be acted on, so promoting it into
 * any named segment would fill that segment with rows nobody can use.
 */
export const QUALITY: Record<string, string[] | null> = {
  all: null,
  ready: ["BUY"],
  verify: ["VERIFY"],
  risky: ["RISK"],
  browse: ["FAIR", "PASS"],
};

export const QUALITIES = Object.keys(QUALITY);

/** An unknown segment falls back to `all` rather than serving nothing. */
export const applyQuality = <T extends Scoped>(rows: T[], quality: string): T[] => {
  const wanted = QUALITY[quality] ?? null;
  return wanted ? rows.filter((r) => wanted.includes(r.call)) : rows;
};

export const withinPrice = <T extends Scoped>(rows: T[], maxPrice: number | null): T[] =>
  maxPrice ? rows.filter((r) => (r.askingPriceCents ?? Infinity) <= maxPrice) : rows;

/**
 * Counts for every segment over ONE population.
 *
 * Callers must pass the price-scoped set, not the quality-filtered one:
 * switching segments must never change the number printed on the other
 * segments, or the control reads as though the feed is shrinking as you use it.
 */
export function segmentCounts<T extends Scoped>(priceScoped: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of QUALITIES) out[q] = applyQuality(priceScoped, q).length;
  return out;
}

/**
 * The drive time from `?drive=`, or undefined for "use the stored verdict".
 *
 * ⚠ THE BOUNDS MUST MATCH THE CLIENT STEPPER (`web/src/nav.ts`). If the server
 * silently clamped where the client did not, the screen would show 120 minutes
 * and the verdict would be computed at 90 — a control that moves a number and
 * lies about what it did, which is the exact class of bug this pass removes.
 * Out of range is REJECTED here rather than clamped, so a malformed request
 * gets the stored verdict instead of a quietly different one.
 */
export const DRIVE_MIN = 5;
export const DRIVE_MAX = 90;

export function parseDrive(raw: string | undefined): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  if (n < DRIVE_MIN || n > DRIVE_MAX) return undefined;
  return n;
}
