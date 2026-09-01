/**
 * Routing, settings and the feed query — the pure half of the shell.
 *
 * These four things were the P0 trust bugs in the 2026-08-30 audit (a Back
 * button that left the detail on screen, a segment control whose counts did not
 * match what you could reach, and two settings that were written and never
 * read), and all four are decidable from a string. They live here, outside
 * React, so a test can pin them without a DOM: `bun test` runs in Bun, the app
 * builds in Vite, and neither needs the other's runtime.
 *
 * ⚠ NOTHING IN THIS FILE MAY TOUCH `window`, `document` OR `localStorage`.
 * The moment it does it stops being testable here, which is the whole reason
 * it was split out of App.tsx.
 */

// ------------------------------------------------------------------ routing

export type Screen =
  | { name: "deals" }
  | { name: "check" }
  | { name: "saved" }
  | { name: "settings" }
  | { name: "detail"; id: number };

/**
 * ⚠ THE URL IS THE SCREEN. It used to be a hint, and the two disagreed.
 *
 * Primary tabs lived in React state while the route tracked `path` separately,
 * which produced three live bugs: Back from `/c/3918` set the URL to `/` and
 * left the DETAIL VISIBLE with the bottom bar lighting Check; refreshing Check,
 * Saved or Settings landed on Deals; and the PWA shortcut `/?tab=check` opened
 * Deals. One derivation from the pathname makes all three impossible.
 *
 * The trailing slash is optional on purpose — a PWA launched from a home-screen
 * icon can arrive at `/check/`, and that must not fall through to Deals.
 */
export function screenOf(pathname: string): Screen {
  const m = pathname.match(/^\/c\/(\d+)\/?$/);
  if (m) return { name: "detail", id: Number(m[1]) };
  if (/^\/check\/?$/.test(pathname)) return { name: "check" };
  if (/^\/saved\/?$/.test(pathname)) return { name: "saved" };
  if (/^\/settings\/?$/.test(pathname)) return { name: "settings" };
  return { name: "deals" };
}

/** Which bottom-bar item is lit. Detail and Settings belong to no tab. */
export function tabOf(s: Screen): "deals" | "check" | "saved" | null {
  if (s.name === "deals") return "deals";
  if (s.name === "check") return "check";
  if (s.name === "saved") return "saved";
  return null;
}

// ----------------------------------------------------------------- settings

/** Settings the user actually controls. Server-side economics stay server-side. */
export interface Settings {
  driveMinutes: number;
  hideGone: boolean;
  reduceMotion: boolean;
  askOutcomes: boolean;
  /** Stamps the one-shot 15 -> 20 default migration. See `mergeSettings`. */
  driveVersion?: number;

  // ── the in-app alert ──────────────────────────────────────────────────
  /**
   * The top-of-screen popup when a deal lands while the app is open.
   *
   * ⚠ THERE IS NO `alertBuy` SWITCH AND THAT IS DELIBERATE. BUY arrives 0.7
   * times a day; an alert that rare has no volume problem to solve, and a
   * master switch beside it is just a way to turn the product off by accident.
   * `alerts` is the master, `alertVerify` adds the 2.3/day tier.
   */
  alerts: boolean;
  alertVerify: boolean;

  // ── feed presentation ─────────────────────────────────────────────────
  /**
   * The translucent age tag on the card photo. On by default; anything older
   * than three days never carries one whatever this says (`listedAge`).
   */
  showAge: boolean;
  /** Verdict chip on the photo. Off = photo-only cards. */
  showCall: boolean;
  compact: boolean;
}

export const SETTINGS_KEY = "assyze:settings";

/**
 * ⚠ 20 MINUTES, NOT 15, AS OF 2026-08-31. Yish: *"can you change it to like
 * $100 profit with a 20 min drive."* The server's economics were retuned to put
 * the crossover exactly there — $100 flat up to 20 minutes, the clock only
 * beyond it — so this default and that curve are one decision. See the
 * `2026-08-31-hourly-floor-80-crossover-at-20min` migration.
 */
export const LEGACY_DRIVE_DEFAULT = 15;

export const DEFAULT_SETTINGS: Settings = {
  driveMinutes: 20,
  hideGone: true,
  reduceMotion: false,
  askOutcomes: true,
  alerts: true,
  alertVerify: false,
  showAge: true,
  showCall: true,
  compact: false,
};

/**
 * Parse whatever is in storage into a whole Settings object.
 *
 * Split from the storage read so it can be tested, and so a corrupt value can
 * never take the app down: a half-written JSON blob or a key added by a future
 * version falls back to the defaults rather than throwing inside a `useState`
 * initialiser, which renders a blank screen with no error anyone can see.
 */
export function mergeSettings(raw: string | null): Settings {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return DEFAULT_SETTINGS;
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    /**
     * ⚠ A STORED VALUE EQUAL TO THE OLD DEFAULT IS NOT A CHOICE.
     *
     * Settings are written to localStorage in full on every change, so his
     * phone holds `driveMinutes: 15` whether he set it or merely never touched
     * the stepper — and a plain merge keeps 15 forever. He asked for 20; the
     * app would have gone on showing 15, which reads as the change not landing.
     *
     * So the OLD DEFAULT specifically is migrated, once, and any other value is
     * left alone because someone who typed 45 meant 45. `driveVersion` stamps
     * it so this never runs twice and cannot walk a later choice back.
     */
    if (merged.driveVersion !== 2) {
      if (merged.driveMinutes === LEGACY_DRIVE_DEFAULT) merged.driveMinutes = DEFAULT_SETTINGS.driveMinutes;
      merged.driveVersion = 2;
    }
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * The drive-time range the server will honour.
 *
 * ⚠ THIS MUST AGREE WITH `/v1/checks/:id`, which ignores anything outside
 * 5..90. A stepper that offered 120 minutes would move the number on screen and
 * silently get a 15-minute verdict back — the exact class of lie this commit
 * exists to remove.
 */
export const DRIVE_MIN = 5;
export const DRIVE_MAX = 90;
export const DRIVE_STEP = 5;

export const clampDrive = (n: number): number =>
  Math.max(DRIVE_MIN, Math.min(DRIVE_MAX, Math.round(n / DRIVE_STEP) * DRIVE_STEP));

// --------------------------------------------------------------- feed query

export type Quality = "all" | "ready" | "verify" | "risky" | "browse";

/**
 * ⚠ THE SEGMENT IS A SERVER QUERY, NOT A CLIENT-SIDE `.filter()`.
 *
 * The old feed fetched 60 rows, filtered those in the browser, and showed
 * "Show more" only under All. Measured live: the Deals control said 20 and the
 * view dead-ended at 13 — seven listings unreachable by any interaction,
 * because the other 341 rows were never fetched and the control that would have
 * fetched them was hidden. Count, page and pagination now come from one filter
 * model on the server, so they cannot disagree.
 *
 * `hideGone` is inverted here for the same reason: the server hides delisted
 * rows by default, so the switch has to ASK for them when it is off.
 */
export function feedQuery(o: {
  limit: number;
  offset: number;
  quality: Quality;
  hideGone: boolean;
}): string {
  const gone = o.hideGone ? "" : "&gone=1";
  return `/v1/feed?limit=${o.limit}&offset=${o.offset}&quality=${o.quality}${gone}`;
}

/**
 * The detail request carries the user's drive time; the stored verdict does not.
 *
 * ⚠ `ref` IS A PARAMETER, NOT READ FROM STORAGE. Nothing in this file may touch
 * `localStorage` — that is the rule that keeps it testable without a DOM. The
 * caller passes `deviceRef()` from `lib.tsx`.
 *
 * Without it the server cannot tell whose overrides to apply, and a listing he
 * relabelled would keep showing the engine's call.
 */
export function checkQuery(id: number, driveMinutes: number, ref?: string): string {
  return `/v1/checks/${id}?drive=${clampDrive(driveMinutes)}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`;
}

// ─────────────────────────────────────────────────────── discovery filters

/**
 * ⚠ THE FILTER STATE LIVES IN THE URL, NOT IN REACT STATE.
 *
 * Audit §20: "reflect filter state in the URL so searches are shareable and
 * restorable." That is not only about sharing. Filters held in component state
 * are lost on every refresh and on every trip into a listing and back, which on
 * a feed of 387 rows means re-typing the search after each thing you look at.
 *
 * These mirror `src/api/query.ts` exactly. If the two ever disagree the control
 * asks for something the server does not understand and silently gets
 * everything back, which reads as "the filter did nothing".
 *
 * ⚠ NO DISTANCE FILTER. `listings.location` is free text with no coordinates
 * and nothing geocodes at ingest, so a radius control would be a string match
 * wearing a mileage label. The audit asks for one; it needs geocoding first.
 */
export type Sort = "best" | "newest" | "drop" | "price";
export const SORTS: Array<{ id: Sort; label: string }> = [
  { id: "best", label: "Best deals" },
  { id: "newest", label: "Newest" },
  { id: "drop", label: "Biggest price drop" },
  { id: "price", label: "Cheapest" },
];

export const CATEGORIES: Array<{ id: string; label: string }> = [
  { id: "gpu", label: "Graphics cards" },
  { id: "laptop", label: "Laptops" },
  { id: "phone", label: "Phones" },
  { id: "console", label: "Consoles" },
  { id: "prebuilt", label: "Desktops" },
  { id: "tablet", label: "Tablets" },
  { id: "component", label: "Components" },
];

/** The label is how a person says it. "offerup" is not how anyone says it. */
export const SOURCES: Array<{ id: string; label: string }> = [
  { id: "craigslist", label: "Craigslist" },
  { id: "facebook", label: "Facebook" },
  { id: "offerup", label: "OfferUp" },
  { id: "mercari", label: "Mercari" },
];
export const sourceLabel = (id: string): string =>
  SOURCES.find((s) => s.id === id)?.label ?? id;

export interface Filters {
  quality: Quality;
  q: string;
  category: string;
  source: string;
  maxPrice: number | null;
  sort: Sort;
}

export const NO_FILTERS: Filters = {
  quality: "all", q: "", category: "", source: "", maxPrice: null, sort: "best",
};

const QUALITIES: Quality[] = ["all", "ready", "verify", "risky", "browse"];

/** Read filters out of a `?a=b` string. Anything unrecognised falls back. */
export function filtersFromSearch(search: string): Filters {
  const p = new URLSearchParams(search);
  const price = Number(p.get("maxPrice"));
  const quality = (p.get("quality") ?? "all") as Quality;
  const sort = (p.get("sort") ?? "best") as Sort;
  return {
    quality: QUALITIES.includes(quality) ? quality : "all",
    q: (p.get("q") ?? "").slice(0, 80),
    category: p.get("category") ?? "",
    source: p.get("source") ?? "",
    maxPrice: Number.isFinite(price) && price > 0 ? price : null,
    sort: SORTS.some((s) => s.id === sort) ? sort : "best",
  };
}

/**
 * Back to a query string, DEFAULTS OMITTED.
 *
 * A URL that reads `?quality=all&q=&category=&source=&sort=best` after every
 * interaction is a URL nobody will share and one that makes the back button
 * step through states that look identical.
 */
export function searchFromFilters(f: Filters): string {
  const p = new URLSearchParams();
  if (f.quality !== "all") p.set("quality", f.quality);
  if (f.q) p.set("q", f.q);
  if (f.category) p.set("category", f.category);
  if (f.source) p.set("source", f.source);
  if (f.maxPrice) p.set("maxPrice", String(f.maxPrice));
  if (f.sort !== "best") p.set("sort", f.sort);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/**
 * How many filters are ON, for the badge on the Filters button.
 *
 * ⚠ QUALITY AND SORT ARE EXCLUDED. The segment control is always visible with
 * one option selected and sort always has a value; counting either would show
 * "2 filters" on a screen where nothing has been filtered, which teaches people
 * to ignore the badge.
 */
export const activeFilterCount = (f: Filters): number =>
  (f.q ? 1 : 0) + (f.category ? 1 : 0) + (f.source ? 1 : 0) + (f.maxPrice ? 1 : 0);

/**
 * How many rows to ask for when RESTORING a feed you are coming back to.
 *
 * ⚠ RESTORING A SCROLL OFFSET WITHOUT RESTORING THE ROW COUNT PUTS YOU IN THE
 * WRONG PLACE, AND SILENTLY.
 *
 * The feed pages 60 at a time. Press "Show more" twice, scroll to row 150, open
 * a listing and come back: the fresh mount fetches 60 rows, which is roughly
 * 5,000px of page, and a saved offset of 14,000px clamps to the bottom of it.
 * You land somewhere you have never been, on a screen that looks like the
 * restore worked.
 *
 * So the count travels with the offset and the first request asks for all of it
 * in one go. `PAGE` is the floor because a saved count is never smaller than
 * one page, and 200 is the server's own cap on `limit` — asking for more would
 * be silently truncated, which is the same bug one layer down.
 */
export const FEED_PAGE = 60;
export const FEED_LIMIT_MAX = 200;
export const restoreLimit = (n: number): number =>
  Math.min(FEED_LIMIT_MAX, Math.max(FEED_PAGE, Math.floor(n) || FEED_PAGE));

/** The feed request for a whole filter state. */
// ──────────────────────────────────────────────── what you have already seen

/**
 * The per-segment "last looked at" watermarks behind the chip badges.
 *
 * ⚠ ONE WATERMARK PER SEGMENT, NOT ONE FOR THE APP. Viewing Risky must not
 * clear the Buy-it badge. A single watermark would mean the rarest and most
 * valuable signal in the product (0.7 BUYs a day) gets wiped by glancing at
 * the noisiest tab, which is the one thing the badges exist to prevent.
 *
 * ⚠ AND THE VALUES ARE SERVER TIMESTAMPS, echoed back from `serverNow`. Never
 * `Date.now()` — a phone running four minutes fast writes a future watermark
 * and then reports zero new listings forever, with nothing on screen to
 * explain why. Same reason `parseSeen` exists server-side.
 */
export const SEEN_KEY = "assyze:seen";

export type Seen = Partial<Record<Quality, string>>;

export function readSeen(): Seen {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Seen = {};
    for (const q of QUALITIES) {
      const v = parsed[q];
      if (typeof v === "string" && Number.isFinite(Date.parse(v))) out[q] = v;
    }
    return out;
  } catch { return {}; }
}

/**
 * Stamp one segment as seen.
 *
 * ⚠ MONOTONIC. A response that arrives out of order (page 2 of a slow request
 * landing after page 1 of a newer one) must never walk the watermark
 * BACKWARDS, or listings you have already looked at reappear as new.
 */
export function markSeen(q: Quality, at: string): Seen {
  const seen = readSeen();
  const prev = seen[q];
  if (prev && Date.parse(prev) >= Date.parse(at)) return seen;
  const next = { ...seen, [q]: at };
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

export function feedUrl(o: {
  limit: number; offset: number; hideGone: boolean; filters: Filters; ref?: string; seen?: Seen;
}): string {
  const p = new URLSearchParams(searchFromFilters(o.filters).replace(/^\?/, ""));
  p.set("limit", String(o.limit));
  p.set("offset", String(o.offset));
  p.set("quality", o.filters.quality);
  if (!o.hideGone) p.set("gone", "1");
  /**
   * The watermarks, so the server can count what is new PER SEGMENT. Sent as
   * JSON rather than four params because the set of segments is `QUALITIES`
   * and adding one should not mean touching this function.
   */
  if (o.seen && Object.keys(o.seen).length) p.set("since", JSON.stringify(o.seen));
  /**
   * ⚠ THE FEED NEEDS THE REF OR AN OVERRIDE ONLY WORKS ON THE DETAIL SCREEN.
   * The server moves a relabelled listing between segments and recounts the
   * chips, so a feed request without it shows the engine's call and the
   * engine's counts while the listing's own page shows his.
   */
  if (o.ref) p.set("ref", o.ref);
  return `/v1/feed?${p.toString()}`;
}
