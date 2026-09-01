/**
 * Formatting, device storage, toasts, sharing and the shared Thumb.
 *
 * Split out of a 2,802-line `App.tsx` (audit commit 6). THE SPLIT IS BY
 * SCREEN, NOT BY KIND. Everything one screen needs sits together, so a change
 * to the feed is one file rather than a hunt through a components/, a hooks/
 * and a utils/ for three pieces of the same feature.
 */

import { useEffect, useState } from "react";
import { Alert, Check, Ghost } from "./icons.tsx";
import type { Call, Hist } from "./types.ts";
import { mergeSettings, DEFAULT_SETTINGS, SETTINGS_KEY, type Settings } from "./nav.ts";

export const money = (c?: number | null) => (c == null ? "—" : `$${Math.round(c / 100).toLocaleString()}`);
export const ago = (iso: string | null) => {
  if (!iso) return null;
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? "listed today" : d === 1 ? "listed yesterday" : `listed ${d} days ago`;
};
export const LABEL: Record<Call, string> = {
  BUY: "Buy it", FAIR: "Fair price", PASS: "Pass", VERIFY: "Verify first",
  RISK: "Risky", INSUFFICIENT_DATA: "Can't tell", OUT_OF_SCOPE: "Not covered",
};

// -------------------------------------------------------------- storage
export const HKEY = "assyze:history";
export const readHist = (): Hist[] => { try { return JSON.parse(localStorage.getItem(HKEY) || "[]"); } catch { return []; } };
export const pushHist = (h: Hist) => {
  const all = [h, ...readHist().filter((x) => x.id !== h.id)].slice(0, 30);
  localStorage.setItem(HKEY, JSON.stringify(all));
};

/**
 * The watchlist is a list of IDS in localStorage, never a copy of the listing.
 *
 * Storing the listing itself would freeze the price and the verdict at the
 * moment you saved it, which defeats the entire point — the reason to save
 * something is to be told when it CHANGES. `/v1/watchlist` re-reads current
 * state for the ids on every visit, so a saved card is always live.
 *
 * No account required, and the tradeoff is stated on the screen: the list does
 * not follow you to another device.
 */
export const WKEY = "assyze:watch";
export const readWatch = (): number[] => { try { return JSON.parse(localStorage.getItem(WKEY) || "[]"); } catch { return []; } };
export const writeWatch = (ids: number[]) => localStorage.setItem(WKEY, JSON.stringify(ids.slice(0, 200)));
export const toggleWatch = (id: number): number[] => {
  const cur = readWatch();
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur];
  writeWatch(next);
  return next;
};

/**
 * Which checks we have already asked about, so nobody gets nagged twice.
 *
 * Stored separately from the history rather than as a flag on it: the history
 * is capped at 30 and rolls, and an answer must survive its listing falling off
 * the end or the same listing would come back around and ask again.
 */
export const AKEY = "assyze:asked";
export const readAsked = (): number[] => { try { return JSON.parse(localStorage.getItem(AKEY) || "[]"); } catch { return []; } };
export const markAsked = (id: number) => {
  const all = [id, ...readAsked().filter((x) => x !== id)].slice(0, 200);
  localStorage.setItem(AKEY, JSON.stringify(all));
};

/**
 * The oldest check we looked at more than a day ago and never asked about.
 *
 * **A DAY, not immediately.** Asking "did you buy it?" on the results screen
 * gets you an answer about intent, not outcome — you have not driven anywhere
 * yet. The whole value of this data is that it is what ACTUALLY happened, and
 * that takes a day to become true.
 *
 * Oldest first, because the answer decays: what you did about a listing three
 * days ago is still recoverable, three weeks is a guess.
 */
export const DAY = 86_400_000;
export function pendingOutcome(hist: Hist[], asked: number[]): Hist | null {
  const set = new Set(asked);
  const ripe = hist.filter((h) => !set.has(h.id) && Date.now() - h.at > DAY);
  return ripe.sort((a, b) => a.at - b.at)[0] ?? null;
}

/**
 * Settings the user actually controls. Shape, defaults and parsing are in
 * `nav.ts`; only the storage touch is here, because storage is the one part a
 * test cannot run.
 */
export const readSettings = (): Settings => {
  try { return mergeSettings(localStorage.getItem(SETTINGS_KEY)); }
  catch { return DEFAULT_SETTINGS; }
};
export const writeSettings = (s: Settings) => localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));

// ----------------------------------------------------------------- feedback
/**
 * Toasts.
 *
 * ⚠ COPY AND SHARE WROTE TO THE CLIPBOARD AND SAID NOTHING. On a phone there
 * is no clipboard indicator, so the only way to learn whether the tap
 * registered was to go and paste it somewhere. A tap with no feedback reads as
 * a broken button, and people tap it again.
 *
 * A module-level listener set rather than context, because the callers are
 * scattered five components deep and threading a prop to each of them is how
 * the next one gets forgotten. `aria-live="polite"` on the container means a
 * screen reader announces it without interrupting.
 */
type Toast = { id: number; text: string; bad?: boolean };
let toastSeq = 0;
const toastListeners = new Set<(t: Toast) => void>();
export function toast(text: string, bad = false) {
  const t = { id: ++toastSeq, text, bad };
  toastListeners.forEach((fn) => fn(t));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (t: Toast) => {
      setItems((p) => [...p, t]);
      // 1.8s: long enough to read six words, short enough not to sit over the
      // next thing you tap.
      setTimeout(() => setItems((p) => p.filter((x) => x.id !== t.id)), 1800);
    };
    toastListeners.add(on);
    return () => { toastListeners.delete(on); };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div className={`toast${t.bad ? " bad" : ""}`} key={t.id}>
          {t.bad ? <Alert size={14} /> : <Check size={14} />}{t.text}
        </div>
      ))}
    </div>
  );
}

/**
 * ONE share action, not two that do the same thing.
 *
 * The header link icon and the bottom "Share" button both wrote the same URL
 * to the clipboard, neither confirmed, and calling a clipboard write "Share"
 * is a lie on a phone that has a real share sheet. This uses `navigator.share`
 * where it exists and falls back to the clipboard where it does not — and says
 * which one happened.
 *
 * A cancelled share sheet throws `AbortError`, which is the user saying no.
 * Reporting that as a failure would be telling them their own decision broke.
 */
export async function shareOrCopy(url: string, title?: string) {
  if (navigator.share) {
    try { await navigator.share({ url, title }); return; }
    catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      // Fall through: some browsers advertise share and then refuse it.
    }
  }
  try { await navigator.clipboard.writeText(url); toast("Link copied"); }
  catch { toast("Couldn't copy the link", true); }
}

/**
 * A listing thumbnail that fails GRACEFULLY.
 *
 * **Facebook CDN urls are signed and they expire.** Measured on the live feed:
 * `scontent-bos5-1.xx.fbcdn.net/...` returns 403 once the token lapses, and the
 * hero card rendered the browser's broken-image glyph — a torn page icon in the
 * middle of the most prominent card on the site.
 *
 * We cannot fix the expiry without hosting the bytes ourselves, and photo
 * retention was deliberately removed because it filled the production volume
 * and took the crawler down for 13 hours. So the honest handling is to fail to
 * the SAME placeholder a listing with no photo uses: an expired image and an
 * absent one are indistinguishable to the reader, and both are true.
 */
export function Thumb({ src, size = 22 }: { src: string | null; size?: number }) {
  const [dead, setDead] = useState(false);
  if (!src || dead) return <span className="noimg"><Ghost size={size} /></span>;
  return <img src={src} alt="" loading="lazy" onError={() => setDead(true)} />;
}

/**
 * One card in the 2-up grid. Shared by the feed and the watchlist so a saved
 * listing looks exactly like the thing you saved.
 *
 * **IT IS A DIV, NOT A BUTTON, AND THAT IS NOT A STYLE CHOICE.** The card
 * needs a save control inside it, and a `<button>` inside a `<button>` is
 * invalid HTML — browsers recover by hoisting the inner one out, which detaches
 * it from the card and makes the save target land somewhere unpredictable. The
 * open action is its own button filling the card; the save button is a sibling
 * on top of it.
 *
 * The tracker badges are the entire reason the sweep exists. A price cut is the
 * strongest signal on any marketplace, so it gets the loudest treatment on the
 * card; `gone` greys the photo out because a dead listing should not look
 * equally actionable next to a live one.
 */

/**
 * The push subscription id, and the VAPID key decoder.
 *
 * THESE LIVE HERE, NOT WITH `Alerts`. Both the feed's "Alert me about this
 * search" and the Saved screen's alert list register a device, and putting the
 * helper in either one would make the other import from a sibling screen.
 */
export const SUBKEY = "assyze:subId";

/**
 * A stable per-device id.
 *
 * ⚠ IT LIVES HERE, NOT IN `screens.tsx`, BECAUSE THREE SCREENS NEED IT NOW.
 * It was minted for Stripe's `client_reference_id`; the verdict override reuses
 * it as the owner of a relabelled listing, which is what lets an
 * UNAUTHENTICATED public endpoint be safe — an override belongs to the browser
 * that made it and can never change what anyone else sees. Full reasoning in
 * `src/api/overrides.ts`.
 */
export const REFKEY = "assyze:ref";
export function deviceRef(): string {
  let v = localStorage.getItem(REFKEY);
  if (!v) {
    v = crypto.randomUUID().replace(/-/g, "");
    localStorage.setItem(REFKEY, v);
  }
  return v;
}

/**
 * VAPID key, base64url to bytes.
 *
 * ⚠ RETURNS `ArrayBuffer`, NOT `Uint8Array`. `applicationServerKey` wants a
 * `BufferSource`, and a `Uint8Array<ArrayBufferLike>` is not one now that
 * ArrayBufferLike includes SharedArrayBuffer, which is not transferable. The
 * underlying buffer is the honest type here and it satisfies the API directly.
 */
export function urlB64ToBytes(s: string): ArrayBuffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

// ------------------------------------------------------------ scroll memory
/**
 * WHERE YOU WERE, so Back puts you back there.
 *
 * Yish, 2026-08-31: *"the only back button that works is when I click the
 * assyze logo … but that always brings me back to the top of the homepage, and
 * that's frustrating if I'm halfway down the listings and click one then go
 * back."*
 *
 * ⚠ THE BROWSER'S OWN `scrollRestoration` CANNOT DO THIS AND THAT IS NOT A
 * BUG IN THE BROWSER. It restores the offset when the document is restored,
 * which for this app is a mount with `items === null` and a feed that is 0px
 * tall. There is nothing to scroll to yet, the attempt clamps to 0, and by the
 * time 60 cards exist the browser has finished. Restoration has to happen when
 * the ROWS land, which only the feed knows.
 *
 * ⚠ AND THE OFFSET ALONE IS NOT ENOUGH — see `restoreLimit` in nav.ts. A saved
 * position inside page 3 is meaningless against a feed that just fetched page 1.
 */

/**
 * ⚠ WHICH ELEMENT SCROLLS DEPENDS ON THE VIEWPORT, AND BOTH CASES ARE REAL.
 *
 * On a phone the DOCUMENT scrolls — deliberately, because that is what makes
 * momentum and the URL bar behave. Inside the desktop phone frame the app is a
 * fixed 780px box, so `10-desktop.css` moves the scroller onto `.scroll`.
 * Writing `scrollTop` on the wrong one of those two is a silent no-op.
 *
 * The overflow is READ rather than assumed, so this stays correct if the
 * breakpoint moves.
 */
export function scrollHost(): HTMLElement {
  const pane = document.querySelector<HTMLElement>(".scroll");
  if (pane && getComputedStyle(pane).overflowY === "auto") return pane;
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

export type Spot = { y: number; n: number };
const SPOTS = new Map<string, Spot>();

/**
 * ⚠ ONLY A *BACK* NAVIGATION RESTORES. Tapping the Deals tab, or the wordmark,
 * is a request to start at the top — restoring there would mean the feed could
 * never be returned to its beginning without a reload.
 *
 * This listener is registered at MODULE SCOPE on purpose: it has to observe
 * `popstate` before the router's own handler re-renders and mounts the feed,
 * and a listener added inside a React effect is registered later than one added
 * at import time.
 */
let popNav = false;
if (typeof addEventListener === "function") {
  addEventListener("popstate", () => { popNav = true; });
}

/**
 * How many rows the feed currently has loaded.
 *
 * ⚠ PUBLISHED, NOT PASSED. `go()` lives in the router and has to record the
 * spot for EVERY way out of the feed — a card, the Settings gear, a share link
 * — but only the feed knows how many pages are open. Threading a prop into the
 * router for that would invert the dependency; this is the same module-level
 * bus as `toast` and the filter count, for the same reason.
 */
let rows = 0;
export const setFeedRows = (n: number) => { rows = n; };
export const feedRows = () => rows;

/** Leaving a screen forward: write down where we were and how much was loaded. */
export function rememberSpot(key: string, n: number) {
  popNav = false;
  SPOTS.set(key, { y: scrollHost().scrollTop, n });
}

/**
 * The saved spot for this key, but ONLY if we arrived here by going back.
 *
 * Reading it consumes the pop, not the spot: back → detail → back again must
 * land in the same place twice.
 */
export function popSpot(key: string): Spot | null {
  if (!popNav) return null;
  popNav = false;
  return SPOTS.get(key) ?? null;
}

/**
 * Put the scroller back, and keep trying briefly.
 *
 * `.gshot` reserves its height with `aspect-ratio`, so the layout is usually
 * final at first paint and the first write lands. Usually is not always — a
 * late font, a two-line title, the hero's own image — so it re-applies on the
 * next frame and once more shortly after.
 *
 * ⚠ IT MUST STOP THE MOMENT THE USER TOUCHES ANYTHING. A restore that keeps
 * firing after someone has started scrolling is the app yanking the page out of
 * their hand, which is worse than not restoring at all.
 */
export function restoreScroll(y: number) {
  const host = scrollHost();
  let live = true;
  const stop = () => { live = false; cleanup(); };
  const cleanup = () => {
    removeEventListener("wheel", stop);
    removeEventListener("touchstart", stop);
    removeEventListener("keydown", stop);
  };
  addEventListener("wheel", stop, { passive: true, once: true });
  addEventListener("touchstart", stop, { passive: true, once: true });
  addEventListener("keydown", stop, { once: true });

  const put = () => { if (live) host.scrollTop = y; };
  put();
  requestAnimationFrame(put);
  setTimeout(() => { put(); cleanup(); }, 140);
}

/**
 * The Filters button lives in the TOP BAR, and the sheet lives in the feed.
 *
 * ⚠ THIS EXISTS BECAUSE THE BUTTON DID NOT FIT NEXT TO THE SEGMENT CONTROL.
 * Measured on a real Galaxy S24 (360 x 780 @3x, Android UA): the four chips
 * plus a 44px Filters button need more room than 360px has, and the "All 387"
 * chip was clipped 22px past the control's right edge. iPhone SE clipped 62px,
 * Pixel 7 clipped 13px — and an iPhone 14 at 390px clipped nothing, which is
 * why hand-picked 375/390 test widths never saw it.
 *
 * Moving the button to the bar frees the whole row. That splits one control
 * across two components, so this is the wire between them: the same
 * module-level pattern as `toast`, chosen over lifting the filter state into
 * `App` because the state already lives in the URL and the FEED is the only
 * thing that knows the facet counts the sheet renders.
 */
const openListeners = new Set<() => void>();
const countListeners = new Set<(n: number) => void>();

/** Top bar -> feed: open the sheet. */
export const openFilters = () => openListeners.forEach((fn) => fn());
export function onOpenFilters(fn: () => void) {
  openListeners.add(fn);
  return () => { openListeners.delete(fn); };
}

/**
 * Feed -> the head: when the crawler last ran and what it found.
 *
 * ⚠ SAME BUS AS THE FILTER COUNT, AND FOR THE SAME REASON. The feedhead is
 * rendered by `App` and the numbers arrive in the FEED's response, so either
 * `App` learns to fetch the feed (a second request for data it already has) or
 * the feed publishes. Yish: *"I want to understand better when new listings get
 * added because I want to know when to look at Assyze."*
 */
export type Freshness = { at: string | null; fresh: number; everyMs: number };
const freshListeners = new Set<(f: Freshness) => void>();
export const publishFreshness = (f: Freshness) => freshListeners.forEach((fn) => fn(f));
export function onFreshness(fn: (f: Freshness) => void) {
  freshListeners.add(fn);
  return () => { freshListeners.delete(fn); };
}

/**
 * "Checked 2 min ago · 12 new in the last hour".
 *
 * ⚠ IT REPLACES THE SUBTITLE RATHER THAN SITTING BELOW IT. The static line
 * ("Only what the engine verified, best first.") is read once and never again;
 * this is useful every single visit. Adding a row would undo the density pass
 * that just took 51px off the top of every screen.
 */
export function freshnessLine(f: Freshness | null): string | null {
  if (!f?.at) return null;
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(f.at)) / 60000));
  const when = mins < 1 ? "just now" : mins === 1 ? "1 min ago" : `${mins} min ago`;
  const every = Math.round(f.everyMs / 60000);
  // No new listings is worth saying plainly — it is the answer to "should I
  // open this", and dressing it up as activity is how a status line stops
  // being read.
  const found = f.fresh > 0
    ? `${f.fresh} new in the last hour`
    : `nothing new yet, checking every ${every} min`;
  return `Checked ${when} · ${found}`;
}

/** Feed -> top bar: how many filters are on, for the badge. */
export const publishFilterCount = (n: number) => countListeners.forEach((fn) => fn(n));
export function onFilterCount(fn: (n: number) => void) {
  countListeners.add(fn);
  return () => { countListeners.delete(fn); };
}
