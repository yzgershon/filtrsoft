import { Popup, MenuRow } from "./popup.tsx";
/**
 * The application shell: the router, and the screen it hands off to.
 *
 * THIS FILE WAS 2,802 LINES (audit commit 6). It is the routing and the
 * top-level composition only now. Every screen lives in its own module, and
 * the parts decidable from a string (routes, settings, filters) live in
 * `nav.ts` where `bun test` can pin them without a DOM.
 */
import { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import {CompareIcon} from './icons.tsx';
const ComparisonScreen=lazy(()=>import('./compare.tsx'));
import { Back, Bell, Clip, Link, Again, Sliders, User, Grid, Scan, Save, Gear, Shield, Store, Info } from "./icons.tsx";
import { BrandMark, Wordmark } from "./brand.tsx";
import type { Comp, Hist, Listing, Meta, Signal, Verdict } from "./types.ts";
import {
  LABEL, Toaster, pushHist, readHist, readAsked, readWatch, writeWatch,
  readSettings, writeSettings, pendingOutcome, shareOrCopy, toast,
  openFilters, onFilterCount, rememberSpot, feedRows, deviceRef, scrollToTop,
  onFreshness, freshnessLine, type Freshness,
  DealBanner, publishDealAlert, pushNotes, readNotes, onNotes, unseenNotes,
  onAuthLost, publishAuthLost, prepareSpotRestore, restoreRouteSpot, clearRouteSpots,
} from "./lib.tsx";
import { NAVIGATE, POPUP_KEY, historyDepth, pushRoute, replaceRoute, tabDestination, clearTabRoutes } from "./history.ts";
import { ScreenBoundary } from "./request-state.tsx";
import { Feed } from "./feed.tsx";
import { Report } from "./detail.tsx";
import {
  OutcomePrompt, SettingsScreen, Tabbar, Watchlist,
} from "./screens.tsx";
import {
  MoreScreen, NotificationsScreen, AccountScreen, HowScreen,
} from "./more.tsx";
import { Landing, AuthScreen, type Providers, type Account } from "./landing.tsx";

/**
 * Screens the bottom bar cannot reach, and which therefore must carry a Back
 * button. Kept as data next to the router so adding a screen is one edit.
 */
const NO_TAB_SCREENS = new Set(["settings", "notifications", "account", "how", "compare"]);
/**
 * Routing, settings and the feed query live in `nav.ts` because they are the
 * parts of the shell that are decidable from a string, and `bun test` can pin
 * them there without a DOM. Re-exported so the module boundary is an
 * implementation detail rather than a second import path for callers.
 */
import {
  type Screen, type Settings, type Quality, type Filters, type Sort,
  screenOf, tabOf, mergeSettings, clampDrive, checkQuery,
  DEFAULT_SETTINGS, SETTINGS_KEY, DRIVE_MIN, DRIVE_MAX, DRIVE_STEP,
  NO_FILTERS, CATEGORIES, SOURCES, SORTS, sourceLabel,
  filtersFromSearch, searchFromFilters, activeFilterCount, feedUrl,
} from "./nav.ts";
export { screenOf, tabOf } from "./nav.ts";
export type { Screen, Settings } from "./nav.ts";
// --------------------------------------------------------------- router
/**
 * `screenOf` derives the COMPLETE screen from the path (see `nav.ts`), so
 * `popstate`, a refresh, a deep link and a tab press all go through one
 * function and cannot produce different answers.
 */
function useRoute() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    replaceRoute(location.href, false);
    const on = (event: Event) => {
      // Closed panels leave a forward entry. Skip it so Forward cannot add an
      // invisible stop between a listing and the feed on the next Back press.
      if (event.type === "popstate" && history.state?.[POPUP_KEY]) { history.back(); return; }
      document.documentElement.dataset.navigation = event.type === "popstate" ? "back" : (event as CustomEvent).detail?.restore ? "restore" : "forward";
      setPath(location.pathname);
    };
    addEventListener("popstate", on);
    addEventListener(NAVIGATE, on);
    return () => { removeEventListener("popstate", on); removeEventListener(NAVIGATE, on); };
  }, []);
  const mark = () => rememberSpot(location.pathname + location.search, feedRows());
  return {
    path, screen: screenOf(path),
    go: useCallback((p: string, restore = false) => {
      const target = new URL(p, location.href);
      if (target.pathname + target.search + target.hash === location.pathname + location.search + location.hash) { if(target.hash)dispatchEvent(new Event(NAVIGATE));else scrollToTop(); return; }
      mark(); if (restore) prepareSpotRestore(); pushRoute(p, restore); if (!restore && !target.hash) scrollToTop();
    }, []),
    replace: useCallback((p: string) => { mark(); replaceRoute(p); }, []),
    back: useCallback(() => {
      if (historyDepth() > 0) history.back();
      else replaceRoute("/");
    }, []),
  };
}

/**
 * Poll for deals that land while the app is open, and raise the banner.
 *
 * ⚠ ONLY WHILE THE TAB IS VISIBLE. A backgrounded PWA polling every minute
 * forever is a battery complaint with a feature attached, and the answer is
 * worthless anyway — nobody is looking. `visibilitychange` starts and stops it,
 * and coming back to the foreground fires one immediately rather than waiting
 * out the interval, because returning to the app is exactly when you want to
 * know.
 *
 * ⚠ THE FIRST RESPONSE ONLY SETS THE CLOCK. On a cold start `pulseAt` is null,
 * the server is told nothing, and it deliberately returns no items — so opening
 * the app never greets you with three banners for listings that have been
 * sitting there since yesterday. That is the same rule `alerts.ts` documents
 * for saved searches, and the reason it exists is that violating it gets
 * notifications switched off within a minute of being switched on.
 *
 * ⚠ THE WATERMARK ADVANCES ON EVERY TICK, INCLUDING A TICK THAT ALERTED. Not
 * advancing it re-announces the same listing every 60 seconds until it falls
 * out of the window.
 */
const PULSE_MS = 60_000;

function useDealPulse(enabled: boolean, verify: boolean, onDeal: (items: any[]) => void) {
  /**
   * Refs, not deps. Rebuilding the interval whenever a setting or the callback
   * identity changes would reset the 60-second cycle on every render, and a
   * timer that keeps restarting is a timer that never fires.
   */
  const since = useRef<string | null>(null);
  const pulseCursor=useRef<string|null>(null);
  const cb = useRef(onDeal);
  cb.current = onDeal;
  const wantVerify = useRef(verify);
  wantVerify.current = verify;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false,polling=false;
    let timer: number | undefined;

    const tick = async () => {
      if (stopped || polling || document.visibilityState !== "visible") return;
      polling=true;
      try {
        const p = new URLSearchParams({ ref: deviceRef() });
        if (pulseCursor.current)p.set("cursor",pulseCursor.current);
        else if (since.current) p.set("since", since.current);
        if (wantVerify.current) p.set("verify", "1");
        const response=await fetch(`/v1/pulse?${p}`);
        if(!response.ok)return;
        const d=await response.json();
        if (stopped) return;
        // Advance FIRST: an exception in the callback must not make the same
        // listing alert again on the next tick.
        const first = since.current === null;
        since.current = d.now ?? since.current;
        pulseCursor.current=d.cursor??pulseCursor.current;
        if (!first && Array.isArray(d.items) && d.items.length) cb.current(d.items);
        if(d.hasMore)setTimeout(()=>void tick(),250);
      } catch { /* offline; the next tick tries again */ } finally {polling=false;}
    };

    const onVis = () => { if (document.visibilityState === "visible") void tick(); };
    void tick();
    timer = setInterval(tick, PULSE_MS) as unknown as number;
    addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      clearInterval(timer);
      removeEventListener("visibilitychange", onVis);
    };
  }, [enabled]);
}

/**
 * ─────────────────────────────────────────────────────────── the auth gate
 *
 * Three states, and the middle one matters as much as the other two:
 *
 *   · `loading`  — we have not asked the server yet. Renders NOTHING, because
 *                  flashing the marketing page at a signed-in user for 200ms
 *                  on every launch is the same class of bug as the Check-screen
 *                  flash he reported, and more jarring.
 *   · `out`      — marketing site, or the signup/signin screen.
 *   · `in`       — the app.
 *
 * ⚠ THE SERVER IS THE AUTHORITY, NOT LOCALSTORAGE. Caching "signed in" locally
 * would show the whole app shell to someone whose session expired, and every
 * request inside it would 401 — a broken app rather than a sign-in prompt.
 * `/v1/auth/me` is one request on launch and it is the truth.
 */
function useAuth() {
  const [state, setState] = useState<"loading" | "in" | "out">("loading");
  const [user, setUser] = useState<Account | null>(null);
  const [providers, setProviders] = useState<Providers | null>(null);
  const [failed, setFailed] = useState(false);

  /**
   * ⚠ ONLY A REAL ANSWER FROM THE SERVER MOVES THIS OUT OF `loading`.
   *
   * "The request failed" and "you are signed out" are different facts and the
   * first must never be rendered as the second — a 429, a dropped connection
   * or a cold container would otherwise dump a signed-in user onto the
   * marketing page mid-session. `ui-verify` hit exactly this: ten browser
   * contexts from one address tripped the rate limit and the app decided
   * everyone was logged out.
   *
   * So: retry a failure once, briefly, and only treat a 200 with `user: null`
   * as signed-out. A second failure shows a retry without guessing the session state.
   */
  const generation=useRef(0), request=useRef<AbortController|null>(null), retryTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const invalidate=useCallback(()=>{generation.current++;request.current?.abort();clearTimeout(retryTimer.current);},[]);
  const refresh=useCallback(()=>{
    invalidate();const token=generation.current,controller=new AbortController();request.current=controller;setFailed(false);
    const load=async(attempt:number)=>{
      try{
        const response=await fetch('/v1/auth/me',{cache:'no-store',signal:controller.signal});
        if(!response.ok)throw new Error(String(response.status));
        const d=await response.json();
        if(!d || !Object.hasOwn(d,'user') || (d.user!==null && (!Number.isInteger(d.user?.id) || typeof d.user?.email!=='string')))throw new Error('Incomplete session response');
        if(token!==generation.current || controller.signal.aborted)return;
        setProviders(d.providers??null);setUser(d.user);setState(d.user?'in':'out');
      }catch{
        if(token!==generation.current || controller.signal.aborted)return;
        if(attempt<1)retryTimer.current=setTimeout(()=>void load(attempt+1),1200);else setFailed(true);
      }
    };
    void load(0);
  },[invalidate]);
  useEffect(()=>{refresh();return invalidate;},[refresh,invalidate]);

  /**
   * ⚠ ANY 401 ANYWHERE IN THE APP RE-ASKS THE SERVER, rather than flipping
   * straight to signed-out. The 401 might be one stale in-flight request from
   * before a re-auth, and dropping a working session on it would sign someone
   * out mid-scroll. `refresh` is the single authority; this just makes it ask
   * again at the moment there is reason to.
   */
  useEffect(() => onAuthLost(() => refresh()), [refresh]);

  return { state, user, providers, setUser, setState, refresh, failed, invalidate };
}

export default function App() {
  const { path, screen, go, replace, back } = useRoute();
  const auth = useAuth();
  /**
   * Which signed-out screen is showing. Kept in state rather than the URL:
   * `/signin` would be a real route that a signed-IN user could land on, and
   * then the router would owe an answer for a screen that must not exist for
   * them.
   */
  const [authMode, setAuthMode] = useState<"none" | "signup" | "signin">("none");
  /**
   * DERIVED, never stored. A second copy of "which screen am I on" is what let
   * the URL say `/` while a listing detail was still on screen.
   */
  const tab = tabOf(screen);
  const [quickMenu, setQuickMenu] = useState<"more" | "account" | "notifications" | null>(null);
  const [quickNotes, setQuickNotes] = useState(readNotes);
  useEffect(() => onNotes(setQuickNotes), []);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [comps, setComps] = useState<Comp[]>([]);
  const [decisionToken,setDecisionToken]=useState<string|undefined>();
  const [meta, setMeta] = useState<Meta | undefined>(undefined);
  const [stage, setStage] = useState(0);
  const [ms, setMs] = useState<number | null>(null);
  const [reading, setReading] = useState(0);   // photos being read, 0 = not reading
  const [checkId, setCheckId] = useState<number | null>(null);
  const [hist, setHist] = useState<Hist[]>(readHist);
  const [savedCount, setSavedCount] = useState(() => readWatch().length);
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [ask, setAsk] = useState<Hist | null>(() => pendingOutcome(readHist(), readAsked()));
  /**
   * ⚠ THE FILTERS BUTTON IS HERE BECAUSE IT DID NOT FIT BESIDE THE SEGMENT
   * CONTROL. Measured on a real Galaxy S24 (360px, Android UA): four chips
   * plus a 44px button overflow the row and the last chip was CLIPPED 22px
   * past the edge.
   *
   * The count is PUBLISHED by the feed rather than derived here: the filters
   * live in the URL and this component only tracks `pathname`, so reading the
   * badge from `location.search` would go stale the moment a filter changed
   * without a route change.
   */
  /**
   * Bumped when he relabels a listing, so the detail effect re-runs and the
   * screen shows his call rather than the one it fetched a moment ago.
   */
  const [reloadAt, setReloadAt] = useState(0);
  const [filterCount, setFilterCount] = useState(0);
  useEffect(() => onFilterCount(setFilterCount), []);
  const [crawl, setCrawl] = useState<Freshness | null>(null);
  useEffect(() => onFreshness(setCrawl), []);
  /**
   * The bell's badge. Subscribed rather than read once, because the writer is
   * the pulse tick and it fires while this component is already mounted — a
   * `useState(readNotes)` alone would show a stale zero until the next route
   * change.
   */
  const [unseen, setUnseen] = useState(() => unseenNotes(readNotes()));
  useEffect(() => onNotes((n) => setUnseen(unseenNotes(n))), []);
  /**
   * ⚠ THE NEWEST DEAL NAMES ITSELF; THE REST ARE A COUNT. `/v1/pulse` returns
   * newest-first, so `items[0]` is the one worth putting a title and a price
   * on. Announcing all five would stack five cards over the feed for an event
   * that happens five times a WEEK — the volume is the reason this can afford
   * to be loud, and stacking is how it would stop being.
   */
  /**
   * ⚠ `auth.state === "in"` IS PART OF THE ENABLE CONDITION, NOT A GUARD
   * FURTHER DOWN, because a hook cannot be called conditionally.
   *
   * The gate below returns the marketing page before the app shell is built,
   * but `useDealPulse` still RUNS — hooks always do — so a signed-out visitor
   * sitting on the landing page was polling `/v1/pulse` every sixty seconds
   * and collecting a 401 each time. Invisible on screen, real in the network
   * tab, and exactly the failure the comment on that early return warns about.
   * Caught by watching responses rather than the page.
   */
  useDealPulse(auth.state === "in" && settings.alerts, settings.alertVerify, useCallback((items: any[]) => {
    /**
     * ⚠ THE LOG GETS EVERY ITEM; THE BANNER GETS ONE. They are different jobs:
     * the banner interrupts and so must name a single thing, while the bell is
     * a record and must not silently drop four of the five deals in a busy
     * tick. Written first so a render throw cannot lose them.
     */
    pushNotes(items.map((i) => ({
      id: i.id, title: i.title, call: i.call,
      askingPriceCents: i.askingPriceCents ?? null,
      thumb: i.thumb ?? null, at: Date.now(),
    })));
    const top = items[0];
    publishDealAlert({
      id: top.id, title: top.title, call: top.call,
      askingPriceCents: top.askingPriceCents ?? null,
      thumb: top.thumb ?? null,
      more: items.length,
    });
  }, []));
  const es = useRef<EventSource | null>(null);
  const field = useRef<HTMLInputElement | null>(null);

  /**
   * A tab press is now just navigation. The screen follows the URL, so there is
   * nothing to keep in sync by hand.
   */
  const PATH_FOR: Record<"deals" | "check" | "saved" | "more" | "settings", string> = {
    deals: "/", check: "/check", saved: "/saved", more: "/more", settings: "/settings",
  };
  const goTab = useCallback((t: "deals" | "check" | "saved" | "more" | "settings") => {
    setSavedCount(readWatch().length);
    go(tabDestination(t) ?? PATH_FOR[t], screen.name !== t);
  }, [go, screen.name]);

  const focusedRoute = useRef<string | null>(null);
  useEffect(() => {
    if (auth.state !== "in") return;
    const titles: Record<string, string> = { deals: "Listings", check: "Check listing", saved: "Saved", more: "More", settings: "Settings", account: "Account", notifications: "Notifications", how: "How Filtrsoft works", compare: "Compare hardware", detail: listing?.title || "Listing" };
    document.title = `${titles[screen.name]} · Filtrsoft`;
  }, [auth.state, listing?.title, screen.name]);
  useEffect(() => {
    if (auth.state !== "in") return;
    if (focusedRoute.current === path) return;
    focusedRoute.current = path;
    const restoring = document.documentElement.dataset.navigation !== "forward";
    if (restoring) return restoreRouteSpot(path + location.search);
    const target = document.querySelector<HTMLElement>('#main-content h1') ?? document.getElementById('main-content');
    target?.setAttribute('tabindex', '-1'); target?.focus({ preventScroll: true });
  }, [path, auth.state]);

  const saveSettings = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next); writeSettings(next);
  };

  /**
   * ⚠ REDUCE MOTION NOW REDUCES MOTION.
   *
   * The switch wrote to localStorage and nothing read it — during the audit it
   * was ON while the detail `.rise` entry animation still computed to 0.32s.
   * A class on the root lets one CSS rule disable every animation, including
   * the ones added by later visual passes, without each of them remembering to
   * check a flag.
   */
  useEffect(() => {
    document.documentElement.classList.toggle("no-motion", settings.reduceMotion);
  }, [settings.reduceMotion]);

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme = settings.theme === "system" ? (media.matches ? "dark" : "light") : settings.theme;
      document.documentElement.dataset.theme = theme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f5f6f8" : "#0d1017");
    };
    apply(); media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.theme]);

  useEffect(() => {
    const elements = [document.querySelector('.topbar'), document.querySelector('.tabbar')];
    const measure = () => elements.forEach((el,i) => document.documentElement.style.setProperty(i ? '--app-bottom-nav-height' : '--app-topbar-height', `${el?.getBoundingClientRect().height ?? 0}px`));
    const observer = new ResizeObserver(measure);
    elements.forEach(el => { if(el) observer.observe(el); }); measure();
    return () => observer.disconnect();
  }, [auth.user, screen.name]);

  /**
   * ANDROID SHARE SHEET. The manifest registers `/share` as a share target, so
   * Filtrsoft appears in Chrome's Share menu on a Craigslist page and the whole
   * copy-paste step disappears.
   *
   * **The link usually arrives in `text`, not `url`.** `url` is only populated
   * when the sharing app explicitly marks a field as a URL; Chrome's page share
   * hands over a `text` blob like "Listing title https://boston.craigslist.org/…",
   * so reading `url` alone silently receives nothing on the most common path.
   * Both are checked and a URL is extracted from anywhere in the string.
   *
   * The entry is replaced in history rather than pushed: `/share?...` is a
   * one-shot delivery address, and leaving it in the stack means Back re-runs
   * the check instead of leaving.
   *
   * iOS is NOT supported and cannot be — Web Share Target is Chromium-only and
   * Safari has never shipped it. On iPhone the home-screen install works, the
   * share sheet does not.
   */
  useEffect(() => {
    if (path !== "/share" || auth.state !== "in") return;
    const q = new URLSearchParams(location.search);
    const blob = [q.get("url"), q.get("text"), q.get("title")].filter(Boolean).join(" ");
    const found = blob.match(/https?:\/\/[^\s]+/)?.[0];
    replaceRoute("/", false);
    // The auth/route cleanup effect must finish before creating a new stream.
    // Starting it in this same effect pass immediately cancelled signed-out
    // share deliveries as soon as sign-in resumed them.
    const pending = requestAnimationFrame(() => {
      if (found) runUrl(found);
      else { replace("/check"); setError("That share didn't contain a link. Copy the listing URL and paste it instead."); }
    });
    return () => cancelAnimationFrame(pending);
    // Fires once per delivery; `runUrl` is stable enough for this one-shot.
  }, [path, auth.state]);

  useEffect(() => {
    /**
     * ⚠ CLEARING ON THE WAY OUT IS THE FIX FOR BACK.
     *
     * This effect used to `return` early when the path stopped matching
     * `/c/:id`, which left `listing` and `verdict` populated — so pressing Back
     * changed the URL to `/` and the detail stayed on screen over the feed.
     * The state has to be torn down when the route leaves the detail, not only
     * built up when it arrives.
     */
    if (auth.state !== "in") { reset(); return; }
    if (screen.name !== "detail") {
      if (screen.name !== "check" || listing || verdict) reset();
      return;
    }
    /**
     * ⚠ THE ID COMES FROM `screen`, NOT A SECOND REGEX ON THE PATH.
     *
     * This used to re-match `/^\/c\/(\d+)$/` — no trailing slash — while
     * `screenOf` accepts `/c/123/`. A PWA launched onto a trailing-slash deep
     * link therefore rendered the detail shell and never fetched anything: a
     * permanently blank screen with no error. One derivation, one answer.
     */
    const controller = new AbortController();
    let current = true;
    setError(null); setListing(null); setVerdict(null); setCheckId(null);
    setBusy(true);
    // The Settings stepper is a real input now: it changes the required
    // profit floor, and therefore the verdict, on this screen.
    fetch(checkQuery(screen.id, settings.driveMinutes, deviceRef()), { signal: controller.signal })
      .then(async (r) => {
        if (r.status === 401) publishAuthLost();
        if (!r.ok) throw new Error(r.status === 404 ? "This listing is no longer available." : "Couldn't load this listing. Try again.");
        return r.json();
      }).then((d) => {
      // A slower previous listing must never replace the one named in the URL.
      if (!current) return;
      if (d.error) return setError(d.error);
      setListing(d.listing); setVerdict(d.verdict); setCheckId(d.checkId);
      // The detail endpoint recomputes these; dropping them left the risk
      // layer blank on every listing opened from the feed or a shared link.
      setSignals(d.signals ?? []); setComps(d.comps ?? []); setMeta(d.meta); setDecisionToken(d.decisionToken); setStage(3);
      /**
       * ⚠ HISTORY WAS ONLY EVER WRITTEN BY THE PASTE FLOW, WHICH IS WHY THE
       * LIST WAS ALWAYS EMPTY.
       *
       * `pushHist` was called in exactly one place: the `done` handler of the
       * check stream. So a listing you PASTED was remembered and a listing you
       * TAPPED IN THE FEED was not — and tapping in the feed is how the app is
       * actually used. Yish: *"there's no recently viewed section under the
       * check section because when I click into a listing and go back it
       * should appear there but it doesn't."*
       *
       * Opening a listing is the event worth recording, however you got there,
       * so it is recorded where the listing arrives rather than on one of the
       * two routes to it. `pushHist` already dedupes by id and caps at 30.
       */
      if (d.listing && d.verdict) {
        pushHist({ id: screen.id, title: d.listing.title, call: d.verdict.call, at: Date.now() });
        setHist(readHist());
      }
    }).catch((e) => { if (current && e.name !== "AbortError") setError(e.message || "Couldn't load this listing. Try again."); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; controller.abort(); setBusy(false); };
  }, [path, reloadAt, auth.state, auth.user?.id]);

  const reset = () => {
    es.current?.close(); es.current = null;
    setBusy(false); setError(null); setListing(null); setVerdict(null);
    setSignals([]); setComps([]); setMeta(undefined); setDecisionToken(undefined); setStage(0); setMs(null); setCheckId(null); setReading(0);
  };

  function run(e?: React.FormEvent) {
    e?.preventDefault();
    runUrl(url);
  }

  /**
   * Reading the clipboard IS the primary action on a phone.
   *
   * You arrive here having just copied a link in another app. Making you tap the
   * field, long-press, wait for the bubble and hit Paste is four gestures for
   * something the browser will hand over in one. `readText()` prompts once on
   * Android Chrome and is remembered; if it is refused or unavailable we fall
   * back to focusing the input, which is exactly the old behaviour.
   */
  async function pasteAndCheck() {
    setError(null);
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (!t) { setError("Clipboard is empty. Copy a listing link first."); return; }
      runUrl(t);
    } catch {
      setError("Couldn't read the clipboard. Paste the link into the box instead.");
      field.current?.focus();
    }
  }

  function runUrl(raw: string) {
    const u = raw.trim();
    if (!u || busy) return;
    reset(); setUrl(u); setBusy(true);
    if (screen.name !== "check") replace("/check");

    const src = new EventSource(`/v1/checks/stream?url=${encodeURIComponent(u)}`);
    es.current = src;

    src.addEventListener("fetched", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data);
      setListing({ ...d, url: u, source: "craigslist" }); setStage(1);
    });
    src.addEventListener("signals", (ev) => {
      setSignals(JSON.parse((ev as MessageEvent).data).signals ?? []); setStage(2);
    });
    src.addEventListener("valued", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data);
      setVerdict(d.verdict); setStage(3); setMs(d.elapsedMs);
    });
    src.addEventListener("vision_start", (ev) => {
      setReading(JSON.parse((ev as MessageEvent).data).photoCount ?? 0);
    });
    src.addEventListener("vision", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data);
      setVerdict(d.verdict); setReading(0); setStage(4); setMs(d.elapsedMs);
    });
    src.addEventListener("done", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data);
      setDecisionToken(d.decisionToken);
      if(d.meta) setMeta(d.meta);
      if (d.listingId) {
        setCheckId(d.listingId);
        replaceRoute(`/c/${d.listingId}`);
        if (d.listing && d.verdict) {
          pushHist({ id: d.listingId, title: d.listing.title, call: d.verdict.call, at: Date.now() });
          setHist(readHist());
        }
      }
      setBusy(false); setReading(0); src.close();
    });
    src.addEventListener("error", (ev) => {
      const raw = (ev as MessageEvent).data;
      setError(raw ? JSON.parse(raw).error ?? "Something went wrong." : "Couldn't reach the server.");
      setBusy(false); setStage(0); setReading(0); src.close();
    });
  }

  const fresh = !listing && !busy;

  /**
   * ⚠ THE GATE RETURNS BEFORE THE APP SHELL IS BUILT AT ALL, rather than
   * wrapping it in a conditional further down. A signed-out visitor must not
   * mount the feed, the pulse poller or the tab bar — not because it would
   * look wrong (the server 401s everything anyway) but because a poller
   * hammering a 401 every sixty seconds is a real bug hiding behind a correct
   * screen.
   */
  if (auth.state === "loading") {
    return <div className="app boot" aria-busy={!auth.failed}>
      <span className="mkbrand"><BrandMark size={28} /><Wordmark /></span>
      {auth.failed ? <div role="alert"><p>Couldn't connect to Filtrsoft.</p><button className="btn2" onClick={() => auth.refresh()}>Try again</button></div> : <p role="status">Opening your workspace...</p>}
    </div>;
  }

  if (auth.state === "out") {
    return authMode === "none"
      ? (
        <Landing
          onStart={() => setAuthMode("signup")}
          onSignIn={() => setAuthMode("signin")} />
      )
      : (
        <AuthScreen
          mode={authMode}
          providers={auth.providers}
          onMode={setAuthMode}
          onBack={() => setAuthMode("none")}
          onDone={(u) => {
            auth.invalidate();
            auth.setUser(u);
            auth.setState("in");
            setAuthMode("none");
            /**
             * ⚠ LAND ON THE FEED, NOT ON WHATEVER THE URL SAYS. Someone who
             * arrived on a shared `/c/842` link and then signed up should see
             * the listing they came for — but the common case is `/`, and
             * pushing a route here would put a signed-out URL in the history
             * behind them.
             */
            toast(`Signed in as ${u.name || u.email}`);
          }} />
      );
  }

  return (
    <div className={`app screen-${screen.name}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="workspace-nav" aria-label="Workspace">
        <button className="workspace-brand" onClick={() => goTab("deals")} aria-label="Filtrsoft home"><BrandMark size={27} /><Wordmark /></button>
        <span className="nav-caption">YOUR WORKSPACE</span>
        <nav aria-label="Desktop navigation">
          {[{ id: "deals", label: "Discover", icon: <Grid size={19} />, route: "/" },
            { id: "check", label: "Check a listing", icon: <Scan size={19} />, route: "/check" },
            { id: "saved", label: "Saved listings", icon: <Save size={19} />, route: "/saved" },
            { id: "compare", label: "Compare hardware", icon: <CompareIcon size={19} />, route: "/compare" },
            { id: "notifications", label: "Notifications", icon: <Bell size={19} />, route: "/notifications" }].map(n => (
            <button key={n.id} className={`workspace-link${screen.name === n.id ? " active" : ""}`} aria-current={screen.name === n.id ? "page" : undefined} onClick={() => go(n.route)}>
              {n.icon}<span>{n.label}</span>{n.id === "saved" && savedCount > 0 ? <em>{savedCount}</em> : null}
            </button>
          ))}
        </nav>
        <div className="nav-bottom">
          <button className="workspace-link" onClick={() => go("/settings")}><Gear size={19} /> Preferences</button>
          <button className="workspace-profile" onClick={() => go("/account")}><span className="profile-initial">{(auth.user?.name || "Y").slice(0,1).toUpperCase()}</span><span><b>{auth.user?.name || "Your account"}</b><small>Account & settings</small></span><span aria-hidden="true">↗</span></button>
        </div>
      </aside>
      <header className="topbar">
        {/**
          * ⚠ SETTINGS IS THE ONE SCREEN WITH NOWHERE ELSE TO PUT BACK. The
          * detail screen hangs it on the photo, and Deals / Check / Saved are
          * roots that the tab bar already reaches. Without this the only way
          * out of Settings was pressing the gear a second time, which is a
          * toggle rather than a way back and always landed on the feed.
          */}
        {/**
          * ⚠ EVERY SCREEN THE TAB BAR CANNOT REACH NEEDS A WAY BACK, and the
          * list grew: Settings used to be the only one, and now Notifications,
          * Account and How Filtrsoft works hang off the top bar or the More hub
          * too. Deriving it from `tabOf` rather than naming screens means the
          * next one added cannot be forgotten — a screen with no exit is the
          * bug this originally fixed.
          */}
        {NO_TAB_SCREENS.has(screen.name) && (
          <button className="iconbtn backbtn" onClick={back} aria-label="Back">
            <Back size={20} />
          </button>
        )}
        <button className="brand" onClick={() => goTab("deals")}
          aria-label="Filtrsoft home"><BrandMark className="mark" /><Wordmark /></button>
        <div className="spacer" />

        {/*
          * The header's copy-link icon is GONE. It performed the same clipboard
          * write as the labelled Share button lower down, confirmed nothing, and
          * an unlabelled icon is the worse of the two to keep. Audit S11: keep
          * one action.
          */}
        {/**
          * ⚠ THE ORDER IS FILTER, BELL, PROFILE — LEFT TO RIGHT. Yish,
          * 2026-09-01: *"in the top right they have their profile and there
          * will be a notifications button to the left of that and also the
          * filter will be next to that as well."*
          *
          * The Settings gear that used to sit at the far right is GONE from
          * this bar: it moved into the More tab at the bottom. Leaving a
          * duplicate here would give one screen two entry points that light
          * differently, which is the drift `tabOf` exists to prevent.
          */}
        {/* Deals only: filtering a screen that has no feed is meaningless. */}
        {tab === "deals" && (
          <button className={`iconbtn filtbtn${filterCount ? " on" : ""}`} onClick={openFilters}
            aria-label={filterCount ? `Filters, ${filterCount} active` : "Filters"}>
            <Sliders size={19} />
            {filterCount > 0 && <em className="num">{filterCount}</em>}
          </button>
        )}

        {/**
          * ⚠ THE BELL COUNTS UNSEEN ALERTS, AND IT IS THE ONLY PLACE A MISSED
          * DEAL SURVIVES. The banner is on screen for nine seconds; at 0.7
          * BUYs a day, a phone in a pocket means most of them were announced
          * to nobody. `unseenNotes` clears when the Notifications screen is
          * opened, not when a row is tapped — arriving IS reading them.
          */}
        <button className={`iconbtn bellbtn${unseen ? " on" : ""}`}
          aria-label={unseen ? `Notifications, ${unseen} new` : "Notifications"}
          aria-haspopup="dialog" aria-expanded={quickMenu === "notifications"}
          onClick={() => setQuickMenu("notifications")}>
          <Bell size={19} />
          {unseen > 0 && <em className="num">{unseen > 9 ? "9+" : unseen}</em>}
        </button>

        <button className={`iconbtn avbtn${screen.name === "account" ? " on" : ""}`}
          aria-label="Account" aria-haspopup="dialog" aria-expanded={quickMenu === "account"}
          onClick={() => setQuickMenu("account")}>
          <User size={18} />
        </button>
      </header>

      <main key={path} className="scroll route-enter" id="main-content" tabIndex={-1}>
        <ScreenBoundary key={path}>
            {screen.name === "deals" && (
              <>
                <h1 className="vh">Listings</h1>
                <Feed onOpen={(id) => go(`/c/${id}`)}
                  onWatchChange={setSavedCount} freshness={freshnessLine(crawl)} />
                {settings.askOutcomes && ask && <OutcomePrompt h={ask} onDone={() => setAsk(null)} />}
              </>
            )}

            {(screen.name === "check" || screen.name === "detail") && (
              <>
                {/**
                  * An APP screen, not a landing page.
                  *
                  * This was a 34px marketing headline over three value-prop rows
                  * — copy written to convince a stranger to try the product,
                  * shown to someone who has already installed it. Inside the app
                  * the only question is "what do I do here", so the title states
                  * the task, the clipboard button IS the task, and the pitch is
                  * demoted to a compact "what you get" list.
                  */}

                {/**
                  * The paste box belongs to the CHECK flow, not to a listing.
                  *
                  * Opening a deal from the feed routes through this same screen,
                  * so "Paste a listing link" sat on top of the listing you had
                  * just tapped — asking you to start over on the thing you were
                  * already looking at. A detail view should read as a detail
                  * view.
                  *
                  * ⚠ GATED ON THE ROUTE, NOT ONLY ON `!listing`, AND THAT IS
                  * THE FLASH HE REPORTED. Yish, 2026-09-01: *"for like a
                  * millisecond when clicking a listing it goes to the check
                  * section and then to the listing."*
                  *
                  * `/c/842` renders this same branch, and `listing` is null
                  * for exactly as long as the fetch takes — so the paste box
                  * and the "Check a listing" headline painted first, every
                  * time, and were replaced when the data landed. `!listing`
                  * asks "do we have data yet"; the question here is "which
                  * screen did the user ask for", and only the route knows that.
                  */}
                {screen.name === "check" && !listing && (
                  <>
                    {/* Every screen needs exactly one H1. This one had none —
                        it opened straight onto an orange button, so a screen
                        reader landing here was told nothing about where it was,
                        and the supported sources were only ever explained by
                        failing. */}
                    <div className="feedhead app-page-heading"><h1>Check listing</h1></div>
                    <button className="paste" onClick={pasteAndCheck} disabled={busy}>
                      <Clip size={18} />
                      {busy ? "Checking…" : "Paste link and check"}
                    </button>

                    <div className="ordiv"><span>or type it</span></div>

                    <form className="field" onSubmit={run}>
                      <input
                        ref={field}
                        value={url} onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://boston.craigslist.org/…" inputMode="url"
                        autoCapitalize="off" autoCorrect="off" spellCheck={false}
                        aria-label="Listing URL"
                      />
                      <button className="cta" disabled={busy || !url.trim()}>
                        {busy ? "…" : "Check"}
                      </button>
                    </form>

                    {/**
                      * RECENTLY VIEWED LIVES HERE NOW.
                      *
                      * It was a section in the deals feed, where it competed
                      * with actual deals and broke the BUY-first ordering —
                      * Yish: *"the recently checked listings don't really fit
                      * that well in the main listings page because it messes up
                      * the order."* This screen is the link checker, so the
                      * things you have checked belong under it.
                      */}
                    {hist.length > 0 && (
                      <div className="recent">
                        <h4>Recently viewed</h4>
                        <div className="histlist">
                          {hist.slice(0, 8).map((h) => (
                            <button key={h.id} className="hrow" onClick={() => go(`/c/${h.id}`)}>
                              <span className={`dcall b-${h.call}`}>{LABEL[h.call]}</span>
                              <span className="htitle">{h.title}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/**
                  * ⚠ A DETAIL THAT IS STILL LOADING SHOWS THE SHAPE OF A
                  * DETAIL. Gating the paste box on the route (above) fixed the
                  * flash of the wrong screen, but `Report` renders `null`
                  * without a listing — so the fix on its own traded a flash of
                  * the Check screen for a flash of NOTHING, which reads as the
                  * tap not having registered and gets tapped again.
                  *
                  * The blocks match the real layout: photo, verdict, price
                  * line. Same `.skel` the feed and Saved already use.
                  */}
                {screen.name === "detail" && !listing && !error && (
                  <div className="dskel" aria-busy="true" aria-label="Loading listing">
                    <div className="skel" style={{ height: 260, borderRadius: 14, marginBottom: 14 }} />
                    <div className="skel" style={{ height: 26, width: "42%", borderRadius: 999, marginBottom: 12 }} />
                    <div className="skel" style={{ height: 30, width: "58%", marginBottom: 10 }} />
                    <div className="skel" style={{ height: 14, width: "88%", marginBottom: 7 }} />
                    <div className="skel" style={{ height: 14, width: "64%" }} />
                  </div>
                )}

                {error && <div className="errbox" role="alert"><Again size={24} /><h2>That didn't load.</h2><p>{error}</p>{screen.name === "detail" && <div className="error-actions"><button className="cta" onClick={() => setReloadAt(Date.now())}>Try again</button><button className="btn2" onClick={back}>Back to listings</button></div>}</div>}

                {/* The source chips this comment used to describe were deleted
                    long ago; the statement they carried now lives in the H1's
                    subhead above, where it is read before you spend a paste
                    rather than after one fails. (`.srcs` in styles.css is dead
                    with them — audit commit 6.) */}
                {/* Back is a DETAIL affordance. During a paste the result
                    appears in place on the Check screen, and there is nothing
                    behind it to return to. */}
                <Report decisionToken={decisionToken} listing={listing} verdict={verdict} signals={signals} comps={comps}
                  meta={meta} stage={stage} reading={reading} checkId={checkId}
                  onShare={checkId ? () => void shareOrCopy(`${location.origin}/c/${checkId}`, listing?.title) : undefined}
                  onCompare={checkId?()=>go(`/compare?ids=${checkId}&kind=${meta?.category==='component'?'cpu':['ram','storage','motherboard','psu'].includes(meta?.category??'')?meta!.category:'gpu'}`):undefined}
                  onBack={screen.name === "detail" ? back : undefined}
                  /* Relabelling changes the call the server serves, so the
                     screen re-reads rather than guessing at the new state. */
                  onReload={() => setReloadAt(Date.now())} />

                {ms != null && <div className="timing num">verdict in {ms}ms</div>}

                {checkId && (
                  <div className="actions">
                    <button className="btn2" onClick={() => { reset(); setUrl(""); go("/check"); }}>
                      <Again /> New check
                    </button>
                  </div>
                )}
              </>
            )}

            {screen.name === "saved" && (
              <Watchlist onOpen={(id) => go(`/c/${id}`)}
                onWatchChange={setSavedCount}
                onBrowse={() => goTab("deals")} />
            )}

            {screen.name === 'compare' && <Suspense fallback={<p role="status" className="compare-empty">Opening comparison…</p>}><ComparisonScreen onOpen={id=>go(`/c/${id}`)}/></Suspense>}



            {screen.name === "settings" && (
              <SettingsScreen s={settings} save={saveSettings}
                savedCount={savedCount}
                onClearSaved={() => { writeWatch([]); setSavedCount(0); }} />
            )}

            {screen.name === "more" && (
              <MoreScreen go={go} savedCount={savedCount} noteCount={unseen} />
            )}

            {screen.name === "notifications" && (
              <NotificationsScreen onOpen={(id) => go(`/c/${id}`)} />
            )}

            {screen.name === "account" && (
              <AccountScreen go={go} savedCount={savedCount} user={auth.user}
                onSignedOut={() => {
                  auth.invalidate();clearTabRoutes();clearRouteSpots();focusedRoute.current=null;
                  auth.setUser(null);
                  auth.setState("out");
                  setAuthMode("none");
                  // Back to `/` so the next sign-in does not resume onto a
                  // deep link from the previous account.
                  replaceRoute("/");
                }} />
            )}

            {screen.name === "how" && <HowScreen />}
        </ScreenBoundary>
          </main>

          <Tabbar tab={tab} go={goTab} savedCount={savedCount} onMore={() => setQuickMenu("more")} moreOpen={quickMenu === "more"} />
          {quickMenu && <Popup title={quickMenu === "more" ? "More" : quickMenu === "account" ? "Your account" : "Notifications"} subtitle={quickMenu === "account" ? auth.user?.name || auth.user?.email : quickMenu === "more" ? undefined : "Recent deals and updates"} onClose={() => setQuickMenu(null)}>{dismiss => <>
            {quickMenu === "notifications" ? <>
              {quickNotes.length ? <div className="quick-list">{quickNotes.slice(0,3).map(n => <MenuRow key={n.id} icon={<Bell size={18}/>} label={n.title} detail={LABEL[n.call]} onClick={() => dismiss(() => go(`/c/${n.id}`))} />)}</div> : <div className="quick-empty"><Bell size={26}/><b>You're all caught up</b><p>New deal alerts will appear here.</p></div>}
              <button className="popup-footer-link" onClick={() => dismiss(() => go("/notifications"))}>All notifications <span aria-hidden="true">→</span></button>
            </> : <div className="quick-list">
              {quickMenu === "account" && <MenuRow icon={<User size={19}/>} label="Account details" detail="Your profile and plan" onClick={() => dismiss(() => go("/account"))} />}
              <MenuRow icon={<Gear size={19}/>} label="Settings" detail="Your numbers, feed and appearance" onClick={() => dismiss(() => go("/settings"))} />
              {quickMenu === 'more' && <MenuRow icon={<CompareIcon size={19}/>} label="Compare hardware" detail="Parts, performance and the actual deal" onClick={()=>dismiss(()=>go('/compare'))}/>}
              <MenuRow icon={<Bell size={19}/>} label="Saved searches & alerts" detail="Saved filters and optional notifications" onClick={() => dismiss(() => go("/saved?sub=alerts"))} />
              {quickMenu === "more" && <MenuRow icon={<Store size={19}/>} label="Purchases" detail="What you paid and its estimated value" onClick={() => dismiss(() => go("/saved?sub=purchases"))} />}
              <MenuRow icon={<Info size={19}/>} label="How Filtrsoft works" onClick={() => dismiss(() => go("/how"))} />
            </div>}
            {quickMenu === "more" && <button className="popup-footer-link" onClick={() => dismiss(() => go("/more"))}>All options <span aria-hidden="true">→</span></button>}
          </>}</Popup>}
          {/**
            * ⚠ THE BANNER IS MOUNTED AT THE SHELL, NOT INSIDE THE FEED. A deal
            * landing while he is on Saved, on Check or halfway down a listing
            * is exactly when an alert earns its keep; scoping it to the Deals
            * screen would silence it everywhere it matters most.
            */}
          <DealBanner
            onOpen={(id) => go(`/c/${id}`)}
            onSegment={() => go("/?quality=ready")} />
          <Toaster />
    </div>
  );
}
