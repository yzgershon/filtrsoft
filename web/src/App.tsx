import { useCallback, useEffect, useRef, useState } from "react";
import { Scan, Clock, User, Alert, Check, Info, Link, Again, Eye, Shield, Tag, Ghost, Clip, Save, Grid, Gear, Cut, Bell, Card } from "./icons.tsx";
/**
 * Routing, settings and the feed query live in `nav.ts` because they are the
 * parts of the shell that are decidable from a string, and `bun test` can pin
 * them there without a DOM. Re-exported so the module boundary is an
 * implementation detail rather than a second import path for callers.
 */
import {
  type Screen, type Settings, type Quality,
  screenOf, tabOf, mergeSettings, clampDrive, feedQuery, checkQuery,
  DEFAULT_SETTINGS, SETTINGS_KEY, DRIVE_MIN, DRIVE_MAX, DRIVE_STEP,
} from "./nav.ts";
export { screenOf, tabOf } from "./nav.ts";
export type { Screen, Settings } from "./nav.ts";

// ---------------------------------------------------------------- types
type Call = "BUY" | "FAIR" | "PASS" | "VERIFY" | "RISK" | "INSUFFICIENT_DATA" | "OUT_OF_SCOPE";
interface Channel { channel: string; grossCents: number; feesCents: number; shippingCents: number; netCents: number; available?: boolean; note?: string }
/** A category hard-blocker and whether the listing resolved it. */
interface RiskCheck { code: string; label: string; state: string; question: string; evidence?: string; remote?: boolean }
/** New-retail price for the same SKU. The only number not derived from comps. */
interface Retail {
  priceCents: number; title: string; source: string; observedAt: string;
  ageDays: number; corroborated: boolean;
  quotes: Array<{ source: string; priceCents: number }>;
}
interface Verdict {
  call: Call; confidence: string; headline: string; reasoning: string;
  decidingUnknown?: string; targetOfferCents?: number;
  netProfitCents?: number; requiredProfitCents?: number;
  bestChannel?: Channel; channels?: Channel[];
  questions: string[];
  blockers?: string[]; riskChecks?: RiskCheck[]; retail?: Retail | null;
  valuation: { medianCents: number | null; lowCents: number | null; highCents: number | null; compCount: number; confidence: string };
}
interface Signal { code: string; severity: string; polarity: string; evidence: string }
/** What the engine decided the listing IS, shown so a wrong match is visible. */
interface Meta {
  category?: string; daysOnMarket?: number | null; description?: string;
  missingValueFields?: string[];
  match?: { model: string | null; brand: string | null; confidence: string; method: string };
}
interface FeedItem {
  id: number; title: string; url: string; source: string;
  askingPriceCents: number | null; location: string | null; postedAt: string | null;
  thumb: string | null; call: Call; headline: string | null; netProfitCents: number | null;
  /** From the daily sweep. The difference between a list and a tracker. */
  gone?: boolean; goneReason?: string | null;
  currentPriceCents?: number | null;
  priceDropCents?: number | null; priceWasCents?: number | null;
}
interface Listing {
  title: string; url: string; askingPriceCents: number | null;
  location: string | null; postedAt: string | null; source: string; photoUrls: string[];
}

const money = (c?: number | null) => (c == null ? "—" : `$${Math.round(c / 100).toLocaleString()}`);
const ago = (iso: string | null) => {
  if (!iso) return null;
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? "listed today" : d === 1 ? "listed yesterday" : `listed ${d} days ago`;
};
const LABEL: Record<Call, string> = {
  BUY: "Buy it", FAIR: "Fair price", PASS: "Pass", VERIFY: "Verify first",
  RISK: "Risky", INSUFFICIENT_DATA: "Can't tell", OUT_OF_SCOPE: "Not covered",
};

// -------------------------------------------------------------- storage
const HKEY = "assyze:history";
type Hist = { id: number; title: string; call: Call; at: number };
const readHist = (): Hist[] => { try { return JSON.parse(localStorage.getItem(HKEY) || "[]"); } catch { return []; } };
const pushHist = (h: Hist) => {
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
const WKEY = "assyze:watch";
const readWatch = (): number[] => { try { return JSON.parse(localStorage.getItem(WKEY) || "[]"); } catch { return []; } };
const writeWatch = (ids: number[]) => localStorage.setItem(WKEY, JSON.stringify(ids.slice(0, 200)));
const toggleWatch = (id: number): number[] => {
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
const AKEY = "assyze:asked";
const readAsked = (): number[] => { try { return JSON.parse(localStorage.getItem(AKEY) || "[]"); } catch { return []; } };
const markAsked = (id: number) => {
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
const DAY = 86_400_000;
function pendingOutcome(hist: Hist[], asked: number[]): Hist | null {
  const set = new Set(asked);
  const ripe = hist.filter((h) => !set.has(h.id) && Date.now() - h.at > DAY);
  return ripe.sort((a, b) => a.at - b.at)[0] ?? null;
}

/**
 * Settings the user actually controls. Shape, defaults and parsing are in
 * `nav.ts`; only the storage touch is here, because storage is the one part a
 * test cannot run.
 */
const readSettings = (): Settings => {
  try { return mergeSettings(localStorage.getItem(SETTINGS_KEY)); }
  catch { return DEFAULT_SETTINGS; }
};
const writeSettings = (s: Settings) => localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));

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

const PAGE = 60;

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

function Toaster() {
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
function Thumb({ src, size = 22 }: { src: string | null; size?: number }) {
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
function Gcard({ i, saved, onSave, onOpen }: {
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
    LABEL[i.call],
    money(price),
    i.priceDropCents ? `dropped ${money(i.priceDropCents)}` : null,
    i.netProfitCents && i.netProfitCents > 0 ? `${money(i.netProfitCents)} net profit` : null,
    i.location,
    ago(i.postedAt),
    i.gone ? "no longer listed" : null,
  ].filter(Boolean).join(", ");

  return (
    <div className={`gcard${i.gone ? " is-gone" : ""}`}>
      <button className="gopen" onClick={(e) => onOpen(e.currentTarget.closest(".gcard") as HTMLElement)}
        aria-label={`Open ${i.title}`} aria-describedby={descId}>
        <span className="gshot">
          {i.thumb
            ? <Thumb src={i.thumb} />
            : <span className="noimg"><Ghost size={22} /></span>}
          <span className={`gcall b-${i.call}`}>{LABEL[i.call]}</span>
          {i.gone ? <span className="gghost">Gone</span> : null}
          <span className="gstats">
            <span className="num gprice">{money(price)}</span>
            {i.priceDropCents
              ? <span className="num gdrop"><Cut size={12} />{money(i.priceDropCents)}</span>
              : i.netProfitCents && i.netProfitCents > 0
                ? <span className="num gnet">+{money(i.netProfitCents)}</span>
                : null}
          </span>
        </span>
        <span className="gbody">
          <b>{i.title}</b>
          <span className="gloc">
            {i.priceDropCents
              ? <s className="num">{money(i.priceWasCents)}</s>
              : null}
            {[i.location, ago(i.postedAt)].filter(Boolean).join(" · ")}
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

function Feed({ onOpen, onWatchChange }: {
  onOpen: (id: number) => void;
  /** Lifted so the Saved tab's badge updates the moment you tap a bookmark. */
  onWatchChange: (n: number) => void;
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
  const [quality, setQuality] = useState<Quality>("all");
  const [segments, setSegments] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  /**
   * Offline is a DIFFERENT message from a failed request, because the fix is
   * different: one is "reconnect", the other is "try again". `navigator.onLine`
   * is only trustworthy in the negative — false means definitely offline — and
   * that is the only direction this uses it in.
   */
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  const [watch, setWatch] = useState<number[]>(readWatch);

  const load = useCallback((offset: number, q: Quality) => {
    setLoadingMore(offset > 0);
    if (offset === 0) setFailed(false);
    /**
     * `hideGone` was written to localStorage and never read (audit P0-3). The
     * feed hides delisted rows by default, so the switch has to ASK for them
     * when it is off — `feedQuery` inverts it onto the existing `?gone=1` flag.
     */
    return fetch(feedQuery({ limit: PAGE, offset, quality: q, hideGone: readSettings().hideGone }))
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => {
        setItems((prev) => (offset === 0 ? (d.items ?? []) : [...(prev ?? []), ...(d.items ?? [])]));
        setSegments(d.segments ?? {});
        setTotal(d.total ?? 0);
      })
      /**
       * A failed fetch is NOT an empty feed. Rendering "Nothing here yet" for a
       * network error tells the user the product has no deals when what
       * actually happened is that the request did not complete.
       */
      .catch(() => { if (offset === 0) { setItems([]); setFailed(true); } })
      .finally(() => setLoadingMore(false));
  }, []);

  // Reset rows AND offset whenever the segment changes, or page 2 of the old
  // segment would append onto page 1 of the new one.
  useEffect(() => { setItems(null); void load(0, quality); }, [load, quality]);

  // Coming back online retries by itself. Making someone tap Try again for a
  // connection that already recovered is a step the browser can take for them.
  useEffect(() => {
    const up = () => { setOffline(false); setFailed(false); void load(0, quality); };
    const down = () => setOffline(true);
    addEventListener("online", up);
    addEventListener("offline", down);
    return () => { removeEventListener("online", up); removeEventListener("offline", down); };
  }, [load, quality]);

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
  const hero = shown[0] ?? null;
  const rest = shown.filter((i) => i.id !== hero?.id);

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
  const SEGS: Array<{ id: Quality; label: string; n: number }> = [
    { id: "ready", label: "Ready", n: segments.ready ?? 0 },
    { id: "verify", label: "Verify", n: segments.verify ?? 0 },
    { id: "risky", label: "Risky", n: segments.risky ?? 0 },
    { id: "all", label: "All", n: segments.all ?? 0 },
  ];

  const GROUPS: Array<{ label: string; note: string; tone: string; calls: Call[] }> = [
    { label: "Verified deals", note: "ready to act on", tone: "buy", calls: ["BUY"] },
    { label: "Needs one answer", note: "blocked on a question", tone: "verify", calls: ["VERIFY", "RISK"] },
    { label: "Priced, not deals", note: "above what they're worth", tone: "mute", calls: ["FAIR", "PASS"] },
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
      <Segmented value={quality} onChange={setQuality} options={SEGS} />

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
            ? "Reconnect and try again — nothing was lost."
            : "The request didn't finish. This is usually the connection, not the deals."}</p>
          <button className="btn2" onClick={() => { setFailed(false); setItems(null); void load(0, quality); }}>
            <Again size={15} /> Try again
          </button>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <Ghost />
          <b>Nothing here yet</b>
          <span>Deals show up once the engine has priced enough listings.</span>
        </div>
      ) : (
        <>
          {hero && (
            <>
              <SectionHead
                tone={hero.call === "BUY" ? "buy" : hero.call === "VERIFY" ? "verify" : "mute"}
                label="Best right now" />
              <button className={`dealhero v-${hero.call}`} onClick={() => onOpen(hero.id)}>
                <span className="hshot">
                  {hero.thumb
                    ? <Thumb src={hero.thumb} size={28} />
                    : <span className="noimg"><Ghost size={28} /></span>}
                  <span className="hover">
                    <span className={`dcall b-${hero.call}`}>{LABEL[hero.call]}</span>
                    <b>{hero.title}</b>
                  </span>
                </span>
                <span className="hnums">
                  <span className="num hprice">{money(hero.askingPriceCents)}</span>
                  {hero.netProfitCents && hero.netProfitCents > 0
                    ? <span className="num hnet">+{money(hero.netProfitCents)} net</span> : null}
                  <span className="dloc">{[hero.location, ago(hero.postedAt)].filter(Boolean).join(" · ")}</span>
                </span>
                {hero.headline ? <span className="hwhy">{hero.headline}</span> : null}
              </button>
            </>
          )}

          {GROUPS.map((g) => {
            const list = rest.filter((i) => g.calls.includes(i.call));
            if (!list.length) return null;
            return (
              <div key={g.label}>
                <SectionHead tone={g.tone} label={g.label} note={`${list.length} ${g.note}`} />
                {/**
                  * TWO-UP GRID. Yish's call, from Facebook Marketplace: twice
                  * the listings on screen for the same scrolling, and on a feed
                  * where ~2% are actionable that is the difference between
                  * skimming and hunting.
                  *
                  * The money sits ON the photo, not beside it. A card this
                  * narrow cannot afford a separate price column without
                  * squeezing the title to nothing, and a price over its own
                  * product reads faster than a price in a column anyway.
                  */}
                <div className="grid">
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
      {items && shown.length < total ? (
        <button className="more" disabled={loadingMore} onClick={() => void load(shown.length, quality)}>
          {loadingMore ? "Loading…" : `Show more — ${shown.length} of ${total}`}
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
function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void;
  options: Array<{ id: T; label: string; n: number }>;
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
      if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth });
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
          {o.label}{o.n > 0 ? <span className="segn num">{o.n}</span> : null}
        </button>
      ))}
    </div>
  );
}

function SectionHead({ label, note, tone }: { label: string; note: string; tone: string }) {
  return (
    <div className="sect">
      <span className={`sdot t-${tone}`} />
      <h3>{label}</h3><span>{note}</span>
    </div>
  );
}

// ----------------------------------------------------------- components
function Flags({ signals }: { signals: Signal[] }) {
  if (!signals.length) return null;
  const icon = (s: Signal) =>
    s.polarity === "positive" ? <Check /> : s.severity === "medium" ? <Info /> : <Alert />;
  return (
    <section className="sec rise">
      <h4>What's flagged <em>({signals.length})</em></h4>
      <div className="panel">
        {signals.map((s, i) => (
          <div className={`flag f-${s.severity}`} key={i}>
            <span className="dot">{icon(s)}</span>
            <div className="txt">
              <div className="code">{s.code.replace(/_/g, " ")}</div>
              <div className="ev">{s.evidence}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The money, on the channel YOU would actually use.
 *
 * Yish, 2026-08-28: *"I don't like how it is adding cost of fees and shipping
 * when I'm usually buying and selling locally."* He was looking at a gaming PC
 * showing a $183 eBay fee and $15 of shipping on a machine he hands over in a
 * parking lot.
 *
 * Two changes, one in the engine and one here. The engine now treats laptops,
 * consoles and prebuilts as LOCAL-ONLY, so there are no fees to show. And where
 * eBay genuinely is an option — phones, tablets, GPUs, bare components — this
 * screen defaults to **local** and offers a switch, rather than silently
 * picking whichever channel nets more.
 *
 * The switch only renders when there is a real choice. A control that appears
 * with one option is a control that teaches you not to look at it.
 */
function Numbers({ v, ask }: { v: Verdict; ask: number | null }) {
  const val = v.valuation;
  const usable = (v.channels ?? []).filter((c) => c.available);
  const local = usable.find((c) => c.channel === "facebook");
  const shipped = usable.find((c) => c.channel === "ebay");
  const canSwitch = Boolean(local && shipped);
  const [mode, setMode] = useState<"local" | "shipped">("local");
  if (val.medianCents == null) return null;

  const ch = canSwitch ? (mode === "local" ? local! : shipped!) : (v.bestChannel ?? local ?? shipped);
  /**
   * Recompute against the SELECTED channel. Reading `v.netProfitCents` would
   * print the engine's best-channel figure next to the other channel's gross,
   * which is a number that belongs to neither.
   */
  const net = ch && ask != null ? ch.netCents - ask : (v.netProfitCents ?? 0);
  const target = ch ? Math.max(0, ch.netCents - (v.requiredProfitCents ?? 0)) : v.targetOfferCents ?? 0;

  return (
    <section className="sec rise">
      <div className="nhead">
        <h4>The numbers</h4>
        {canSwitch && (
          <div className="chsw" role="tablist" aria-label="Resale channel">
            <button role="tab" aria-selected={mode === "local"}
              className={mode === "local" ? "on" : ""} onClick={() => setMode("local")}>Local</button>
            <button role="tab" aria-selected={mode === "shipped"}
              className={mode === "shipped" ? "on" : ""} onClick={() => setMode("shipped")}>eBay</button>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="kv">
          <div className="k">Market value<small>{val.compCount} sold comps · {val.confidence} confidence</small></div>
          <div className="v num">{money(val.lowCents)}–{money(val.highCents)}</div>
        </div>

        {ch && (
          <>
            <div className="kv">
              <div className="k">
                {ch.channel === "facebook" ? "Selling locally" : "Selling on eBay"}
                <small>{ch.channel === "facebook" ? "cash, no fees, no shipping" : "after fees and postage"}</small>
              </div>
              <div className="v num">{money(ch.grossCents)}</div>
            </div>
            {ch.feesCents > 0 && <div className="kv sub"><div className="k">fees</div><div className="v num">−{money(ch.feesCents)}</div></div>}
            {ch.shippingCents > 0 && <div className="kv sub"><div className="k">shipping</div><div className="v num">−{money(ch.shippingCents)}</div></div>}
          </>
        )}

        {/* The answer you opened the screen for. Sized like it. */}
        <div className="kv anchor">
          <div className="k">Your profit at asking price</div>
          <div className={`v num ${net > 0 ? "pos" : "neg"}`}>{net > 0 ? "+" : ""}{money(net)}</div>
        </div>
        <div className="kv quiet">
          <div className="k">You need at least<small>for the drive and the effort</small></div>
          <div className="v num">{money(v.requiredProfitCents)}</div>
        </div>
        {target > 0 ? (
          <div className="kv hi">
            <div className="k">Offer this or less</div>
            <div className="v num">{money(target)}</div>
          </div>
        ) : null}
      </div>

      {!canSwitch && ch?.channel === "facebook" && (
        <p className="chnote">Too bulky to post — local sale only, so there are no fees to take out.</p>
      )}
    </section>
  );
}

function Questions({ qs }: { qs: string[] }) {
  const [copied, setCopied] = useState<number | null>(null);
  if (!qs?.length) return null;
  /**
   * Copy ALL of them, not just one at a time.
   *
   * Codex: "Copy these three questions". The per-question buttons made you
   * paste, switch app, send, come back, and repeat — which is why in practice
   * you ask one question instead of three. The unresolved blockers are already
   * ordered first by `gateQuestions`, so the joined text leads with the one
   * that actually decides it.
   */
  const copyAll = () => {
    navigator.clipboard.writeText(qs.map((q, i) => `${i + 1}. ${q}`).join("\n"))
      .then(() => toast(`${qs.length} question${qs.length === 1 ? "" : "s"} copied`))
      .catch(() => toast("Couldn't copy", true));
    setCopied(-1);
    setTimeout(() => setCopied(null), 1800);
  };

  return (
    <section className="sec rise">
      <h4>
        Ask the seller <em>(before you drive)</em>
        <button className={`copyall ${copied === -1 ? "ok" : ""}`} onClick={copyAll}>
          {copied === -1 ? "copied all" : `copy all ${qs.length}`}
        </button>
      </h4>
      <div className="panel">
        {qs.map((q, i) => (
          <div className="q" key={i}>
            <span className="n num">{i + 1}</span>
            <span className="t">{q}</span>
            <button
              className={copied === i ? "ok" : ""}
              aria-label={`Copy question ${i + 1}`}
              onClick={() => {
                navigator.clipboard.writeText(q)
                  .then(() => toast("Question copied"))
                  .catch(() => toast("Couldn't copy", true));
                setCopied(i); setTimeout(() => setCopied(null), 1500);
              }}
            >{copied === i ? "copied" : "copy"}</button>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Photo gallery. Swipes horizontally, snaps, and counts.
 *
 * The old version rendered 12 fixed 120x90 thumbnails in a row, which is a
 * contact sheet, not a gallery — on a listing where the specs are in photo 4
 * you could not actually read photo 4. Sellers put the spec sheet, the damage
 * and the serial in the photos; this is the screen where you look at them.
 */
function Gallery({ urls, onOpen }: { urls: string[]; onOpen: (i: number) => void }) {
  const [i, setI] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  if (!urls?.length) return null;

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setI(Math.round(el.scrollLeft / el.clientWidth));
  };

  return (
    <div className="gal hero-shot">
      <div className="galstrip" ref={ref} onScroll={onScroll}>
        {urls.slice(0, 20).map((u, n) => (
          <button className="galshot" key={n} onClick={() => onOpen(n)}
            aria-label={`Photo ${n + 1} of ${Math.min(urls.length, 20)}`}>
            <img src={u} alt="" loading={n === 0 ? "eager" : "lazy"} />
          </button>
        ))}
      </div>
      {urls.length > 1 && (
        <div className="galdots" aria-hidden="true">
          <span className="num">{i + 1}/{Math.min(urls.length, 20)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Full-screen photo viewer. Escape and a visible close button both dismiss —
 * a lightbox you can only leave by guessing at a gesture is a trap.
 *
 * ── WHAT WAS WRONG WITH IT (audit §16) ─────────────────────────────────────
 *
 * It opened with focus still on the Photo button UNDERNEATH it, Tab walked
 * straight out into the page behind, and closing dropped focus onto the
 * document — so a keyboard user who opened a photo had to tab from the top of
 * the app to get back to where they were. `aria-modal` claimed a trap that did
 * not exist.
 *
 * Three things fix it and all three are load-bearing:
 *
 *   · Focus Close on open, and RESTORE focus to the trigger on close. The
 *     trigger is captured at mount because by the time the effect cleans up,
 *     `document.activeElement` is `<body>`.
 *   · Trap Tab and Shift+Tab across the dialog's own focusables.
 *   · ArrowLeft/ArrowRight move between photos, and the current one is
 *     announced as "Photo 2 of 6" — a strip you can only swipe is a phone-only
 *     control.
 */
function Lightbox({ urls, start, onClose }: { urls: string[]; start: number; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(start);
  const total = urls.length;

  const goTo = useCallback((n: number) => {
    const i = Math.max(0, Math.min(total - 1, n));
    setAt(i);
    strip.current?.children[i]?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [total]);

  useEffect(() => {
    // Captured NOW: on cleanup, activeElement is <body>, not the trigger.
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    box.current?.querySelector<HTMLElement>(".lbxclose")?.focus();

    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); setAt((n) => Math.min(total - 1, n + 1)); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); setAt((n) => Math.max(0, n - 1)); return; }
      if (e.key !== "Tab") return;
      const f = box.current?.querySelectorAll<HTMLElement>("button:not(:disabled)");
      if (!f?.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    addEventListener("keydown", on);
    return () => {
      removeEventListener("keydown", on);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [onClose, total]);

  // Keyboard paging scrolls the strip; the strip's own scroll updates the count.
  useEffect(() => {
    strip.current?.children[at]?.scrollIntoView({ inline: "center", block: "nearest" });
    // `at` only — running on every render would fight a swipe mid-gesture.
  }, [at]);

  return (
    <div className="lbx" role="dialog" aria-modal="true" aria-label={`Photo ${at + 1} of ${total}`} ref={box}>
      <button className="lbxclose" onClick={onClose} aria-label="Close photos">✕</button>
      {total > 1 && (
        <>
          <button className="lbxnav prev" onClick={() => goTo(at - 1)} disabled={at === 0}
            aria-label="Previous photo">‹</button>
          <button className="lbxnav next" onClick={() => goTo(at + 1)} disabled={at === total - 1}
            aria-label="Next photo">›</button>
        </>
      )}
      <div className="lbxstrip" ref={strip}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAt(Math.round(el.scrollLeft / el.clientWidth));
        }}>
        {urls.map((u, n) => (
          <img key={n} src={u} alt={`Photo ${n + 1} of ${total}`}
            /**
             * Only the neighbours load eagerly. Preloading all 20 on a listing
             * with full-size photos is megabytes nobody asked for, on a phone
             * that is probably on cellular in someone's driveway.
             */
            loading={Math.abs(n - start) <= 1 ? "eager" : "lazy"} />
        ))}
      </div>
      {total > 1 && <div className="lbxcount num">{at + 1} / {total}</div>}
    </div>
  );
}

/**
 * The hard-blocker panel — the risk layer, finally visible.
 *
 * `riskChecks` has been computed and attached to every verdict for weeks and
 * was rendered nowhere, so the thing that actually separates Assyze from a
 * price lookup was invisible in the product. Each check states what it is,
 * whether the listing resolved it, and the exact question that would.
 */
function Blockers({ checks }: { checks: RiskCheck[] }) {
  if (!checks?.length) return null;

  /**
   * ⚠ A BLOCKER IS A DISCLOSED DEFECT. AN UNKNOWN IS NOT A BLOCKER.
   *
   * Yish, 2026-08-28: *"I don't like how there are so many hard blockers and
   * most of the time they aren't actually hard blockers... with graphics cards
   * there's always this hard blocker about how it's unknown if the card has
   * display ports... maybe if it mentions that 1 of the HDMI ports is damaged
   * that would be a good example."*
   *
   * He is right, and the codebase already contains the principle: **a check
   * that fires on everything carries no information.** DISPLAY_OUTPUTS was
   * `unresolved` on essentially every graphics card, because you cannot see an
   * I/O bracket from a listing — so the panel screamed HARD BLOCKER at every
   * card in the feed and the label stopped meaning anything.
   *
   * `failed` is the only state that belongs here: the listing SAID something is
   * wrong. Everything else moves:
   *
   *   unresolved + remote    -> a question. Asking costs one message.
   *   unresolved + in person -> a quiet "look at this on pickup" line.
   *   cleared                -> not shown at all. A resolved check is noise.
   *
   * The engine is unchanged — `riskGate` still caps BUY on a remote unknown,
   * which is what stops an activation-locked phone reading as a deal. This is
   * about what is worth SAYING, not about what is enforced.
   */
  const disclosed = checks.filter((c) => c.state === "failed");
  const onPickup = checks.filter((c) => c.state === "unresolved" && !c.remote).slice(0, 2);

  if (!disclosed.length && !onPickup.length) return null;

  return (
    <>
      {disclosed.length > 0 && (
        <section className="sec rise">
          <h4>What's wrong with it <em>({disclosed.length} disclosed)</em></h4>
          <ul className="risks">
            {disclosed.map((c) => (
              <li key={c.code} className="risk r-failed">
                <span className="rstate">stated</span>
                <div>
                  <b>{c.label}</b>
                  {c.evidence && <p>{c.evidence}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {onPickup.length > 0 && (
        <section className="sec rise">
          <h4>Check when you get there</h4>
          <ul className="pickup">
            {onPickup.map((c) => <li key={c.code}>{c.label}</li>)}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * New retail, when we hold it. The one number on this screen that does NOT
 * come from the comps archive, which is exactly why it is worth showing
 * separately rather than folding into the market range.
 */
function Ceiling({ r }: { r: Retail }) {
  return (
    <section className="sec rise ceil">
      <h4>New retail {r.corroborated
        ? <em>({r.quotes.length} retailers agree)</em>
        : <em className="warn">(one retailer only)</em>}</h4>
      <div className="ceilrow">
        <span className="num ceilprice">{money(r.priceCents)}</span>
        <span className="ceilwho">{r.quotes.map((q) => `${q.source} ${money(q.priceCents)}`).join(" · ")}</span>
      </div>
      <p className="ceilnote">{r.title}</p>
    </section>
  );
}

/**
 * One-tap outcomes. Codex's highest-leverage small feature.
 *
 * `outcomes` had three rows because nothing ever asked. No free-text form:
 * an outcome you have to write a paragraph about is an outcome nobody records.
 */
function Outcome({ id }: { id: number }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const OPTS = [
    { a: "bought", label: "I bought it" },
    { a: "passed", label: "Passed" },
    { a: "no_reply", label: "No reply" },
    { a: "dead_listing", label: "Gone" },
  ];
  const send = async (action: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/v1/checks/${id}/outcome`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (r.ok) setSaved(action);
    } finally { setBusy(false); }
  };

  return (
    <section className="sec rise">
      <h4>What happened?</h4>
      <p className="outnote">
        This is what teaches the engine. Every answer becomes a real clearing
        price it can check itself against.
      </p>
      <div className="outrow" role="group" aria-label="Record what happened">
        {OPTS.map((o) => (
          <button key={o.a} className={`out ${saved === o.a ? "on" : ""}`}
            disabled={busy || !!saved} aria-pressed={saved === o.a}
            onClick={() => void send(o.a)}>
            {saved === o.a ? <Check size={13} /> : null}{o.label}
          </button>
        ))}
      </div>
      {saved && <p className="outok" role="status">Saved. Thanks — that one actually helps.</p>}
    </section>
  );
}

function Report({ listing, verdict, signals, meta, stage, reading, checkId }: {
  listing: Listing | null; verdict: Verdict | null; signals: Signal[];
  meta?: Meta; stage: number; reading: number; checkId?: number | null;
}) {
  const [lbx, setLbx] = useState<number | null>(null);
  if (!listing) return null;

  const src = listing.source === "craigslist" ? "Craigslist"
    : listing.source === "facebook" ? "Facebook Marketplace"
    : listing.source === "offerup" ? "OfferUp"
    : listing.source === "mercari" ? "Mercari" : listing.source;

  return (
    <>
      {/**
        * ⚠ `.dtop` IS A PLAIN WRAPPER ON A PHONE AND A TWO-COLUMN GRID FROM
        * 1024px. Photos left, the decision right, and the decision STICKS.
        *
        * On a phone you scroll from the photo down to the verdict, which is
        * correct — there is only one column. On a desktop there is room to have
        * both at once, and "the number next to the picture" is the entire
        * product. Everything that is READING rather than DECIDING — questions,
        * flags, comps, provenance — stays full width below.
        */}
      <div className="dtop">
        <Gallery urls={listing.photoUrls ?? []} onOpen={setLbx} />
        {lbx !== null && (
          <Lightbox urls={listing.photoUrls} start={lbx} onClose={() => setLbx(null)} />
        )}

        <div className="dside">
          <div className="lh rise">
            {/* The listing IS the page here, so its title is the H1. It was an H2
                under no H1 at all, which leaves a screen reader's outline starting
                at level 2 with nothing above it. */}
            <h1>{listing.title}</h1>
            <div className="meta">
              <span className="price num">{money(listing.askingPriceCents)}</span>
              <span className="facts">
                {[listing.location, ago(listing.postedAt)].filter(Boolean).join(" · ")}
              </span>
            </div>

            {/**
              * The link to the original is a PRIMARY action, not a footnote.
              *
              * It was a 12px text link buried under the price. Every path through
              * this screen ends at the real listing — to message the seller, to
              * check the photos again, to see whether it is still up — so it gets
              * a full-width target that says which site it goes to.
              */}
            <a className="origin" href={listing.url} target="_blank" rel="noopener noreferrer">
              <Link size={15} />
              <span>Open on {src}</span>
              <span className="arrow" aria-hidden="true">↗</span>
            </a>
          </div>

          {verdict ? (
            <div className={`verdict verdictcard v-${verdict.call} rise`} role="status" aria-live="polite">
              <span className="vbadge">
                {verdict.call === "BUY" ? <Check size={13} /> : verdict.call === "RISK" ? <Alert size={13} /> : <Info size={13} />}
                {LABEL[verdict.call]}
              </span>
              <h3>{verdict.headline}</h3>
              <p>{verdict.reasoning}</p>
              {verdict.decidingUnknown && (
                <div className="settles"><b>What settles it:</b> {verdict.decidingUnknown}</div>
              )}
            </div>
          ) : (
            <div className="verdict v-INSUFFICIENT_DATA" aria-busy="true">
              <div className="skel" style={{ height: 12, width: 76, marginBottom: 14 }} />
              <div className="skel" style={{ height: 18, width: "68%", marginBottom: 10 }} />
              <div className="skel" style={{ height: 13, width: "92%", marginBottom: 6 }} />
              <div className="skel" style={{ height: 13, width: "55%" }} />
            </div>
          )}

          {reading > 0 && (
            <div className="reading" role="status" aria-live="polite">
              <span className="spin" aria-hidden="true" />
              Reading {reading} photo{reading === 1 ? "" : "s"} — sellers often put the specs in an image
            </div>
          )}

          {stage < 3 && (
            <div className="prog" aria-hidden="true">
              {[0, 1, 2].map((i) => <span className={`step ${stage > i ? "on" : ""}`} key={i}><i /></span>)}
            </div>
          )}

          {verdict && <Numbers v={verdict} ask={listing?.askingPriceCents ?? null} />}
        </div>
      </div>
      {verdict?.retail && <Ceiling r={verdict.retail} />}
      {verdict?.riskChecks?.length ? <Blockers checks={verdict.riskChecks} /> : null}
      <Flags signals={signals} />
      {verdict && <Questions qs={verdict.questions} />}
      {/**
        * "What happened?" was REMOVED from the listing view, 2026-08-28.
        *
        * Yish: *"when clicking into a listing I don't want the what happened
        * section at all."* He is right about the placement. You open a listing
        * to decide whether to drive there — being asked what you did about it
        * in the same breath is asking about a trip that has not happened, and
        * it sat between him and the questions he came for.
        *
        * The outcome loop is NOT gone: `OutcomePrompt` still asks on the feed a
        * DAY later, which is when there is something true to answer. That is
        * where the data actually comes from.
        */}

      {/**
        * What the engine THOUGHT this was, shown last.
        *
        * Every wrong verdict this month traced to a wrong match — a network
        * switch read as a Nintendo Switch, an RTX 5070 Ti priced as a 5070, a
        * printer as a prebuilt PC. Printing the resolved model and the comp
        * count makes that visible on the screen where it matters, instead of
        * requiring someone to notice the number looks odd.
        */}
      {meta?.match?.model && (
        <div className="prov">
          Priced as <b>{[meta.match.brand, meta.match.model].filter(Boolean).join(" ")}</b>
          {verdict?.valuation?.compCount
            ? <> from <span className="num">{verdict.valuation.compCount}</span> sold comps</> : null}
          {meta.match.confidence ? <> · {meta.match.confidence} confidence match</> : null}
          {meta.category ? <> · {meta.category}</> : null}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ app
/**
 * The watchlist.
 *
 * It re-fetches current state for the saved ids on every visit rather than
 * rendering what you saw when you saved them. A watchlist that showed the old
 * price would be a screenshot, and the point of saving something is to be told
 * when it changes.
 *
 * The summary line leads because it is the answer to "why did I open this":
 * two dropped, one is gone. That sentence is the whole feature.
 */
function Watchlist({ onOpen, onWatchChange, onBrowse }: {
  onOpen: (id: number) => void;
  onWatchChange: (n: number) => void;
  /** The empty state needs a way out. Audit §"Saved and Alerts". */
  onBrowse: () => void;
}) {
  const [sub, setSub] = useState<"listings" | "alerts">("listings");
  const [ids, setIds] = useState<number[]>(readWatch);
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [summary, setSummary] = useState<{ dropped: number; gone: number }>({ dropped: 0, gone: 0 });

  useEffect(() => {
    if (!ids.length) { setItems([]); return; }
    fetch(`/v1/watchlist?ids=${ids.join(",")}`)
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items ?? []);
        setSummary(d.summary ?? { dropped: 0, gone: 0 });
        /**
         * PRUNE IDS THE SERVER NO LONGER KNOWS. Without this a purged listing
         * stays in localStorage forever and every future request carries a
         * dead id, so the saved count never matches what is on screen.
         */
        if (d.missing?.length) {
          const keep = ids.filter((i: number) => !d.missing.includes(i));
          writeWatch(keep); setIds(keep);
        }
      })
      .catch(() => setItems([]));
    // `ids` is intentionally the only dep: re-running on every render would
    // hammer the endpoint.
  }, [ids.join(",")]);

  const news: string[] = [];
  if (summary.dropped) news.push(`${summary.dropped} dropped in price`);
  if (summary.gone) news.push(`${summary.gone} ${summary.gone === 1 ? "is" : "are"} gone`);

  /**
   * ⚠ THE H1 ALWAYS RENDERS (audit §17). The empty state used to return early
   * with only a `<b>`, so the Saved screen had no heading at all and screen
   * readers got no landmark for it.
   *
   * **Alerts live here, not in Settings** (audit §12). A saved search is
   * discovery, not configuration — it was buried below Billing and Feed
   * settings, which is the wrong place for one of the few features that gives
   * anyone a reason to come back.
   */
  return (
    <div className="sec">
      <div className="feedhead">
        <h1>Saved</h1>
        <p>
          {items === null ? "Loading…"
            : items.length === 0 ? "Listings you bookmark, and alerts for searches you save."
            : news.length ? news.join(" · ")
            : `${items.length} saved, nothing changed yet.`}
        </p>
      </div>

      <div className="subtabs" role="tablist" aria-label="Saved">
        <button role="tab" aria-selected={sub === "listings"} className={sub === "listings" ? "on" : ""}
          onClick={() => setSub("listings")}>Listings{items?.length ? ` (${items.length})` : ""}</button>
        <button role="tab" aria-selected={sub === "alerts"} className={sub === "alerts" ? "on" : ""}
          onClick={() => setSub("alerts")}>Alerts</button>
      </div>

      {sub === "listings" && (
        !items ? (
          <div>{[0, 1].map((i) => <div className="skel" key={i} style={{ height: 240, marginBottom: 8 }} />)}</div>
        ) : items.length === 0 ? (
          <div className="empty">
            <span className="eic"><Save size={26} /></span>
            <b>Nothing saved yet</b>
            <p>Tap the bookmark on any listing. Saved listings are re-checked daily, and this is where a price drop or a disappearance shows up.</p>
            <button className="btn2" onClick={onBrowse}><Grid size={15} /> Browse deals</button>
          </div>
        ) : (
          <>
            <div className="grid">
              {items.map((i) => (
                <Gcard key={i.id} i={i} saved
                  onSave={() => { const n = toggleWatch(i.id); setIds(n); onWatchChange(n.length); }}
                  onOpen={() => onOpen(i.id)} />
              ))}
            </div>
            {/* Present tense: this is what the product does, not a promise. */}
            <p className="micro2">Saved on this device.</p>
          </>
        )
      )}

      {sub === "alerts" && <Alerts />}
    </div>
  );
}

type Tab = "deals" | "check" | "saved" | "you" | "settings";

/**
 * The bottom toolbar.
 *
 * There WAS one, it was removed, and removing it was the wrong call. The
 * original bug was that `.tabs` was `position: absolute` inside a fixed-height
 * fake phone frame, so on a real device it rendered at the end of the scroll
 * content and you had to scroll past 285 listings to reach it. That is a
 * positioning bug, not an argument against bottom navigation, and every mobile
 * app has one for the good reason that the bottom of the screen is where the
 * thumb already is.
 *
 * `position: fixed` with `env(safe-area-inset-bottom)` this time, so it sits
 * above the home indicator rather than under it.
 *
 * FOUR ITEMS, ALL REAL DESTINATIONS. Settings is deliberately NOT among them —
 * it is somewhere you go twice a year, and spending a quarter of the toolbar on
 * it would cost the same room the watchlist needs. It lives in the top bar.
 */
type NavId = "deals" | "check" | "saved";

/**
 * THREE DESTINATIONS. "You" was a primary tab holding four read-only server
 * defaults and the words "Editing these is coming" (audit §13). Its one real
 * number lives under Settings -> Your numbers, so the tab was spending a
 * quarter of the bar on a screen with nothing to do.
 *
 * Three items also give each one more room, which is what the 44px targets in
 * the accessibility pass need.
 */
const NAV: Array<[NavId, string]> = [
  ["deals", "Deals"], ["check", "Check"], ["saved", "Saved"],
];
const navIcon = (id: NavId, on: boolean, size: number) =>
  id === "deals" ? <Grid size={size} />
    : id === "check" ? <Scan size={size} />
      : <Save size={size} filled={on} />;

function Tabbar({ tab, go, savedCount }: {
  tab: NavId | null;
  go: (t: NavId | "settings") => void;
  savedCount: number;
}) {
  return (
    <nav className="tabbar" aria-label="Main">
      {NAV.map(([id, label]) => (
        <button key={id} className={`tab${tab === id ? " on" : ""}`}
          aria-current={tab === id ? "page" : undefined}
          onClick={() => go(id)}>
          <span className="ti">
            {navIcon(id, tab === id, 21)}
            {id === "saved" && savedCount > 0
              ? <span className="tdot" aria-hidden="true">{savedCount > 9 ? "9+" : savedCount}</span>
              : null}
          </span>
          <span className="tl">{label}</span>
        </button>
      ))}
    </nav>
  );
}

/**
 * The same three destinations, in the header, for desktop.
 *
 * ⚠ BOTH NAVS RENDER AND CSS PICKS ONE. At 1440px the app was a 560px phone
 * column with a bottom bar stretched across the whole window, each target 475px
 * wide — the single strongest reason the site read as unfinished on a desktop.
 *
 * They are two elements rather than one that moves, because the bottom bar is a
 * fixed overlay with a safe-area inset and the header row is in normal flow;
 * one element cannot be both without a container query per property. The list
 * and the icons come from the SAME `NAV` constant, so a fourth destination
 * cannot appear in one and not the other.
 *
 * `aria-hidden` is deliberately NOT used to hide the inactive one — the CSS
 * `display: none` already removes it from the accessibility tree, and marking
 * the visible one hidden at the wrong breakpoint would silence the real nav.
 */
function HeaderNav({ tab, go, savedCount }: {
  tab: NavId | null;
  go: (t: NavId | "settings") => void;
  savedCount: number;
}) {
  return (
    <nav className="hnav" aria-label="Main">
      {NAV.map(([id, label]) => (
        <button key={id} className={`hnavlink${tab === id ? " on" : ""}`}
          aria-current={tab === id ? "page" : undefined}
          onClick={() => go(id)}>
          {navIcon(id, tab === id, 17)}
          <span>{label}</span>
          {id === "saved" && savedCount > 0
            ? <span className="hnavn num">{savedCount > 99 ? "99+" : savedCount}</span>
            : null}
        </button>
      ))}
    </nav>
  );
}

/**
 * "What happened with this one?"
 *
 * Outcomes are the only data in this product that nobody can copy: comps are
 * scraped, listings are public, but what a real buyer DID about a specific
 * verdict exists nowhere else. The buttons for recording it shipped a while
 * ago and the table stayed empty for one reason — nothing ever asked.
 *
 * Four taps, no free text. An outcome you have to write a sentence about is an
 * outcome nobody records.
 *
 * Dismissing counts as asked. Being shown the same question every launch until
 * you answer is how a prompt becomes something people learn to close without
 * reading, and then the honest answers stop too.
 */
function OutcomePrompt({ h, onDone }: { h: Hist; onDone: () => void }) {
  const [sent, setSent] = useState<string | null>(null);

  const send = (action: string, label: string) => {
    setSent(label);
    markAsked(h.id);
    // Fire and forget: the answer is already recorded locally as asked, and
    // making the user wait on a network round trip to dismiss a prompt is a
    // good way to have them stop answering.
    fetch(`/v1/checks/${h.id}/outcome`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => {});
    setTimeout(onDone, 900);
  };

  if (sent) {
    return <div className="ask done"><Check size={15} /> {sent}. Thanks — that trains the engine.</div>;
  }

  return (
    <div className="ask">
      <div className="askhead">
        <b>What happened with this one?</b>
        <button className="askx" onClick={() => { markAsked(h.id); onDone(); }} aria-label="Dismiss">×</button>
      </div>
      <span className="asktitle">{h.title}</span>
      <div className="askrow">
        <button onClick={() => send("bought", "Bought")}>I bought it</button>
        <button onClick={() => send("passed", "Passed")}>Passed</button>
        <button onClick={() => send("no_reply", "No reply")}>No reply</button>
        <button onClick={() => send("gone", "Gone")}>Gone</button>
      </div>
    </div>
  );
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
  const [meta, setMeta] = useState<Meta | undefined>(undefined);
  const [stage, setStage] = useState(0);
  const [ms, setMs] = useState<number | null>(null);
  const [reading, setReading] = useState(0);   // photos being read, 0 = not reading
  const [checkId, setCheckId] = useState<number | null>(null);
  const [hist, setHist] = useState<Hist[]>(readHist);
  const [savedCount, setSavedCount] = useState(() => readWatch().length);
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [ask, setAsk] = useState<Hist | null>(() => pendingOutcome(readHist(), readAsked()));
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
      setSignals(d.signals ?? []); setMeta(d.meta); setStage(3);
    }).finally(() => setBusy(false));
  }, [path]);

  const reset = () => {
    es.current?.close();
    setError(null); setListing(null); setVerdict(null);
    setSignals([]); setMeta(undefined); setStage(0); setMs(null); setCheckId(null); setReading(0);
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
                <Report listing={listing} verdict={verdict} signals={signals}
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

/**
 * The You screen.
 *
 * It was four rows of a key/value table with a paragraph under it — the same
 * treatment a debug dump gets. These numbers are the ones every verdict on the
 * site is computed against, so they are worth stating as a claim rather than a
 * spec sheet.
 *
 * History lives here too. It was rendered on the Check screen where it competed
 * with the paste box; this is where you go to find something you already looked
 * at.
 */
/**
 * A stable per-device ref, used as Stripe's `client_reference_id`.
 *
 * There are no accounts yet, and inventing an email login purely to hang a
 * subscription off would be the largest change on the list for the least
 * benefit. The browser mints a random ref once; Stripe echoes it back on the
 * webhook and that is what the entitlement is keyed on. When real accounts
 * exist this becomes a user id and nothing else changes.
 */
const REFKEY = "assyze:ref";
function deviceRef(): string {
  let v = localStorage.getItem(REFKEY);
  if (!v) {
    v = crypto.randomUUID().replace(/-/g, "");
    localStorage.setItem(REFKEY, v);
  }
  return v;
}

/**
 * Billing.
 *
 * **The server decides whether there is anything to sell.** `enabled` is false
 * until a Stripe price is configured, and the screen then shows the free plan
 * with a real explanation instead of a dead Upgrade button — a control that
 * opens nothing teaches people the whole screen is decorative.
 *
 * `?paid=1` on return from Checkout only triggers a REFRESH. It is never taken
 * as proof of payment; the webhook is the only thing that grants access.
 */
function Billing({ onlyWhenEnabled }: { onlyWhenEnabled?: boolean }) {
  const [st, setSt] = useState<{ enabled: boolean; plan: string; active?: boolean; until?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch(`/v1/billing/status?ref=${deviceRef()}`).then((r) => r.json()).then(setSt).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    if (new URLSearchParams(location.search).get("paid") === "1") {
      history.replaceState({}, "", "/");
      // The webhook may land a beat after the redirect, so re-check shortly.
      setTimeout(load, 2500);
    }
  }, [load]);

  async function go(path: string) {
    setBusy(true);
    try {
      const r = await (await fetch(`/v1/billing/${path}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref: deviceRef() }),
      })).json();
      if (r.url) location.href = r.url;
    } finally { setBusy(false); }
  }

  // Nothing to sell and nothing bought: render nothing at all.
  if (onlyWhenEnabled && st && !st.enabled && !st.active) return null;
  if (onlyWhenEnabled && !st) return null;

  return (
    <div className="sgroup">
      <div className="shead"><Card size={14} /> Billing</div>
      <div className="scard">
        <div className="planrow">
          <div>
            <b>{st?.active ? "Pro" : "Free"}</b>
            <span>
              {st?.active
                ? "Everything in Assyze, including alerts."
                : "Every listing in the feed, unlimited checks, and the daily tracker."}
            </span>
          </div>
          <span className="pill">Current</span>
        </div>

        {!st?.enabled && (
          <p className="snote">
            Assyze is free while the feed is being built out. Paid plans come when there
            is something worth charging for, and nothing you use today moves behind a
            paywall.
          </p>
        )}

        {st?.enabled && !st.active && (
          <button className="btn2" disabled={busy} onClick={() => go("checkout")}>
            <Card size={15} /> {busy ? "Opening…" : "Upgrade"}
          </button>
        )}

        {st?.enabled && st.active && (
          <>
            {st.until && (
              <p className="snote">Renews {new Date(st.until).toLocaleDateString()}.</p>
            )}
            <button className="btn2" disabled={busy} onClick={() => go("portal")}>
              {busy ? "Opening…" : "Manage subscription"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Base64url -> Uint8Array, required by `pushManager.subscribe`.
 *
 * `applicationServerKey` will NOT accept the base64 string the server sends;
 * it wants raw bytes, and passing the string fails with an opaque
 * "InvalidCharacterError" that says nothing about the real problem.
 */
function urlB64ToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const SUBKEY = "assyze:subId";

/**
 * Saved searches and push alerts.
 *
 * **THE SUBSCRIPTION IS THE ACCOUNT.** The browser mints a push endpoint only
 * this device can receive on, so a saved search hangs off that instead of a
 * user row. No signup, no password, nothing to leak — and the screen says
 * plainly that alerts belong to this device.
 *
 * Permission is requested from a real tap, never on load. A permission prompt
 * fired on page load is denied by reflex, and on Chrome a denial is sticky
 * enough that the feature is then unreachable without digging through site
 * settings.
 */
function Alerts() {
  const supported = typeof Notification !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
  const [perm, setPerm] = useState(supported ? Notification.permission : "unsupported");
  const [subId, setSubId] = useState<number | null>(() => {
    const v = localStorage.getItem(SUBKEY); return v ? Number(v) : null;
  });
  const [list, setList] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [max, setMax] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!subId) return;
    fetch(`/v1/searches?subId=${subId}`).then((r) => r.json())
      .then((d) => setList(d.items ?? [])).catch(() => {});
  }, [subId]);

  async function enable() {
    setBusy(true); setNote(null);
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== "granted") { setNote("Notifications were blocked. You can undo that in your browser's site settings."); return; }

      const { publicKey, configured } = await (await fetch("/v1/push/vapid")).json();
      if (!configured || !publicKey) { setNote("Push isn't configured on the server yet."); return; }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToBytes(publicKey),
      });
      const r = await (await fetch("/v1/push/subscribe", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      })).json();
      if (r.subId) { localStorage.setItem(SUBKEY, String(r.subId)); setSubId(r.subId); }
    } catch (e) {
      setNote(`Couldn't turn on alerts: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  async function add() {
    const maxCents = max.trim() ? Math.round(Number(max.replace(/[^0-9.]/g, "")) * 100) : null;
    setBusy(true); setNote(null);
    const r = await (await fetch("/v1/searches", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ subId, query: q.trim() || null, maxPriceCents: maxCents, label: q.trim() || `Under ${max}` }),
    })).json();
    setBusy(false);
    if (r.error) { setNote(r.error); return; }
    setQ(""); setMax("");
    fetch(`/v1/searches?subId=${subId}`).then((x) => x.json()).then((d) => setList(d.items ?? []));
  }

  async function remove(id: number) {
    await fetch(`/v1/searches/${id}?subId=${subId}`, { method: "DELETE" });
    setList((l) => l.filter((x) => x.id !== id));
  }

  return (
    <div className="sgroup">
      <div className="shead"><Bell size={14} /> Alerts</div>
      <div className="scard">
        {!supported && (
          <p className="snote">
            This browser can't show notifications. Install Assyze to your home screen and open it from there.
          </p>
        )}

        {supported && !subId && (
          <>
            <p className="snote">
              Get told the moment something matching your search posts. This is where the
              feed stops being somewhere you have to remember to check.
            </p>
            <button className="btn2" disabled={busy} onClick={enable}>
              <Bell size={15} /> {busy ? "Turning on…" : "Turn on alerts"}
            </button>
          </>
        )}

        {supported && subId && (
          <>
            {list.map((s) => (
              <div className="srow static" key={s.id}>
                <span className="stext">
                  <b>{s.label}</b>
                  <span>
                    {[s.query && `matches "${s.query}"`,
                      s.max_price_cents && `under ${money(s.max_price_cents)}`]
                      .filter(Boolean).join(" · ") || "any listing"}
                  </span>
                </span>
                <button className="btn3" onClick={() => remove(s.id)}>Remove</button>
              </div>
            ))}

            <div className="srow static newsearch">
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="rtx 4090" aria-label="Words to match" />
              <input value={max} onChange={(e) => setMax(e.target.value)}
                placeholder="max $" inputMode="decimal" aria-label="Maximum price" />
              <button className="btn3" disabled={busy || (!q.trim() && !max.trim())} onClick={add}>Add</button>
            </div>

            <p className="snote">
              Every word has to appear in the title, so "rtx 4090" won't alert on every
              graphics card. Alerts only cover listings found after you save the search,
              and they live on this device.
            </p>
            <button className="btn2" onClick={async () => {
              const r = await (await fetch(`/v1/push/test?subId=${subId}`, { method: "POST" })).json();
              setNote(r.sent ? "Sent — check your notifications." : r.error ?? "Couldn't send.");
            }}>Send a test notification</button>
          </>
        )}

        {note && <p className="snote alertnote">{note}</p>}
      </div>
    </div>
  );
}

/** A labelled row with a switch. */
function Toggle({ label, hint, on, onChange }: {
  label: string; hint: string; on: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <button className="srow" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span className="stext"><b>{label}</b><span>{hint}</span></span>
      <span className={`sw${on ? " on" : ""}`} aria-hidden="true"><i /></span>
    </button>
  );
}

/**
 * Settings.
 *
 * There was no settings screen at all, which is why "your numbers" ended up on
 * the You tab as a read-only table with "editing these is coming" under it.
 *
 * Only things that DO something are here. A settings screen padded with
 * switches that toggle nothing teaches people the screen is decorative, and
 * then the one that matters gets ignored too. Anything not yet wired says so
 * plainly rather than pretending.
 */
function SettingsScreen({ s, save, savedCount, onClearSaved }: {
  s: Settings; save: (p: Partial<Settings>) => void;
  savedCount: number; onClearSaved: () => void;
}) {
  const [cleared, setCleared] = useState(false);

  return (
    <div className="sec settings">
      <div className="feedhead"><h1>Settings</h1></div>

      {/**
        * ⚠ BILLING RENDERS ONLY WHEN BILLING IS ENABLED (audit §14).
        *
        * The first Settings card explained that the product is free and paid
        * plans may come later. That is honest but not useful, and it pushed
        * every control that DOES something below the fold. `Billing` already
        * asks the server; it just always rendered the answer.
        */}
      <Billing onlyWhenEnabled />

      <div className="sgroup">
        <div className="shead"><Tag size={14} /> Your numbers</div>
        <div className="scard">
          <label className="srow static">
            <span className="stext">
              <b>Willing to drive</b>
              <span>Longer drives need a bigger margin to be worth it.</span>
            </span>
            {/* The bounds are `nav.ts` constants because the SERVER enforces
                the same 5..90 window. A stepper that offered 120 would move
                this number and silently get a 90-minute verdict back. */}
            <span className="stepper">
              <button aria-label="Less driving time" disabled={s.driveMinutes <= DRIVE_MIN}
                onClick={() => save({ driveMinutes: clampDrive(s.driveMinutes - DRIVE_STEP) })}>−</button>
              <span className="num" aria-live="polite">{s.driveMinutes}m</span>
              <button aria-label="More driving time" disabled={s.driveMinutes >= DRIVE_MAX}
                onClick={() => save({ driveMinutes: clampDrive(s.driveMinutes + DRIVE_STEP) })}>+</button>
            </span>
          </label>
          <p className="snote">
            Your profit floor and hourly rate are set on the server for now. They
            show on the You tab.
          </p>
        </div>
      </div>

      <div className="sgroup">
        <div className="shead"><Grid size={14} /> Feed</div>
        <div className="scard">
          <Toggle label="Hide listings that are gone"
            hint="The daily sweep marks a listing dead when the seller pulls it."
            on={s.hideGone} onChange={(v) => save({ hideGone: v })} />
          <Toggle label="Ask what happened"
            hint="A day after you open a listing, ask if you bought it. This is what teaches the engine."
            on={s.askOutcomes} onChange={(v) => save({ askOutcomes: v })} />
          <Toggle label="Reduce motion"
            hint="Turns off screen and card entry animations."
            on={s.reduceMotion} onChange={(v) => save({ reduceMotion: v })} />
        </div>
      </div>


      <div className="sgroup">
        <div className="shead"><Save size={14} /> Data</div>
        <div className="scard">
          <div className="srow static">
            <span className="stext">
              <b>{savedCount} saved {savedCount === 1 ? "listing" : "listings"}</b>
              <span>Stored on this device.</span>
            </span>
            {savedCount > 0 && !cleared && (
              <button className="btn3" onClick={() => { onClearSaved(); setCleared(true); }}>Clear</button>
            )}
            {cleared && <span className="pill">Cleared</span>}
          </div>
        </div>
      </div>

      <p className="micro2">Assyze · assyze.com</p>
    </div>
  );
}

function You({ hist, onOpen }: { hist: Hist[]; onOpen: (id: number) => void }) {
  const ECON = [
    { k: "Won't leave home for less than", v: "$100", why: "Below this, the drive costs more than the flip makes." },
    { k: "Your time is worth", v: "$125/hr", why: "Used to price the round trip into every verdict." },
    { k: "Based in", v: "Newton, MA", why: "Drive time is measured from here." },
    { k: "Prefer to resell on", v: "Facebook", why: "No fees and no shipping, so local nets more." },
  ];

  return (
    <>
      <div className="youhead">
        <div className="youav" aria-hidden="true"><User size={22} /></div>
        <div>
          <h2>Your numbers</h2>
          <p>Every verdict is computed against these. The same listing is a buy
             for one person and a pass for another.</p>
        </div>
      </div>

      <div className="econ">
        {ECON.map((e) => (
          <div className="econrow" key={e.k}>
            <div className="econk">
              <b>{e.k}</b>
              <span>{e.why}</span>
            </div>
            <div className="econv num">{e.v}</div>
          </div>
        ))}
      </div>

      {hist.length > 0 && (
        <section className="sec">
          <h4>Recently checked <em>({hist.length})</em></h4>
          <div className="histlist">
            {hist.slice(0, 12).map((h) => (
              <button className="histrow" key={h.id} onClick={() => onOpen(h.id)}>
                <span className={`dcall b-${h.call}`}>{LABEL[h.call]}</span>
                <span className="histtitle">{h.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

