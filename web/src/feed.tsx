import { SaveSearch } from "./saved-searches.tsx";
export { SaveSearch } from "./saved-searches.tsx";
import { Popup, MenuRow } from "./popup.tsx";
import { NAVIGATE, pushRoute } from "./history.ts";
/**
 * The Deals screen: cards, the segment control, and discovery.
 *
 * Split out of a 2,802-line `App.tsx` (audit commit 6). THE SPLIT IS BY
 * SCREEN, NOT BY KIND. Everything one screen needs sits together, so a change
 * to the feed is one file rather than a hunt through a components/, a hooks/
 * and a utils/ for three pieces of the same feature.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Again, Bell, Check, Cut, Ghost, Save, Sliders, Scan, Info, Cut as SortIcon } from "./icons.tsx";
import type { Call, FeedItem } from "./types.ts";
import {
  type Filters, type Quality,
  NO_FILTERS, CATEGORIES, SOURCES, SORTS, sourceLabel,
  filtersFromSearch, searchFromFilters, activeFilterCount, feedUrl,
  FEED_PAGE, readSeen, markSeen,
} from "./nav.ts";
import {
  LABEL, money, ago, listedAge, readWatch, toggleWatch, readSettings, toast, Thumb,
  SUBKEY, reconcilePushSubscription, urlB64ToBytes, onOpenFilters, publishFilterCount,
  rememberSpot, popSpot, restoreScroll, setFeedRows, deviceRef, publishFreshness, publishAuthLost,
} from "./lib.tsx";

/** Re-exported so existing importers keep one name for the page size. */
export const PAGE = FEED_PAGE;

export function Gcard({ i, saved, onSave, onOpen }: {
  i: FeedItem;
  saved: boolean;
  onSave: () => void;
  onOpen: (el: HTMLElement) => void;
}) {
  const price = i.currentPriceCents ?? i.askingPriceCents;
  /**
   * ⚠ `aria-label="Open {title}"` OVERRODE EVERYTHING ELSE ON THE CARD.
   *
   * An `aria-label` replaces the element's contents as its accessible name, so
   * a screen reader announced the title and nothing else — not the verdict, not
   * the price, not the profit, not whether the listing was gone. Those four are
   * the entire reason the card exists.
   *
   * The label stays the action ("Open …") and the decision data moves to a
   * visually hidden description, which assistive tech reads AFTER the name.
   */
  const descId = `gd${i.id}`;
  const desc = [
    i.overriddenFrom ? `${LABEL[i.call]}, your own label` : LABEL[i.call],
    i.priceIsPlaceholder ? "See item prices" : money(price),
    i.priceDropCents ? `dropped ${money(i.priceDropCents)}` : null,
    i.netProfitCents && i.netProfitCents > 0 ? `${money(i.netProfitCents)} net profit` : null,
    i.location,
    ago(i.postedAt),
    i.gone ? "no longer listed" : null,
  ].filter(Boolean).join(", ");

  /**
   * The photo's age tag — "20 Min", "4 Hrs", "2 Days", or nothing.
   *
   * ⚠ THE SCREEN-READER DESCRIPTION ABOVE KEEPS `ago()` RATHER THAN THIS. The
   * tag is a glanceable shorthand that goes silent past three days to stay
   * meaningful; a description is under no such pressure, and "listed 12 days
   * ago" is real information. Hiding it from assistive tech to match a visual
   * density decision would trade their information for nobody's benefit.
   */
  const cfg = readSettings();
  const age = cfg.showAge ? listedAge(i.postedAt) : null;

  return (
    <div className={`gcard${i.gone ? " is-gone" : ""}`} data-listing-id={i.id}>
      <button data-open-listing-id={i.id} className="gopen" onClick={(e) => onOpen(e.currentTarget.closest(".gcard") as HTMLElement)}
        aria-label={`Open ${i.title}`} aria-describedby={descId}>
        <span className="gshot">
          <Thumb src={i.thumb} fallbacks={i.thumbFallbacks}/>
          {/**
            * ⚠ AN OVERRIDDEN CARD SAYS SO. `overriddenFrom` is only present
            * when HE relabelled it, and without the marker his own judgement
            * comes back to him as the engine's — which erases the one thing the
            * control exists to record: which listings he has actually checked
            * himself. See `api/overrides.ts`.
            *
            * ⚠ WHICH IS WHY THE CHIP CAN BE HIDDEN AND HIS OWN LABEL CANNOT.
            * `showCall` turns the engine's verdict off for a cleaner photo
            * grid; a listing HE relabelled keeps its chip regardless, because
            * silently dropping that marker would erase his own record with no
            * way to tell the setting had done it.
            */}
          {(cfg.showCall || i.overriddenFrom) && (
            <span className={`gcall b-${i.call}${i.overriddenFrom ? " mine" : ""}`}>
              {LABEL[i.call]}{i.overriddenFrom ? <i aria-hidden="true">•</i> : null}
            </span>
          )}
          {i.gone ? <span className="gghost">Gone</span> : null}
          {age && <span className="gage photo-age">{age}</span>}
        </span>
        <span className="gbody">
          <b>{i.title}</b>
          <span className="gstats">
            <span className="num gprice">{i.priceIsPlaceholder ? "Item prices" : money(price)}</span>
            {i.priceDropCents
              ? <span className="num gdrop"><Cut size={12} />{money(i.priceDropCents)}</span>
              : i.netProfitCents && i.netProfitCents > 0
                ? <span className="num gnet">+{money(i.netProfitCents)}</span>
                : null}
          </span>
          <span className="gloc">
            {i.priceDropCents
              ? <s className="num">{money(i.priceWasCents)}</s>
              : null}
            {/**
              * ⚠ THE SOURCE IS A LABEL, NOT A COLOUR. Audit §19: where a
              * listing came from changes how you contact the seller and how
              * much to trust the photos, and it was nowhere on the card. It is
              * set in the muted ink beside the location for the same reason
              * the audit gives: the VERDICT colour stays the only colour that
              * means anything, so a brand palette here would compete with the
              * one signal the card exists to carry.
              *
              * ⚠ `ago(i.postedAt)` IS GONE FROM THIS LINE ON PURPOSE — it is
              * the photo's age tag now. Yish, 2026-09-01: *"we can get rid of
              * the listed x ago tag on the homepage that comes after the
              * listing location because we will now have that as a see through
              * image overlay."* Keeping both would print the same fact twice on
              * one card, and this line is the one that has to fit in 171px.
              */}
            {[sourceLabel(i.source), i.location].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
      <span className="vh" id={descId}>{desc}</span>
      <button className={`gsave${saved ? " on" : ""}`}
        onClick={() => { onSave(); toast(saved ? "Removed from Saved" : "Saved"); }}
        aria-label={saved ? `Remove ${i.title} from your watchlist` : `Save ${i.title}`}
        aria-pressed={saved}>
        <Save size={16} filled={saved} />
      </button>
    </div>
  );
}

/**
 * Discovery. Search, category, source, price ceiling and sort.
 *
 * ⚠ THREE SEGMENTS IS NOT DISCOVERY FOR 387 LISTINGS (audit §20). Ready/Verify/
 * Risky/All answers "how confident is the engine", which is a completely
 * different question from "show me graphics cards under $500". Without the
 * second one the only way to find a specific thing was to scroll.
 *
 * **Mobile is a bottom sheet, desktop is the same panel inline.** One component,
 * one state, one set of controls: a separate desktop toolbar would be a second
 * implementation of the same filters to keep in sync, which is how one of them
 * ends up missing an option.
 *
 * The sheet is a real dialog: focus moves into it, Tab is trapped, Escape
 * closes, and focus returns to the button that opened it. Same rules as the
 * photo lightbox, and for the same reason.
 */
export function FilterSheet({ f, facets, onApply, onClose }: {
  f: Filters;
  facets: { category?: Record<string, number>; source?: Record<string, number> };
  onApply: (next: Filters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Filters>(f);
  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }));

  const priceInput = draft.maxPrice ? String(Math.round(draft.maxPrice / 100)) : "";

  return (
    <Popup title="Filters" subtitle="Narrow the market to what you want." onClose={onClose} className="filter-popup">{dismiss => <>
        <label className="fld">
          <span>Search</span>
          <input value={draft.q} placeholder="RTX 4090, MacBook, DDR5"
            onChange={(e) => set({ q: e.target.value })}
            /* Enter applies, because typing then hunting for a button is two
               gestures for something the keyboard already implies. */
            onKeyDown={(e) => { if (e.key === "Enter") dismiss(() => onApply(draft)); }}
            inputMode="search" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </label>

        <div className="fld">
          <span>Category</span>
          <div className="chips">
            <button className={`fchip${draft.category === "" ? " on" : ""}`}
              onClick={() => set({ category: "" })} aria-pressed={draft.category === ""}>Any</button>
            {/* ⚠ Only categories with rows behind them. Offering "Tablets (0)"
                is offering a dead end, and the count comes from the same
                filtered population the feed serves. */}
            {CATEGORIES.filter((c) => (facets.category?.[c.id] ?? 0) > 0).map((c) => (
              <button key={c.id} className={`fchip${draft.category === c.id ? " on" : ""}`}
                aria-pressed={draft.category === c.id}
                onClick={() => set({ category: draft.category === c.id ? "" : c.id })}>
                {c.label}<em className="num">{facets.category?.[c.id]}</em>
              </button>
            ))}
          </div>
        </div>

        <div className="fld">
          <span>Where it's listed</span>
          <div className="chips">
            <button className={`fchip${draft.source === "" ? " on" : ""}`}
              onClick={() => set({ source: "" })} aria-pressed={draft.source === ""}>Any</button>
            {SOURCES.filter((x) => (facets.source?.[x.id] ?? 0) > 0).map((x) => (
              <button key={x.id} className={`fchip${draft.source === x.id ? " on" : ""}`}
                aria-pressed={draft.source === x.id}
                onClick={() => set({ source: draft.source === x.id ? "" : x.id })}>
                {x.label}<em className="num">{facets.source?.[x.id]}</em>
              </button>
            ))}
          </div>
        </div>

        <label className="fld">
          <span>Most you'd pay</span>
          <div className="pricefld">
            <i>$</i>
            <input value={priceInput} placeholder="any" inputMode="numeric"
              onChange={(e) => {
                const n = Number(e.target.value.replace(/[^0-9]/g, ""));
                set({ maxPrice: n > 0 ? n * 100 : null });
              }}
              onKeyDown={(e) => { if (e.key === "Enter") dismiss(() => onApply(draft)); }} />
          </div>
        </label>

        <div className="fld">
          <span>Sort by</span>
          <div className="chips">
            {SORTS.map((o) => (
              <button key={o.id} className={`fchip${draft.sort === o.id ? " on" : ""}`}
                aria-pressed={draft.sort === o.id}
                onClick={() => set({ sort: o.id })}>{o.label}</button>
            ))}
          </div>
        </div>

        <div className="sheetfoot">
          <button className="btn2" onClick={() => setDraft({ ...NO_FILTERS, quality: draft.quality })}>
            Clear
          </button>
          <button className="cta" onClick={() => dismiss(() => onApply(draft))}>Apply filters</button>
        </div>
    </>}</Popup>
  );
}

/**
 * "Save this search" turns the filters you are looking at into an alert.
 *
 * ⚠ IT ONLY EVER APPEARS ONCE THERE IS SOMETHING TO SAVE, and it asks for
 * notification permission on the TAP, never on load. Audit §12: "Keep permission
 * requests user-triggered." A permission prompt that fires because a page
 * rendered is the fastest way to get permanently blocked.
 */
export function Feed({ onOpen, onWatchChange, freshness }: {
  onOpen: (id: number) => void;
  /** Lifted so the Saved tab's badge updates the moment you tap a bookmark. */
  onWatchChange: (n: number) => void;
  freshness?: string | null;
}) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  /**
   * ⚠ THE SEGMENT IS A SERVER QUERY NOW, NOT A CLIENT-SIDE `.filter()`.
   *
   * It used to fetch 60 rows, filter those in the browser, and render "Show
   * more" only under All. Measured live: the Deals control said 20 and the view
   * dead-ended at 13 — seven listings unreachable by any interaction, because
   * the other 341 rows were never fetched and the control that would have
   * fetched them was hidden.
   *
   * Server-side means the count, the page and the pagination all come from one
   * filter model, so they cannot disagree.
   */
  /**
   * ⚠ FILTERS LIVE IN THE URL (audit §20). Held in component state they are
   * lost on every refresh and on every trip into a listing and back, which on
   * a 387-row feed means re-typing the search after each thing you look at.
   * They are also then shareable, which is what the audit asked for.
   */
  const [filters, setFilters] = useState<Filters>(() => filtersFromSearch(location.search));
  const quality = filters.quality;
  const setQuality = (q: Quality) => applyFilters({ ...filters, quality: q });
  const [sheet, setSheet] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [reviewInfo, setReviewInfo] = useState(false);
  const [facets, setFacets] = useState<{ category?: Record<string, number>; source?: Record<string, number> }>({});
  const [segments, setSegments] = useState<Record<string, number>>({});
  /** New-since-you-looked, per segment. Drives the chip badges. */
  const [newCounts, setNewCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failureMessage,setFailureMessage]=useState('');
  /**
   * Offline is a DIFFERENT message from a failed request, because the fix is
   * different: one is "reconnect", the other is "try again". `navigator.onLine`
   * is only trustworthy in the negative — false means definitely offline — and
   * that is the only direction this uses it in.
   */
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  const [watch, setWatch] = useState<number[]>(readWatch);

  /**
   * ⚠ WHERE YOU WERE, RESTORED WHEN THE ROWS LAND — NOT BEFORE.
   *
   * Read ONCE, in a lazy initialiser. `useRef(popSpot(...))` would call
   * `popSpot` on every render and consume the back-navigation flag on the
   * first one, so the restore would be thrown away before the rows it needs
   * had arrived. Full reasoning in `lib.tsx`.
   */
  const [spot, setSpot] = useState(() => popSpot(location.pathname + location.search));

  const pageCursor = useRef<string | null>(null), loadGeneration = useRef(0);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async (offset: number, f: Filters, target = PAGE): Promise<void> => {
    const generation = ++loadGeneration.current;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const current = () => generation === loadGeneration.current && !controller.signal.aborted;
    setLoadingMore(offset > 0); setFailed(false);
    const seen = readSeen(), hideGone = readSettings().hideGone, ref = deviceRef();
    let start = offset, cursor = offset > 0 ? pageCursor.current : null;
    let rows: FeedItem[] = [], restarted = false;
    // Restore the full loaded window using legal cursor pages. Clamping a
    // saved 360-row window to one 200-row request lost the selected listing.
    try {
      while (current()) {
        const limit = Math.min(200, Math.max(1, target - rows.length));
        const url = feedUrl({ limit, offset: start + rows.length, hideGone, filters: f, ref, seen });
        const response = await fetch(url + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""), { signal: controller.signal });
        if (!current()) return;
        if (response.status === 401) { publishAuthLost(); throw new Error("401"); }
        if (response.status === 409 && cursor && !restarted) {
          restarted = true; target += start; start = 0; rows = []; cursor = null; continue;
        }
        if (!response.ok) {
          const problem=await response.json().catch(()=>null);
          throw new Error(typeof problem?.error==='string'?problem.error:response.status>=500?'Filtrsoft’s server could not load the feed. Please try again.':`The feed request failed (${response.status}). Please try again.`);
        }
        const data = await response.json();
        if (!current()) return;
        rows.push(...(data.items ?? [])); cursor = data.nextCursor ?? null;
        if (rows.length < target && cursor && data.items?.length) continue;
        pageCursor.current = cursor;
        setItems(prev => start === 0 ? rows : [...(prev ?? []), ...rows]);
        setSegments(data.segments ?? {}); setNewCounts(data.segmentsNew ?? {});
        setFacets(data.facets ?? {}); setTotal(data.total ?? 0);
        if (start === 0 && data.serverNow) markSeen(f.quality, data.serverNow);
        publishFreshness({ at: data.lastCrawl?.started_at ?? null, fresh: data.freshCount ?? 0, everyMs: data.crawlEveryMs ?? 180000 });
        break;
      }
    } catch(error) {
      if (current()) { if (offset === 0) setItems([]); setFailed(true); setFailureMessage(error instanceof Error&&error.message!=='Failed to fetch'?error.message:'The feed could not be reached. Please try again.'); }
    } finally { if (current()) setLoadingMore(false); }
  }, []);
  useEffect(() => () => { ++loadGeneration.current; request.current?.abort(); }, []);

  /**
   * Reset rows AND offset whenever ANY filter changes, or page 2 of the old
   * query appends onto page 1 of the new one. Keyed on the serialised filter
   * state rather than the object, which is new on every render.
   */
  const key = searchFromFilters(filters);
  const activeKey = useRef(key); activeKey.current = key;
  useEffect(() => {
    setItems(null);
    // Back restores all previously loaded rows before applying its scroll offset.
    void load(0, filtersFromSearch(key), spot ? Math.max(PAGE, spot.n) : PAGE);
  }, [load, key]);

  /**
   * ⚠ LAYOUT EFFECT, NOT AN EFFECT. `useEffect` runs after paint, so the feed
   * would render at the top for one frame and then jump — which reads as the
   * page having scrolled itself rather than as never having moved.
   */
  useLayoutEffect(() => {
    if (!items || !spot || failed) return;
    restoreScroll(spot.y);
    setSpot(null);
  }, [items, spot, failed]);

  /**
   * Applying filters PUSHES a history entry, so Back undoes a search rather
   * than leaving the feed and losing it. `popstate` reads them back.
   */
  const applyFilters = (next: Filters) => {
    setSheet(false);
    const search = searchFromFilters(next);
    if (search === location.search) return;
    rememberSpot(location.pathname + location.search, items?.length ?? 0);
    setSpot(null); pushRoute(`${location.pathname}${search}`);
  };
  useEffect(() => {
    const on = (event: Event) => {
      if (location.pathname !== "/") return;
      const next = filtersFromSearch(location.search);
      if (searchFromFilters(next) === activeKey.current) return;
      setItems(null);
      setSpot(event.type === "popstate" ? popSpot(location.pathname + location.search) : null);
      setFilters(next);
    };
    addEventListener("popstate", on); addEventListener(NAVIGATE, on);
    return () => { removeEventListener("popstate", on); removeEventListener(NAVIGATE, on); };
  }, []);

  // Coming back online retries by itself. Making someone tap Try again for a
  // connection that already recovered is a step the browser can take for them.
  useEffect(() => {
    const up = () => { setOffline(false); setFailed(false); setItems(null); void load(0, filters, spot ? Math.max(PAGE, spot.n) : PAGE); };
    const down = () => setOffline(true);
    addEventListener("online", up);
    addEventListener("offline", down);
    return () => { removeEventListener("online", up); removeEventListener("offline", down); };
  }, [load, key, spot]);

  /**
   * ⚠ THE SEGMENT CONTROL MUST NOT UNMOUNT WHILE ITS OWN RESULTS LOAD.
   *
   * Switching segments sets `items` to null, and this used to return the
   * skeleton from HERE — above `<Segmented>` — so the control you had just
   * pressed vanished for the length of the fetch and came back rebuilt.
   *
   * Two consequences, one visible and one not. Visibly, the chips blink out
   * every time you use them. Invisibly, KEYBOARD FOCUS DIED with the unmount:
   * arrowing from All to Ready moved the selection and then dropped focus onto
   * <body>, so the next arrow key did nothing at all. That is why the
   * roving-tabindex fix alone did not work — the element being focused no
   * longer existed a tick later.
   *
   * The skeleton is rendered BELOW the control now, and the control keeps its
   * counts from the previous response, which are the same numbers it will show
   * when the rows land.
   */
  const shown = items ?? [];
  const hero = filters.sort === "best" ? shown[0] ?? null : null;
  const rest = shown.filter((i) => i.id !== hero?.id);

  /**
   * Tell the router how much is loaded, so whichever way you leave this screen
   * the same number of rows comes back with you. See `feedRows` in `lib.tsx`.
   */
  useEffect(() => { setFeedRows(shown.length); }, [shown.length]);

  /**
   * Tapping a listing OPENS it. It used to promote the card into the hero slot
   * with a shared-element view transition — Yish asked for that, used it, and
   * called it a dumb decision, which it was: the gesture every marketplace
   * trains you on is tap-to-open, and spending it on rearranging the page
   * meant the only way to actually SEE a listing was to tap it twice.
   *
   * The hero stays as the top-ranked listing. It is a highlight, not a slot
   * you fill.
   */

  /**
   * ⚠ "DEALS" USED TO MEAN `BUY + VERIFY + RISK`. Audit §4: a risky listing is
   * not a deal and a listing needing verification is not ready to act on, while
   * the page promised "Worth driving for" and "only listings the engine
   * actually verified". The label and the contents disagreed.
   *
   * Each segment now names exactly one thing. RISK is its own state and is
   * never counted as a deal.
   */
  const nFilters = activeFilterCount(filters);

  /**
   * The badge lives on a button in another component, so the count is
   * published rather than passed. Publishing on every filter change keeps the
   * two in step without `App` having to know what a facet is.
   */
  useEffect(() => { publishFilterCount(nFilters); }, [nFilters]);
  useEffect(() => onOpenFilters(() => setSheet(true)), []);

  const SEGS: Array<{ id: Quality; label: string; n: number; fresh: number; tone: string }> = [
    { id: "review", label: "Review", n: segments.review ?? 0, fresh: 0, tone: "mute" },
    /**
     * ⚠ "BUY IT", NOT "READY". Yish, 2026-08-31: *"change the ready tag in the
     * filter bar to Buy it."* The card on a BUY listing has said "BUY IT" since
     * the feed existed (`LABEL.BUY`), so the segment that collects them was the
     * one place in the app calling that verdict something else. The segment id
     * stays `ready` because it is a URL and a server query — this is a label,
     * not a rename.
     */
    { id: "ready", label: "Buy it", n: segments.ready ?? 0, fresh: newCounts.ready ?? 0, tone: "buy" },
    { id: "verify", label: "Verify", n: segments.verify ?? 0, fresh: newCounts.verify ?? 0, tone: "verify" },
    { id: "risky", label: "Risky", n: segments.risky ?? 0, fresh: newCounts.risky ?? 0, tone: "risk" },
    { id: "all", label: "All", n: segments.all ?? 0, fresh: newCounts.all ?? 0, tone: "mute" },
  ];

  const GROUPS: Array<{ label: string; note: string; tone: string; calls: Call[] }> = [
    { label: "Verified deals", note: "ready to act on", tone: "buy", calls: ["BUY"] },
    { label: "Worth a closer look", note: "need verification", tone: "verify", calls: ["VERIFY"] },
    { label: "Approach with caution", note: "flagged risky", tone: "risk", calls: ["RISK"] },
    { label: "The rest of the market", note: "priced listings", tone: "mute", calls: ["FAIR", "PASS"] },
    /**
     * CAN'T TELL IS LAST, and it is its own group rather than being mixed in
     * with the priced-and-rejected ones.
     *
     * Yish, 2026-08-28: *"I don't want cant tell listings."* Until the catalog
     * covers them they exist, but a bucket the engine could not price must not
     * sit above verdicts it could — it was ranked 3rd of 6 and pushed real
     * answers below the fold.
     */
    { label: "Couldn't price these", note: "not enough to go on", tone: "mute", calls: ["INSUFFICIENT_DATA"] },
  ];

  return (
    <>
      <div className="discovery-toolbar">
        <form className="discovery-search" onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); applyFilters({ ...filters, q: String(data.get("q") || "").trim() }); }}>
          <Scan size={18} /><input key={filters.q} name="q" aria-label="Search listings" defaultValue={filters.q} placeholder="Search local tech" type="search" /><button type="submit">Search</button>
        </form>
        <button className="filter-action" aria-label={nFilters ? `Filters, ${nFilters} active` : "Filters"} aria-haspopup="dialog" onClick={() => setSheet(true)}><Sliders size={17} /> Filters{nFilters > 0 && <em>{nFilters}</em>}</button>
      </div>
      <div className="feed-status"><span>Greater Boston</span>{freshness && <span>{freshness}</span>}</div>
      <Segmented value={quality} onChange={setQuality} options={SEGS} />
      <SaveSearch f={filters} />
      <div className="feed-context">
        <div>{quality === "review" ? <><span className="context-dot" /><b>Your review queue</b><button className="review-help" aria-label="About your review queue" onClick={() => setReviewInfo(true)}><Info size={15} /></button></> : <span>{total} {total === 1 ? "listing" : "listings"}</span>}</div>
        <button className="sort-trigger" aria-haspopup="dialog" onClick={() => setSortOpen(true)}><SortIcon size={14} />{SORTS.find(x => x.id === filters.sort)?.label}<span aria-hidden="true">⌄</span></button>
      </div>
      {sortOpen && <Popup title="Sort listings" onClose={() => setSortOpen(false)}>{dismiss => <div className="quick-list">{SORTS.map(s => <MenuRow key={s.id} label={s.label} selected={s.id === filters.sort} detail={s.id === "best" ? "Strongest opportunities first" : s.id === "newest" ? "Most recently posted" : s.id === "price" ? "Lowest asking price first" : "Largest reductions first"} onClick={() => dismiss(() => applyFilters({ ...filters, sort: s.id }))} />)}</div>}</Popup>}
      {reviewInfo && <Popup title="Your review queue" onClose={() => setReviewInfo(false)}>{dismiss => <><p className="popup-copy">Up to ten priced, live listings that you haven't reviewed. Open one, check its evidence, and use Your call to record your judgment. Agreeing with the engine counts as a review too.</p><p className="popup-copy">Reviewed listings leave this queue and remain in the other segments.</p><button className="cta popup-primary" onClick={() => dismiss()}>Got it</button></>}</Popup>}


      {sheet && (
        <FilterSheet f={filters} facets={facets} onApply={applyFilters} onClose={() => setSheet(false)} />
      )}

      {/**
        * What is actually being filtered, stated in words, with a way out of
        * each one. A filter you cannot see is a filter you think is a bug: the
        * feed looks empty and nothing on screen says why.
        */}
      {nFilters > 0 && (
        <div className="feed-active-filters" role="status">
          {filters.q && (
            <button className="apill" onClick={() => applyFilters({ ...filters, q: "" })}>
              "{filters.q}" <i aria-hidden="true">✕</i>
              <span className="vh">Remove the search</span>
            </button>
          )}
          {filters.category && (
            <button className="apill" onClick={() => applyFilters({ ...filters, category: "" })}>
              {CATEGORIES.find((c) => c.id === filters.category)?.label ?? filters.category} <i aria-hidden="true">✕</i>
              <span className="vh">Remove the category filter</span>
            </button>
          )}
          {filters.source && (
            <button className="apill" onClick={() => applyFilters({ ...filters, source: "" })}>
              {sourceLabel(filters.source)} <i aria-hidden="true">✕</i>
              <span className="vh">Remove the source filter</span>
            </button>
          )}
          {filters.maxPrice && (
            <button className="apill" onClick={() => applyFilters({ ...filters, maxPrice: null })}>
              under {money(filters.maxPrice)} <i aria-hidden="true">✕</i>
              <span className="vh">Remove the price limit</span>
            </button>
          )}
          <button className="apill clear" onClick={() => applyFilters({ ...NO_FILTERS, quality })}>
            Clear all
          </button>
        </div>
      )}

      {!items && (
        <div className="sec" aria-busy="true">
          <div className="skel" style={{ height: 210, marginBottom: 12, borderRadius: 16 }} />
          {[0, 1, 2].map((i) => <div className="skel" key={i} style={{ height: 90, marginBottom: 8 }} />)}
        </div>
      )}

      {offline && (
        <div className="offline" role="status">
          <Alert size={14} />
          You are offline. This is the last feed that loaded.
        </div>
      )}

      {/**
        * ⚠ A FAILED REQUEST IS NOT AN EMPTY FEED, AND `failed` WAS NEVER
        * RENDERED.
        *
        * `setFailed(true)` has been in the catch since the segment rewrite and
        * nothing read it, so a dropped connection showed "Nothing here yet" —
        * telling you the product has no deals when what actually happened is
        * that the request did not complete. There is a real difference between
        * those two and only one of them has a retry.
        */}
      {!items ? null : failed && shown.length === 0 ? (
        <div className="errbox" role="alert">
          <span className="eic"><Alert size={22} /></span>
          <b>{offline ? "No connection" : "Couldn't load the feed"}</b>
          <p>{offline
            ? "Reconnect and try again. Nothing was lost."
            : failureMessage}</p>
          <button className="btn2" onClick={() => { setFailed(false); setItems(null); void load(0, filters, spot ? Math.max(PAGE, spot.n) : PAGE); }}>
            <Again size={15} /> Try again
          </button>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <Ghost />
          <b>Nothing here yet</b>
          <span>{nFilters ? "Try a broader search or clear a filter." : quality === "review" ? "You have reviewed this batch. New eligible listings will appear here." : "No listings match this segment right now."}</span>
        </div>
      ) : (
        <>
          {hero && (
            <>
              <SectionHead
                tone={hero.call === "BUY" ? "buy" : hero.call === "VERIFY" ? "verify" : "mute"}
                label={quality === "review" ? "Review" : hero.call === "RISK" ? "Flagged" : "Featured"} className="hero-section-head" />
              {/**
                * ⚠ THE BOOKMARK IS A SIBLING OF THE OPEN BUTTON, NEVER INSIDE
                * IT. Audit §18: every grid card could be saved and the best
                * listing on the page could not. A button nested in a button is
                * invalid HTML, and browsers resolve it by dropping one of them
                * — which is exactly the bug `.gcard` was made a div to avoid.
                */}
              <div className="herowrap">
              <button data-open-listing-id={hero.id} className={`dealhero v-${hero.call}`} onClick={() => onOpen(hero.id)}>
                <span className="hshot">
                  <Thumb src={hero.thumb} fallbacks={hero.thumbFallbacks} size={28}/>
                </span>
                <span className="hero-content">
                    <span className={`dcall b-${hero.call}${hero.overriddenFrom ? " mine" : ""}`}>
                      {LABEL[hero.call]}{hero.overriddenFrom ? <i aria-hidden="true">•</i> : null}
                    </span>
                    <b>{hero.title}</b>
                <span className="hnums">
                  <span className="num hprice">{hero.priceIsPlaceholder ? "Item prices" : money(hero.currentPriceCents ?? hero.askingPriceCents)}</span>
                  {hero.netProfitCents && hero.netProfitCents > 0
                    ? <span className="num hnet">+{money(hero.netProfitCents)} net</span> : null}
                  <span className="dloc">{[hero.location, ago(hero.postedAt)].filter(Boolean).join(" · ")}</span>
                </span>
                {hero.headline ? <span className="hwhy">{hero.headline}</span> : null}
                </span>
              </button>
              <button className={`gsave herosave${watch.includes(hero.id) ? " on" : ""}`}
                aria-pressed={watch.includes(hero.id)}
                aria-label={watch.includes(hero.id) ? `Remove ${hero.title} from your watchlist` : `Save ${hero.title}`}
                onClick={() => {
                  const n = toggleWatch(hero.id); setWatch(n); onWatchChange(n.length);
                  toast(n.includes(hero.id) ? "Saved" : "Removed from Saved");
                }}>
                <Save size={16} filled={watch.includes(hero.id)} />
              </button>
              </div>
            </>
          )}

          {(filters.sort === "best" && quality !== "review" ? GROUPS : [{ label: quality === "review" && filters.sort === "best" ? "Next up" : SORTS.find(s => s.id === filters.sort)?.label || "Listings", note: "listings", tone: "mute", calls: ["BUY","VERIFY","FAIR","PASS","RISK","INSUFFICIENT_DATA","OUT_OF_SCOPE"] as Call[] }]).map((g) => {
            const list = rest.filter((i) => g.calls.includes(i.call));
            if (!list.length) return null;
            return (
              <div key={g.label}>
                <SectionHead tone={g.tone} label={g.label} note={`${list.length} ${g.note}`} />
                <div key={key + g.label} className={`grid${readSettings().compact ? " dense" : ""}`}>
                  {list.map((i) => (
                    <Gcard key={i.id} i={i} saved={watch.includes(i.id)}
                      onSave={() => { const n = toggleWatch(i.id); setWatch(n); onWatchChange(n.length); }}
                      onOpen={() => onOpen(i.id)} />
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/**
        * ⚠ `filter === "ALL"` HERE WAS THE ACTUAL CAUSE OF THE 20-vs-13 BUG.
        *
        * Pagination was hidden on every segment except All, so a filtered view
        * could never fetch past its first 60 rows and seven promised deals had
        * no interaction that could reach them. Show more is available for every
        * segment now, until `items.length === total` for THAT segment.
        */}


      {failed && shown.length > 0 && <p role="alert" className="pagination-error">Couldn't load more listings. Your current results are still here.</p>}
      {items && shown.length < total ? (
        <button className="more" disabled={loadingMore} onClick={() => void load(shown.length, filters)}>
          {loadingMore ? "Loading…" : failed ? "Try again" : `Show more · ${shown.length} of ${total}`}
        </button>
      ) : null}
    </>
  );
}

/**
 * A segmented control, not a row of loose pills.
 *
 * It is a real `radiogroup`: exactly one is active, arrow keys move between
 * options, and `aria-checked` announces which. The indicator SLIDES, so the
 * active option is signalled by position as well as colour — colour alone is
 * never the only cue.
 */
export function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void;
  options: Array<{ id: T; label: string; n: number; fresh?: number; tone?: string }>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState({ left: 0, width: 0 });

  /**
   * ⚠ THE INDICATOR MUST RE-MEASURE WHEN THE CHIPS RESIZE, NOT ONLY WHEN THE
   * SELECTION CHANGES.
   *
   * This ran on `[value, options.length]` alone, which was survivable while
   * every chip was `flex: 1` and therefore the same width whatever it said. The
   * desktop shell makes them content-sized, and then two things move them
   * without changing either dependency: the COUNTS arriving after the first
   * fetch ("All" -> "All 387" is wider), and the window resizing across the
   * 1024px breakpoint.
   *
   * Both left the orange pill sitting under a chip that was not the selected
   * one — a control actively pointing at the wrong answer, which is worse than
   * no indicator at all. A ResizeObserver on the group catches every case,
   * including a font that loads late.
   */
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const measure = () => {
      const el = box.querySelector<HTMLElement>('[aria-checked="true"]');
      if (!el) return;
      setInd({ left: el.offsetLeft, width: el.offsetWidth });
      /**
       * The control scrolls rather than clips when the chips cannot fit (see
       * `.seg` in 04-feed.css). Keep the SELECTED chip on screen, or the one
       * piece of state the control exists to show is the piece you cannot see.
       */
      if (box.scrollWidth > box.clientWidth + 1) {
        el.scrollIntoView({ inline: "nearest", block: "nearest" });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    for (const b of box.querySelectorAll("button")) ro.observe(b);
    return () => ro.disconnect();
  }, [value, options]);

  /**
   * ⚠ FOCUS HAS TO MOVE WITH THE SELECTION.
   *
   * Arrow keys changed the checked option but left DOM focus on the one you
   * arrowed away FROM. In a roving-tabindex radiogroup that option's tabIndex
   * immediately becomes -1, so focus was sitting on an element the keyboard can
   * no longer reach: the next Tab jumped out of the group, and a screen reader
   * kept announcing the option that was no longer selected.
   *
   * The focus call has to happen AFTER the re-render moves the tabIndex, hence
   * the pending ref rather than focusing inside `move`.
   */
  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (!pending.current) return;
    ref.current?.querySelector<HTMLElement>(`[data-opt="${pending.current}"]`)?.focus();
    pending.current = null;
  }, [value]);

  const move = (dir: 1 | -1) => {
    const i = options.findIndex((o) => o.id === value);
    const next = options[(i + dir + options.length) % options.length].id;
    pending.current = next;
    onChange(next);
  };

  return (
    <div className="seg" role="radiogroup" aria-label="Deal quality" ref={ref}>
      <span className="segind" style={{ transform: `translateX(${ind.left - 3}px)`, width: ind.width }} />
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} data-opt={o.id}
          tabIndex={value === o.id ? 0 : -1}
          onClick={() => onChange(o.id)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(1); }
            if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(-1); }
            if (e.key === "Home") { e.preventDefault(); pending.current = options[0].id; onChange(options[0].id); }
            if (e.key === "End") {
              e.preventDefault();
              const last = options[options.length - 1].id;
              pending.current = last; onChange(last);
            }
          }}>
          {/**
            * ⚠ ONE NUMBER PER CHIP. The total hides while a NEW badge is up,
            * and this is a measured fix, not a taste call.
            *
            * Two counts per chip overflowed the control at every phone width —
            * 61px past the edge on his 360px S24 — and `.seg` scrolls to keep
            * the SELECTED chip visible, so the one it pushed off screen was
            * "Buy it": the rarest and most valuable tab in the app, hidden by
            * the feature meant to draw attention to it.
            *
            * Which number survives is the actionable one. "2 new" beats "5
            * total" on a tab you are deciding whether to open, and tapping it
            * clears the badge and brings the total straight back.
            */}
          {o.label}{o.n > 0 && !(o.fresh ?? 0) ? <span className="segn num">{o.n}</span> : null}
          {/**
            * ⚠ HOW MANY ARRIVED SINCE YOU LAST LOOKED AT *THIS* CHIP, and it
            * is a SECOND number beside the inventory count rather than a
            * replacement for it. They answer different questions — "how many
            * are there" and "how many are new" — and a control that swapped
            * one for the other would make the feed appear to shrink to 3.
            *
            * Tinted per segment, and that is the one place a colour other
            * than the verdict's is allowed on this screen: it IS the verdict,
            * which is exactly what makes a green 1 on Buy it worth crossing a
            * room for. Measured arrival rates are why the badge can be loud —
            * BUY lands 0.7 times a day. See `newSegmentCounts` in the API.
            */}
          {(o.fresh ?? 0) > 0 && (
            <span className={`segnew t-${o.tone ?? "mute"}`}
              aria-label={`${o.fresh} new since you last looked`}>
              {o.fresh! > 99 ? "99+" : o.fresh}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** `note` is optional: the hero head is a label with no count beside it. */
export function SectionHead({ label, note, tone, className = "" }: { label: string; note?: string; tone: string; className?: string }) {
  return (
    <div className={`sect ${className}`}>
      <span className={`sdot t-${tone}`} />
      <h3>{label}</h3><span>{note}</span>
    </div>
  );
}

// ----------------------------------------------------------- components
