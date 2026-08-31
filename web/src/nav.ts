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
}

export const SETTINGS_KEY = "assyze:settings";

export const DEFAULT_SETTINGS: Settings = {
  driveMinutes: 15,
  hideGone: true,
  reduceMotion: false,
  askOutcomes: true,
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
    return { ...DEFAULT_SETTINGS, ...parsed };
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

/** The detail request carries the user's drive time; the stored verdict does not. */
export function checkQuery(id: number, driveMinutes: number): string {
  return `/v1/checks/${id}?drive=${clampDrive(driveMinutes)}`;
}
