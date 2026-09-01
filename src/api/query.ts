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
 *   all     everything EXCEPT risk
 *
 * `INSUFFICIENT_DATA` is deliberately reachable ONLY under `all`. It is the
 * largest bucket and the one that can never be acted on, so promoting it into
 * any named segment would fill that segment with rows nobody can use.
 *
 * ⚠ `all` DOES NOT MEAN EVERY ROW — RISK IS EXCLUDED FROM IT.
 *
 * Yish, 2026-08-31: *"I've decided that I don't actually want risky listings to
 * be in the all listings feed at all. I just want them to appear in the risky
 * listings when I click that tab."*
 *
 * He is right and it is the same argument §4 already made about "deals": a
 * scam is not a listing you browse past, it is a listing you were nearly sent
 * to. Leaving them in the default view spends attention on rows whose whole
 * purpose is to be avoided — and the day this changed, one of those RISK rows
 * turned out to be a real scammer running two listings at once (§18j).
 *
 * The tab still shows them, with its own count, so nothing is hidden. This is
 * about what the DEFAULT view is for.
 */
const NEVER_IN_ALL = ["RISK"];

export const QUALITY: Record<string, string[] | null> = {
  all: null,
  ready: ["BUY"],
  verify: ["VERIFY"],
  risky: ["RISK"],
  browse: ["FAIR", "PASS"],
};

export const QUALITIES = Object.keys(QUALITY);

/**
 * An unknown segment falls back to `all` rather than serving nothing.
 *
 * ⚠ THE `all` BRANCH IS A FILTER NOW, NOT A PASSTHROUGH. It used to `return
 * rows` untouched, which is why this reads as a special case rather than as
 * "no quality selected".
 */
export const applyQuality = <T extends Scoped>(rows: T[], quality: string): T[] => {
  const wanted = QUALITY[quality] ?? null;
  if (wanted) return rows.filter((r) => wanted.includes(r.call));
  return rows.filter((r) => !NEVER_IN_ALL.includes(r.call));
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

// ─────────────────────────────────────────────── what is NEW since you looked

/**
 * How many rows in each segment arrived since this device last viewed it.
 *
 * ⚠ "NEW" MEANS `captured_at`, NEVER THE VERDICT'S TIMESTAMP, AND THIS IS THE
 * WHOLE DESIGN.
 *
 * `reverdictStale` re-scores the ENTIRE feed on every `ENGINE_VERSION` bump —
 * three of those shipped in the last week alone. Keyed on when a verdict was
 * written, one bump would light every badge in the app with the full 700-row
 * inventory, and a badge that cries wolf once is a badge nobody reads again.
 * `listings.captured_at` is when the row first entered the database and is
 * stable across every re-score.
 *
 * The cost, stated so nobody "fixes" it later: a listing that flips PASS -> BUY
 * on a re-score does NOT badge. That is a real miss, and it is the safe
 * direction. Recording the first time a listing landed on each CALL is the
 * proper fix and needs a column; this needs nothing.
 */
export interface Fresh extends Scoped {
  capturedAt?: string | null;
}

/**
 * ⚠ THE `all` BADGE EXCLUDES CAN'T-TELLS, WHICH IS **NOT** WHAT THE `all`
 * SEGMENT ITSELF DOES. That divergence is deliberate and measured.
 *
 * Yish, 2026-09-01: *"exclude the cant tells in the all category so ~20 a day
 * for that category."*
 *
 * `all` takes ~130 new rows a day and 549 of its 704 live rows are
 * `INSUFFICIENT_DATA` — listings the engine could not price, which by
 * definition cannot be acted on. Counting them makes the All badge a
 * permanently-lit three-digit number, which is not a notification, it is
 * wallpaper: it trains the eye to skip the whole control, including the Buy-it
 * badge beside it that fires 0.7 times a day and is the entire point.
 *
 * Excluding them puts All at ~20/day. The segment still SERVES them, so
 * nothing is hidden — this only decides what gets counted as worth telling him
 * about.
 */
const NEW_NEVER_COUNTED: Record<string, string[]> = {
  all: ["INSUFFICIENT_DATA"],
};

/**
 * Per-segment watermarks, as sent by the client.
 *
 * ⚠ THESE ARE SERVER TIMESTAMPS ROUND-TRIPPING, NOT THE PHONE'S CLOCK. The
 * feed hands back `serverNow` and the client stores THAT as the watermark. A
 * device four minutes fast would otherwise report zero new listings forever,
 * with nothing on screen to explain why.
 */
export type Seen = Record<string, string | null>;

/**
 * Parse `?since=` into a watermark per segment.
 *
 * Bad JSON yields NO watermarks rather than throwing, and a segment with no
 * watermark counts ZERO rather than everything — a device that has never
 * looked at Risky should not be greeted with "26 new", which is just the
 * inventory wearing a notification badge.
 */
export function parseSeen(raw: string | undefined): Seen {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Seen = {};
    for (const q of QUALITIES) {
      const v = parsed[q];
      if (typeof v === "string" && Number.isFinite(Date.parse(v))) out[q] = v;
    }
    return out;
  } catch { return {}; }
}

export function newSegmentCounts<T extends Fresh>(priceScoped: T[], seen: Seen): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of QUALITIES) {
    const since = seen[q];
    if (!since) { out[q] = 0; continue; }
    const cut = Date.parse(since);
    const excluded = NEW_NEVER_COUNTED[q] ?? [];
    out[q] = applyQuality(priceScoped, q).filter((r) =>
      !excluded.includes(r.call) &&
      r.capturedAt != null &&
      (Date.parse(r.capturedAt) || 0) > cut).length;
  }
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

// ─────────────────────────────────────────────────────────── discovery

/**
 * Search, category, source and sort — the rest of the feed query.
 *
 * ⚠ THREE SEGMENTS IS NOT DISCOVERY FOR 387 LISTINGS (audit §20). Every one of
 * these is a pure function over the already-ranked rows for the same reason the
 * segment counts are: the number the control prints and the rows it serves must
 * come from one filter model, or they drift apart exactly as they did before.
 *
 * ⚠ THERE IS NO DISTANCE FILTER AND THAT IS NOT AN OVERSIGHT. `listings` stores
 * `location` as free text ("Nonantum", "Salem, MA") with no coordinates and no
 * geocoding anywhere in the pipeline, so a radius control would either be a
 * string match wearing a mileage label or a number invented on the spot. The
 * audit asks for one; it needs geocoding at ingest first.
 */
export type Sort = "best" | "newest" | "drop" | "price";
export const SORTS: Sort[] = ["best", "newest", "drop", "price"];

export interface FeedFilters {
  quality: string;
  q: string;
  category: string;
  source: string;
  maxPrice: number | null;
  sort: Sort;
}

export const NO_FILTERS: FeedFilters = {
  quality: "all", q: "", category: "", source: "", maxPrice: null, sort: "best",
};

/** Reads one request's worth of query params into the filter model. */
export function parseFilters(get: (k: string) => string | undefined): FeedFilters {
  const price = Number(get("maxPrice"));
  const sort = (get("sort") ?? "best").toLowerCase() as Sort;
  return {
    quality: (get("quality") ?? "all").toLowerCase(),
    q: (get("q") ?? "").trim().slice(0, 80),
    category: (get("category") ?? "").toLowerCase(),
    source: (get("source") ?? "").toLowerCase(),
    maxPrice: Number.isFinite(price) && price > 0 ? price : null,
    sort: SORTS.includes(sort) ? sort : "best",
  };
}

/**
 * How many filters are ON, for the badge on the Filters button.
 *
 * ⚠ QUALITY AND SORT ARE DELIBERATELY EXCLUDED. The segment control is always
 * visible and always has one option selected, and sort has a default; counting
 * either would show "2 filters" on a screen where nothing has been filtered,
 * which teaches people to ignore the badge.
 */
export function activeFilterCount(f: FeedFilters): number {
  return (f.q ? 1 : 0) + (f.category ? 1 : 0) + (f.source ? 1 : 0) + (f.maxPrice ? 1 : 0);
}

/**
 * Every word must appear somewhere in the title.
 *
 * AND, not OR: "rtx 3060" must not return every RTX card and every listing with
 * a 3060-something in it. Substring rather than word-boundary, because model
 * numbers are written glued to their qualifiers ("RTX3060", "3060Ti") often
 * enough that requiring a boundary loses real matches.
 */
export function matchesSearch(title: string, q: string): boolean {
  if (!q) return true;
  const hay = title.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
}

export interface Discoverable extends Scoped {
  title?: string | null;
  source?: string | null;
  category?: string | null;
  postedAt?: string | null;
  priceDropCents?: number | null;
  score?: number;
}

/** Everything EXCEPT quality, which the segment counts are computed over. */
export function applyDiscovery<T extends Discoverable>(rows: T[], f: FeedFilters): T[] {
  return withinPrice(rows, f.maxPrice).filter((r) =>
    matchesSearch(r.title ?? "", f.q) &&
    (f.category ? r.category === f.category : true) &&
    (f.source ? r.source === f.source : true));
}

/**
 * ⚠ SORT IS STABLE AND ALWAYS FALLS BACK TO `score`.
 *
 * "Newest" on a feed where half the listings have no `posted_at` would
 * otherwise scatter those rows arbitrarily, and an ordering that changes
 * between two identical requests makes pagination duplicate and drop rows.
 */
export function sortFeed<T extends Discoverable>(rows: T[], sort: Sort): T[] {
  const by = (n: number) => (a: T, b: T) => n;
  const score = (r: T) => r.score ?? 0;
  const out = [...rows];
  if (sort === "newest") {
    out.sort((a, b) => (Date.parse(b.postedAt ?? "") || 0) - (Date.parse(a.postedAt ?? "") || 0)
      || score(b) - score(a));
  } else if (sort === "drop") {
    out.sort((a, b) => (b.priceDropCents ?? 0) - (a.priceDropCents ?? 0) || score(b) - score(a));
  } else if (sort === "price") {
    // Unpriced rows sink: "cheapest first" with no price is not an answer.
    const p = (r: T) => r.askingPriceCents ?? Number.MAX_SAFE_INTEGER;
    out.sort((a, b) => p(a) - p(b) || score(b) - score(a));
  } else {
    out.sort((a, b) => score(b) - score(a));
  }
  return out;
}
