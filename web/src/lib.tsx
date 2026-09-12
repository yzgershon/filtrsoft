/**
 * Formatting, device storage, toasts, sharing and the shared Thumb.
 *
 * Split out of a 2,802-line `App.tsx` (audit commit 6). THE SPLIT IS BY
 * SCREEN, NOT BY KIND. Everything one screen needs sits together, so a change
 * to the feed is one file rather than a hunt through a components/, a hooks/
 * and a utils/ for three pieces of the same feature.
 */

import { useEffect, useState } from "react";
import { Alert, Check, Cross, Ghost } from "./icons.tsx";
import type { Call, Hist } from "./types.ts";
import { mergeSettings, DEFAULT_SETTINGS, SETTINGS_KEY, type Settings } from "./nav.ts";

import {money} from './money.ts';
export {money} from './money.ts';
export const ago = (iso: string | null) => {
  if (!iso) return null;
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? "listed today" : d === 1 ? "listed yesterday" : `listed ${d} days ago`;
};

/**
 * How long ago it was LISTED, for the tag on the card photo — or `null`.
 *
 * ⚠ IT GOES QUIET PAST THREE DAYS, AND THAT IS THE ENTIRE POINT.
 *
 * Yish, 2026-09-01: *"anything that was listed for more than 3 days doesnt
 * have the tag at all this way not every post has a tag because theres no
 * point of a 22 days tag on a listing."*
 *
 * A tag on every card is a column, not a signal. Because most of the feed is
 * older than three days, the tag appearing at all is what carries the meaning:
 * it marks the listings still worth racing for. `"20 Min"` on a 4090 is the
 * most valuable string in this app.
 *
 * ⚠ NO COLOUR ON IT, however tempting a green "20 Min" looks. The card's rule
 * is that VERDICT colour is the only colour that means anything (see `.gloc`
 * in feed.tsx); a second coloured badge on the same photo competes with the
 * one signal the card exists to carry.
 *
 * `postedAt` is the SELLER's clock, not ours — a listing we crawled a minute
 * ago may have been up for a week, and racing for that one is how you drive to
 * something already sold. Null when the source never gave a date, which is
 * most of Facebook; no date means no tag rather than a guessed one.
 */
export function listedAge(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  // A future timestamp is a bad parse or a seller's timezone, not a listing
  // from tomorrow. Clamp rather than print "-3 Hrs".
  const mins = Math.max(0, Math.floor(ms / 60_000));
  if (mins < 60) return `${Math.max(1, mins)} Min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ${hrs === 1 ? "Hr" : "Hrs"}`;
  const days = Math.floor(hrs / 24);
  /**
   * ⚠ THE CUTOFF IS "THE LABEL WOULD HAVE TO SAY 4", NOT "72 HOURS EXACTLY".
   * `"3 Days"` therefore covers the whole fourth day, the way `"2 Days"` covers
   * the third. Cutting at 72.0h would make `"3 Days"` renderable for a
   * one-hour window in its entire life — a label in the vocabulary he asked for
   * that nobody would ever see. Pinned in `web-shell.test.ts`.
   */
  if (days > 3) return null;
  return `${days} ${days === 1 ? "Day" : "Days"}`;
}
export const LABEL: Record<Call, string> = {
  BUY: "Buy it", FAIR: "Fair price", PASS: "Pass", VERIFY: "Verify first",
  RISK: "Risky", INSUFFICIENT_DATA: "Can't tell", OUT_OF_SCOPE: "Not covered",
};

// -------------------------------------------------------------- storage
export const HKEY = "filtrsoft:history";
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
export const WKEY = "filtrsoft:watch";
export const readWatch = (): number[] => { try { return JSON.parse(localStorage.getItem(WKEY) || "[]"); } catch { return []; } };
export const writeWatch = (ids: number[]) => localStorage.setItem(WKEY, JSON.stringify(ids.slice(0, 200)));
export const toggleWatch = (id: number): number[] => {
  const cur = readWatch();
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur];
  writeWatch(next);
  return next;
};

/**
 * ───────────────────────────────────────────────── the notification log
 *
 * Every deal the pulse announced, kept so the bell has something behind it.
 *
 * ⚠ THE BANNER IS NOT A RECORD. It shows for nine seconds and it is gone, so
 * a deal that landed while the phone was in his pocket was announced to nobody
 * and then lost — the whole point of a 0.7-per-day signal is that you can come
 * back to it. This is written by the SAME pulse tick that raises the banner,
 * so the two can never disagree about what arrived.
 *
 * ⚠ IT STORES THE LISTING ID, NOT THE VERDICT. A call can change between the
 * alert and the tap (a re-score, or one of his own overrides), and a
 * notification list asserting BUY next to a row the feed now calls RISK is
 * worse than no list. The call here is what it was WHEN IT FIRED, labelled as
 * such by the timestamp; the listing itself is always re-read on open.
 */
export const NKEY = "filtrsoft:notes";
export type Note = {
  id: number; title: string; call: Call;
  askingPriceCents: number | null; thumb: string | null;
  at: number; seen?: boolean;
};
export const readNotes = (): Note[] => {
  try { return JSON.parse(localStorage.getItem(NKEY) || "[]"); } catch { return []; }
};
/** Newest first, deduped by listing, capped at 60. */
export function pushNotes(items: Note[]): Note[] {
  const fresh = items.filter((n) => n && typeof n.id === "number");
  if (!fresh.length) return readNotes();
  const seenIds = new Set(fresh.map((n) => n.id));
  const next = [...fresh, ...readNotes().filter((n) => !seenIds.has(n.id))].slice(0, 60);
  try { localStorage.setItem(NKEY, JSON.stringify(next)); } catch { /* private mode */ }
  notesListeners.forEach((fn) => fn(next));
  return next;
}
export function markNotesSeen(): Note[] {
  const next = readNotes().map((n) => ({ ...n, seen: true }));
  try { localStorage.setItem(NKEY, JSON.stringify(next)); } catch { /* private mode */ }
  notesListeners.forEach((fn) => fn(next));
  return next;
}
export const unseenNotes = (n: Note[]) => n.filter((x) => !x.seen).length;
const notesListeners = new Set<(n: Note[]) => void>();
/** The bell lives in the top bar and the writer is the pulse, three files away. */
export function onNotes(fn: (n: Note[]) => void) {
  notesListeners.add(fn);
  return () => { notesListeners.delete(fn); };
}

/**
 * Which checks we have already asked about, so nobody gets nagged twice.
 *
 * Stored separately from the history rather than as a flag on it: the history
 * is capped at 30 and rolls, and an answer must survive its listing falling off
 * the end or the same listing would come back around and ask again.
 */
export const AKEY = "filtrsoft:asked";
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

// ------------------------------------------------------------ session loss
/**
 * "The server just told us this session is no longer valid."
 *
 * ⚠ WITHOUT THIS, AN EXPIRED SESSION LOOKS LIKE A BROKEN APP. The feed's own
 * error path cannot tell a 401 from a 500 — both are "the request failed" — so
 * it would render "Couldn't load deals · Try again", and trying again would
 * fail forever with no hint that the fix is to sign in.
 *
 * A module-level bus rather than a prop, for the same reason as the toasts:
 * the fetch sites are scattered and the only listener is the shell, four
 * levels up.
 */
const authLostListeners = new Set<() => void>();
export const publishAuthLost = () => authLostListeners.forEach((fn) => fn());
export function onAuthLost(fn: () => void) {
  authLostListeners.add(fn);
  return () => { authLostListeners.delete(fn); };
}

// ------------------------------------------------------------- deal alerts
/**
 * The banner that drops from the top when a deal lands while the app is open.
 *
 * ⚠ IT IS NOT A `toast()`, AND THE DIFFERENCE IS THE POINT. A toast is
 * bottom-anchored, un-tappable, gone in 1.8s and confirms something YOU just
 * did. This announces something the CRAWLER did, has to be tappable, and has
 * to survive long enough to be tapped. Two behaviours, two components.
 *
 * ⚠ ONE BANNER AT A TIME, NEWEST WINS. Stacking these turns a good tick into a
 * wall of cards over the feed; the banner names the newest listing and counts
 * the rest.
 */
export type DealAlert = {
  id: number; title: string; call: Call;
  askingPriceCents: number | null; thumb: string | null;
  /** How many landed in the same tick, including this one. */
  more: number;
};
const alertListeners = new Set<(a: DealAlert) => void>();
export const publishDealAlert = (a: DealAlert) => alertListeners.forEach((fn) => fn(a));
export function onDealAlert(fn: (a: DealAlert) => void) {
  alertListeners.add(fn);
  return () => { alertListeners.delete(fn); };
}

export function DealBanner({ onOpen, onSegment }: {
  onOpen: (id: number) => void;
  onSegment: () => void;
}) {
  const [a, setA] = useState<DealAlert | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => onDealAlert((next) => { setLeaving(false); setA(next); }), []);

  /**
   * ⚠ 9 SECONDS, AND THE TIMER RESTARTS ON EACH NEW ALERT.
   *
   * A toast can be 1.8s because it only confirms. This one asks for a decision
   * — read the title, read the price, decide whether to tap — and it fires
   * about five times a week, so there is no cost to letting it sit. Keyed on
   * `a?.id` so a second deal landing does not inherit the first one's
   * remaining time and vanish half-read.
   */
  useEffect(() => {
    if (!a) return;
    const t = setTimeout(() => setLeaving(true), 9000);
    const gone = setTimeout(() => setA(null), 9200);
    return () => { clearTimeout(t); clearTimeout(gone); };
  }, [a?.id]);

  if (!a) return null;
  const many = a.more > 1;

  return (
    /**
     * ⚠ THE `b-*` VERDICT CLASS GOES ON THE ROOT, not on the dot it colours.
     * `--vc` is a custom property and those inherit DOWNWARDS only, so setting
     * it on a child leaves the border, the tint and the kicker still hardcoded
     * green — and a VERIFY alert would arrive dressed as a BUY, which is the
     * one thing this banner must never do.
     */
    <div className={`dealbanner b-${a.call}${leaving ? " out" : ""}`} role="status" aria-live="polite">
      <button className="dbmain" onClick={() => {
        setA(null);
        // One deal names itself and goes straight there. Several would be a
        // guess about which one he meant, so they go to the segment.
        if (many) onSegment(); else onOpen(a.id);
      }}>
        <span className="dbshot">
          {a.thumb ? <img src={a.thumb} alt="" loading="lazy" /> : <Ghost size={18} />}
        </span>
        <span className="dbtext">
          <span className="dbkick">
            <i className="dbdot" aria-hidden="true" />
            {many ? `${a.more} new deals` : `New ${LABEL[a.call]}`}
          </span>
          <b>{many ? `${a.title} and ${a.more - 1} more` : a.title}</b>
        </span>
        {!many && a.askingPriceCents != null && (
          <span className="dbprice num">{money(a.askingPriceCents)}</span>
        )}
      </button>
      <button className="dbx" onClick={() => setA(null)} aria-label="Dismiss">
        <Cross size={14} />
      </button>
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
export function Thumb({src,fallbacks=[],size=22}:{src:string|null;fallbacks?:string[];size?:number}) {
  const candidates=[...new Set([src,...fallbacks].filter((s):s is string=>!!s))].slice(0,4);
  const identity=JSON.stringify(candidates);
  const [failure,setFailure]=useState({identity,at:0});
  const at=failure.identity===identity?failure.at:0;
  const current=candidates[at];
  if(!current)return <span className="noimg"><Ghost size={size}/></span>;
  // A cache miss or expired first photo must not hide a working later photo.
  // Each URL is attempted once; a fresh gallery resets the sequence.
  return <img key={current} src={current} alt="" loading="lazy" onError={()=>setFailure({identity,at:at+1})}/>;
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
export const SUBKEY = "filtrsoft:subId";

/** Re-register the browser's actual subscription after sign-in or an upgrade.
 * A cached numeric ID proves no ownership; getSubscription needs no new prompt.
 */
export async function reconcilePushSubscription(): Promise<number | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) { localStorage.removeItem(SUBKEY); return null; }
  const response=await fetch("/v1/push/subscribe",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(sub.toJSON())});
  const data=await response.json();
  if(!response.ok || !data.subId)throw new Error(data.error??"Couldn't register this device.");
  localStorage.setItem(SUBKEY,String(data.subId));
  return data.subId;
}

/**
 * A stable per-device id.
 *
 * ⚠ IT LIVES HERE, NOT IN `screens.tsx`, BECAUSE THREE SCREENS NEED IT NOW.
 * It was minted for Stripe's `client_reference_id`; the verdict override reuses
 * it as the owner of a relabelled listing, which is what lets an
 * account_devices link survive the transition to authenticated ownership.
 * The ref locates records; the server session authorizes them.
 */
export const REFKEY = "filtrsoft:ref";
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
 * filtrsoft logo … but that always brings me back to the top of the homepage, and
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

export type Spot = { y: number; n: number; focus?: string };
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
  const active = document.activeElement as HTMLElement | null;
  const id = active?.dataset.openListingId;
  const label = active?.getAttribute("aria-label");
  const focus = id ? `[data-open-listing-id="${CSS.escape(id)}"]` : active?.id ? `#${CSS.escape(active.id)}` : label ? `[aria-label="${CSS.escape(label)}"]` : undefined;
  SPOTS.set(key, { y: scrollHost().scrollTop, n, focus });
}

/** Returning to a different tab resumes its context; tapping the active tab
 * still goes to the top. Feed consumes this before fetching its saved window. */
export const prepareSpotRestore = () => { popNav = true; };
export function clearRouteSpots() { SPOTS.clear(); popNav = false; }
export function restoreRouteSpot(key: string) {
  const spot = SPOTS.get(key);
  const main = document.getElementById("main-content");
  if (!spot || !main) { main?.focus({ preventScroll: true }); return; }
  let done = false;
  const restore = () => {
    if (done) return;
    // Feed owns pagination and scroll restoration. Other tabs may need to wait
    // for their request before the saved position has enough content to exist.
    if (location.pathname !== "/") scrollHost().scrollTop = spot.y;
    const target = spot.focus ? main.querySelector<HTMLElement>(spot.focus) : null;
    target?.focus({ preventScroll: true });
  };
  const observer = new MutationObserver(restore); observer.observe(main, { childList: true, subtree: true });
  const stop = () => { done = true; observer.disconnect(); clearTimeout(timer); removeEventListener("pointerdown", stop); removeEventListener("wheel", stop); removeEventListener("keydown", stop); };
  const timer = setTimeout(stop, 5000);
  addEventListener("pointerdown", stop, { once: true }); addEventListener("wheel", stop, { once: true }); addEventListener("keydown", stop, { once: true });
  restore(); return stop;
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
 * A FORWARD navigation starts at the top of the new screen.
 *
 * ⚠ THIS WAS MISSING ENTIRELY, AND IT IS WHY OPENING A LISTING LANDED YOU
 * MID-PAGE. Yish, 2026-09-01: *"when I click a listing it doesnt start at the
 * top of the listing it goes to the where $X comes from and check when you get
 * there section."*
 *
 * The scroller is the DOCUMENT and it is shared by every screen, so its
 * `scrollTop` survives a route change. Tap a card 900px down the feed and the
 * detail mounts still scrolled 900px down — which lands on whatever section
 * happens to sit there, in his case the valuation breakdown. Nothing ever
 * reset it: `restoreScroll` only runs on BACK, which is the case that must
 * *not* go to the top.
 *
 * It reuses `restoreScroll(0)` rather than writing `scrollTop = 0` once,
 * because the target screen's content lands over the next few frames and a
 * single synchronous write can be undone by the browser's own anchoring as the
 * taller feed unmounts. The same "stop if the user touches anything" guard
 * applies, for the same reason.
 */
export const scrollToTop = () => restoreScroll(0);

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
 * added because I want to know when to look at Filtrsoft."*
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
