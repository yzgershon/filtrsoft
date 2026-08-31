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

/** Feed -> top bar: how many filters are on, for the badge. */
export const publishFilterCount = (n: number) => countListeners.forEach((fn) => fn(n));
export function onFilterCount(fn: (n: number) => void) {
  countListeners.add(fn);
  return () => { countListeners.delete(fn); };
}
