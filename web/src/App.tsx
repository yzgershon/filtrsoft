/**
 * The application shell: the router, and the screen it hands off to.
 *
 * THIS FILE WAS 2,802 LINES (audit commit 6). It is the routing and the
 * top-level composition only now. Every screen lives in its own module, and
 * the parts decidable from a string (routes, settings, filters) live in
 * `nav.ts` where `bun test` can pin them without a DOM.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Clip, Gear, Link, Again, Sliders } from "./icons.tsx";
import type { Comp, Hist, Listing, Meta, Signal, Verdict } from "./types.ts";
import {
  LABEL, Toaster, pushHist, readHist, readAsked, readWatch, writeWatch,
  readSettings, writeSettings, pendingOutcome, shareOrCopy, toast,
  openFilters, onFilterCount,
} from "./lib.tsx";
import { Feed } from "./feed.tsx";
import { Report } from "./detail.tsx";
import {
  OutcomePrompt, SettingsScreen, Tabbar, HeaderNav, Watchlist,
} from "./screens.tsx";
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
    const on = () => setPath(location.pathname);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  return {
    path,
    screen: screenOf(path),
    go: useCallback((p: string) => {
      if (p === location.pathname) return;
      history.pushState({}, "", p);
      setPath(p);
    }, []),
    replace: useCallback((p: string) => {
      history.replaceState({}, "", p);
      setPath(p);
    }, []),
  };
}

export default function App() {
  const { path, screen, go, replace } = useRoute();
  /**
   * DERIVED, never stored. A second copy of "which screen am I on" is what let
   * the URL say `/` while a listing detail was still on screen.
   */
  const tab = tabOf(screen);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [comps, setComps] = useState<Comp[]>([]);
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
  const [filterCount, setFilterCount] = useState(0);
  useEffect(() => onFilterCount(setFilterCount), []);
  const es = useRef<EventSource | null>(null);
  const field = useRef<HTMLInputElement | null>(null);

  /**
   * A tab press is now just navigation. The screen follows the URL, so there is
   * nothing to keep in sync by hand.
   */
  const PATH_FOR: Record<"deals" | "check" | "saved" | "settings", string> = {
    deals: "/", check: "/check", saved: "/saved", settings: "/settings",
  };
  const goTab = useCallback((t: "deals" | "check" | "saved" | "settings") => {
    setSavedCount(readWatch().length);
    go(PATH_FOR[t]);
  }, [go]);

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

  /**
   * ANDROID SHARE SHEET. The manifest registers `/share` as a share target, so
   * Assyze appears in Chrome's Share menu on a Craigslist page and the whole
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
    if (path !== "/share") return;
    const q = new URLSearchParams(location.search);
    const blob = [q.get("url"), q.get("text"), q.get("title")].filter(Boolean).join(" ");
    const found = blob.match(/https?:\/\/[^\s]+/)?.[0];
    history.replaceState({}, "", "/");
    if (found) runUrl(found);
    else { replace("/check"); setError("That share didn't contain a link. Copy the listing URL and paste it instead."); }
    // Fires once per delivery; `runUrl` is stable enough for this one-shot.
  }, [path]);

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
    if (screen.name !== "detail") {
      if (listing || verdict) reset();
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
    setBusy(true);
    // The Settings stepper is a real input now: it changes the required
    // profit floor, and therefore the verdict, on this screen.
    fetch(checkQuery(screen.id, settings.driveMinutes)).then((r) => r.json()).then((d) => {
      if (d.error) return setError(d.error);
      setListing(d.listing); setVerdict(d.verdict); setCheckId(d.checkId);
      // The detail endpoint recomputes these; dropping them left the risk
      // layer blank on every listing opened from the feed or a shared link.
      setSignals(d.signals ?? []); setComps(d.comps ?? []); setMeta(d.meta); setStage(3);
    }).finally(() => setBusy(false));
  }, [path]);

  const reset = () => {
    es.current?.close();
    setError(null); setListing(null); setVerdict(null);
    setSignals([]); setComps([]); setMeta(undefined); setStage(0); setMs(null); setCheckId(null); setReading(0);
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
      if (d.listingId) {
        setCheckId(d.listingId);
        history.replaceState({}, "", `/c/${d.listingId}`);
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

  return (
    <div className="app">
      {/**
        * TOP BAR OWNS EVERY ACTION. There is no bottom nav.
        *
        * The old one was `position: absolute` inside a fixed-height fake phone,
        * so on a real device it sat at the bottom of the SCROLL CONTENT — you
        * could only reach Deals/Check/You by scrolling to the end of a
        * 285-listing feed. A nav you have to scroll to is not navigation.
        *
        * It also did not deserve three tabs. Pasting a link is an action, not a
        * place, and a profile is not a destination you visit — both are icons
        * here, and the feed gets the entire screen.
        */}
      <header className="topbar">
        <button className="brand" onClick={() => goTab("deals")}
          aria-label="Assyze home">ass<span>yze</span></button>
        <HeaderNav tab={tab} go={goTab} savedCount={savedCount} />
        <div className="spacer" />

        {/*
          * The header's copy-link icon is GONE. It performed the same clipboard
          * write as the labelled Share button lower down, confirmed nothing, and
          * an unlabelled icon is the worse of the two to keep. Audit S11: keep
          * one action.
          */}
        {/* Deals only: filtering a screen that has no feed is meaningless. */}
        {tab === "deals" && (
          <button className={`iconbtn filtbtn${filterCount ? " on" : ""}`} onClick={openFilters}
            aria-label={filterCount ? `Filters, ${filterCount} active` : "Filters"}>
            <Sliders size={19} />
            {filterCount > 0 && <em className="num">{filterCount}</em>}
          </button>
        )}
        <button className={`iconbtn ${screen.name === "settings" ? "on" : ""}`}
          aria-label="Settings" aria-pressed={screen.name === "settings"}
          onClick={() => goTab(screen.name === "settings" ? "deals" : "settings")}>
          <Gear size={19} />
        </button>
      </header>

      <main className="scroll">
            {screen.name === "deals" && (
              <>
                <div className="feedhead">
                  <h1>Worth driving for</h1>
                  <p>Only listings the engine actually verified. Newest and best first.</p>
                </div>
                {settings.askOutcomes && ask && (
                  <OutcomePrompt h={ask} onDone={() => setAsk(null)} />
                )}
                <Feed onOpen={(id) => go(`/c/${id}`)}
                  onWatchChange={setSavedCount} />
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
                  */}
                {!listing && (
                  <>
                    {/* Every screen needs exactly one H1. This one had none —
                        it opened straight onto an orange button, so a screen
                        reader landing here was told nothing about where it was,
                        and the supported sources were only ever explained by
                        failing. */}
                    <div className="feedhead">
                      <h1>Check a listing</h1>
                      <p>Paste a Craigslist link and get the number it is actually worth, before you drive.</p>
                    </div>
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
                      * RECENTLY CHECKED LIVES HERE NOW.
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
                        <h4>Recently checked</h4>
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

                {error && <div className="alert" role="alert">{error}</div>}

                {/* The source chips this comment used to describe were deleted
                    long ago; the statement they carried now lives in the H1's
                    subhead above, where it is read before you spend a paste
                    rather than after one fails. (`.srcs` in styles.css is dead
                    with them — audit commit 6.) */}
                <Report listing={listing} verdict={verdict} signals={signals} comps={comps}
                  meta={meta} stage={stage} reading={reading} checkId={checkId} />

                {ms != null && <div className="timing num">verdict in {ms}ms</div>}

                {checkId && (
                  <div className="actions">
                    <button className="btn2"
                      onClick={() => shareOrCopy(`${location.origin}/c/${checkId}`, listing?.title)}>
                      <Link /> Share
                    </button>
                    <button className="btn2" onClick={() => { reset(); setUrl(""); go("/"); }}>
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



            {screen.name === "settings" && (
              <SettingsScreen s={settings} save={saveSettings}
                savedCount={savedCount}
                onClearSaved={() => { writeWatch([]); setSavedCount(0); }} />
            )}
          </main>

          <Tabbar tab={tab} go={goTab} savedCount={savedCount} />
          <Toaster />
    </div>
  );
}
