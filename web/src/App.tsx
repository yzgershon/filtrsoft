import { useCallback, useEffect, useRef, useState } from "react";
import { Scan, Clock, User, Alert, Check, Info, Link, Again, Eye, Shield, Tag, Ghost, Clip, Save, Grid, Gear, Cut, Bell, Card } from "./icons.tsx";

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

/** Settings the user actually controls. Server-side economics stay server-side. */
const SKEY = "assyze:settings";
export interface Settings {
  driveMinutes: number;
  hideGone: boolean;
  reduceMotion: boolean;
  askOutcomes: boolean;
}
const DEFAULT_SETTINGS: Settings = {
  driveMinutes: 15, hideGone: true, reduceMotion: false, askOutcomes: true,
};
const readSettings = (): Settings => {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SKEY) || "{}") }; }
  catch { return DEFAULT_SETTINGS; }
};
const writeSettings = (s: Settings) => localStorage.setItem(SKEY, JSON.stringify(s));

// --------------------------------------------------------------- router
function useRoute() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  return {
    path,
    go: useCallback((p: string) => { history.pushState({}, "", p); setPath(p); }, []),
  };
}

const PAGE = 60;

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
  return (
    <div className={`gcard${i.gone ? " is-gone" : ""}`}>
      <button className="gopen" onClick={(e) => onOpen(e.currentTarget.closest(".gcard") as HTMLElement)}
        aria-label={`Open ${i.title}`}>
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
      <button className={`gsave${saved ? " on" : ""}`} onClick={onSave}
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
  const [filter, setFilter] = useState<"ALL" | "DEAL" | "CHEAP">("ALL");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Which listing currently occupies the hero slot. */
  const [watch, setWatch] = useState<number[]>(readWatch);

  const load = useCallback((offset: number) => {
    setLoadingMore(offset > 0);
    return fetch(`/v1/feed?limit=${PAGE}&offset=${offset}`)
      .then((r) => r.json())
      .then((d) => {
        setItems((prev) => (offset === 0 ? (d.items ?? []) : [...(prev ?? []), ...(d.items ?? [])]));
        setCounts(d.counts ?? {});
        setTotal(d.total ?? 0);
      })
      .catch(() => setItems((prev) => prev ?? []))
      .finally(() => setLoadingMore(false));
  }, []);

  useEffect(() => { void load(0); }, [load]);

  if (!items) return (
    <div className="sec">
      <div className="skel" style={{ height: 210, marginBottom: 12, borderRadius: 16 }} />
      {[0, 1, 2].map((i) => <div className="skel" key={i} style={{ height: 90, marginBottom: 8 }} />)}
    </div>
  );

  const pass = (i: FeedItem) =>
    filter === "ALL" ? true
      : filter === "DEAL" ? ["BUY", "VERIFY", "RISK"].includes(i.call)
      : (i.askingPriceCents ?? Infinity) < 50000;

  const shown = items.filter(pass);
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

  const SEGS: Array<{ id: "ALL" | "DEAL" | "CHEAP"; label: string; n: number }> = [
    { id: "ALL", label: "All", n: total },
    { id: "DEAL", label: "Deals", n: (counts.BUY ?? 0) + (counts.VERIFY ?? 0) + (counts.RISK ?? 0) },
    { id: "CHEAP", label: "Under $500", n: items.filter((i) => (i.askingPriceCents ?? Infinity) < 50000).length },
  ];

  const GROUPS: Array<{ label: string; note: string; tone: string; calls: Call[] }> = [
    { label: "Verified deals", note: "ready to act on", tone: "buy", calls: ["BUY"] },
    { label: "Needs one answer", note: "blocked on a question", tone: "verify", calls: ["VERIFY", "RISK"] },
    { label: "Recently checked", note: "priced, not deals", tone: "mute", calls: ["FAIR", "PASS", "INSUFFICIENT_DATA"] },
  ];

  return (
    <>
      <Segmented value={filter} onChange={setFilter} options={SEGS} />

      {shown.length === 0 ? (
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

      {filter === "ALL" && items.length < total ? (
        <button className="more" disabled={loadingMore} onClick={() => void load(items.length)}>
          {loadingMore ? "Loading…" : `Show more — ${items.length} of ${total}`}
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

  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, options.length]);

  const move = (dir: 1 | -1) => {
    const i = options.findIndex((o) => o.id === value);
    onChange(options[(i + dir + options.length) % options.length].id);
  };

  return (
    <div className="seg" role="radiogroup" aria-label="Deal quality" ref={ref}>
      <span className="segind" style={{ transform: `translateX(${ind.left - 3}px)`, width: ind.width }} />
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id}
          tabIndex={value === o.id ? 0 : -1}
          onClick={() => onChange(o.id)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
            if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
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
    navigator.clipboard.writeText(qs.map((q, i) => `${i + 1}. ${q}`).join("\n"));
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
              onClick={() => { navigator.clipboard.writeText(q); setCopied(i); setTimeout(() => setCopied(null), 1500); }}
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
 */
function Lightbox({ urls, start, onClose }: { urls: string[]; start: number; onClose: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", on);
    document.body.style.overflow = "hidden";
    return () => { removeEventListener("keydown", on); document.body.style.overflow = ""; };
  }, [onClose]);

  return (
    <div className="lbx" role="dialog" aria-modal="true" aria-label="Photos">
      <button className="lbxclose" onClick={onClose} aria-label="Close photos">✕</button>
      <div className="lbxstrip">
        {urls.map((u, n) => (
          <img key={n} src={u} alt="" ref={(el) => { if (el && n === start) el.scrollIntoView({ inline: "center" }); }} />
        ))}
      </div>
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
      <Gallery urls={listing.photoUrls ?? []} onOpen={setLbx} />
      {lbx !== null && (
        <Lightbox urls={listing.photoUrls} start={lbx} onClose={() => setLbx(null)} />
      )}

      <div className="lh rise">
        <h2>{listing.title}</h2>
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
      {verdict?.retail && <Ceiling r={verdict.retail} />}
      {verdict?.riskChecks?.length ? <Blockers checks={verdict.riskChecks} /> : null}
      <Flags signals={signals} />
      {verdict && <Questions qs={verdict.questions} />}
      {checkId ? <Outcome id={checkId} /> : null}

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
function Watchlist({ onOpen, onWatchChange }: {
  onOpen: (id: number) => void;
  onWatchChange: (n: number) => void;
}) {
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

  if (!items) return <div className="sec">{[0, 1].map((i) => <div className="skel" key={i} style={{ height: 240, marginBottom: 8 }} />)}</div>;

  if (!items.length) {
    return (
      <div className="empty">
        <span className="eic"><Save size={26} /></span>
        <b>Nothing saved yet</b>
        <p>Tap the bookmark on any listing. We re-check saved listings every day and tell you when the price drops or it disappears.</p>
      </div>
    );
  }

  const news: string[] = [];
  if (summary.dropped) news.push(`${summary.dropped} dropped in price`);
  if (summary.gone) news.push(`${summary.gone} ${summary.gone === 1 ? "is" : "are"} gone`);

  return (
    <div className="sec">
      <div className="feedhead">
        <h1>Saved</h1>
        <p>{news.length ? news.join(" · ") : `${items.length} saved, nothing changed yet.`}</p>
      </div>
      <div className="grid">
        {items.map((i) => (
          <Gcard key={i.id} i={i} saved
            onSave={() => { const n = toggleWatch(i.id); setIds(n); onWatchChange(n.length); }}
            onOpen={() => onOpen(i.id)} />
        ))}
      </div>
      <p className="micro2">Saved on this device only. Signing in is coming.</p>
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
function Tabbar({ tab, go, savedCount }: { tab: Tab; go: (t: Tab) => void; savedCount: number }) {
  const items: Array<[Tab, string, React.ReactNode]> = [
    ["deals", "Deals", <Grid size={21} />],
    ["check", "Check", <Scan size={21} />],
    ["saved", "Saved", <Save size={21} filled={tab === "saved"} />],
    ["you", "You", <User size={21} />],
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {items.map(([id, label, icon]) => (
        <button key={id} className={`tab${tab === id ? " on" : ""}`}
          aria-current={tab === id ? "page" : undefined}
          onClick={() => go(id)}>
          <span className="ti">
            {icon}
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
  const { path, go } = useRoute();
  const [tab, setTab] = useState<Tab>("deals");
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
   * Switching tabs always clears the open listing and returns to `/`.
   *
   * Without the reset, tapping Deals while a verdict was open left the detail
   * view mounted under the feed's own state and the tab bar highlighted a
   * screen you were not looking at.
   */
  const goTab = useCallback((t: Tab) => {
    reset(); setUrl(""); setTab(t);
    setSavedCount(readWatch().length);
    if (location.pathname !== "/") go("/");
  }, [go]);

  const saveSettings = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next); writeSettings(next);
  };

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
    else { setTab("check"); setError("That share didn't contain a link. Copy the listing URL and paste it instead."); }
    // Fires once per delivery; `runUrl` is stable enough for this one-shot.
  }, [path]);

  useEffect(() => {
    const m = path.match(/^\/c\/(\d+)$/);
    if (!m) return;
    setTab("check"); setBusy(true);
    fetch(`/v1/checks/${m[1]}`).then((r) => r.json()).then((d) => {
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
    reset(); setUrl(u); setBusy(true); setTab("check");

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
        <div className="spacer" />

        {checkId && (
          <button className="iconbtn" aria-label="Copy link to this verdict"
            onClick={() => navigator.clipboard.writeText(`${location.origin}/c/${checkId}`)}>
            <Link size={19} />
          </button>
        )}
        <button className={`iconbtn ${tab === "settings" ? "on" : ""}`}
          aria-label="Settings" aria-pressed={tab === "settings"}
          onClick={() => goTab(tab === "settings" ? "deals" : "settings")}>
          <Gear size={19} />
        </button>
      </header>

      <main className="scroll">
            {tab === "deals" && !listing && (
              <>
                <div className="feedhead">
                  <h1>Worth driving for</h1>
                  <p>Only listings the engine actually verified. Newest and best first.</p>
                </div>
                {settings.askOutcomes && ask && (
                  <OutcomePrompt h={ask} onDone={() => setAsk(null)} />
                )}
                <Feed onOpen={(id) => { setTab("check"); go(`/c/${id}`); }}
                  onWatchChange={setSavedCount} />
              </>
            )}

            {(tab === "check" || (tab === "deals" && listing)) && (
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
                {fresh && !error && (
                  <div className="checkhead">
                    <h1>Check a listing</h1>
                    <p>Paste a link and get a real number before you drive.</p>
                  </div>
                )}

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
                  </>
                )}

                {error && <div className="alert" role="alert">{error}</div>}

                {/**
                  * Sources are stated UP FRONT rather than as an error.
                  *
                  * Pasting an OfferUp link used to look like the app was broken.
                  * `badUrl` accepts Craigslist only, so the screen says so before
                  * you spend a paste on it — and the greyed chips are also the
                  * roadmap, which is honest about what is coming.
                  */}
                {fresh && !error && (
                  <div className="srcs">
                    <span className="lbl">Works with</span>
                    <span className="chip on">Craigslist</span>
                    <span className="chip">Facebook<i>soon</i></span>
                    <span className="chip">OfferUp<i>soon</i></span>
                    <span className="chip">Mercari<i>soon</i></span>
                  </div>
                )}

                {fresh && !error && (
                  <div className="pitch">
                    <div className="row">
                      <span className="ic"><Tag /></span>
                      <div><b>What it's actually worth</b><span>Real sold prices, minus fees and shipping, against your own profit floor.</span></div>
                    </div>
                    <div className="row">
                      <span className="ic"><Shield /></span>
                      <div><b>What's wrong with it</b><span>Locked phones, mining cards, stolen photos, impossible specs, listings that died months ago.</span></div>
                    </div>
                    <div className="row">
                      <span className="ic"><Eye /></span>
                      <div><b>When we don't know</b><span>A confident wrong answer is worse than none, so we say so.</span></div>
                    </div>
                  </div>
                )}

                <Report listing={listing} verdict={verdict} signals={signals}
                  meta={meta} stage={stage} reading={reading} checkId={checkId} />

                {ms != null && <div className="timing num">verdict in {ms}ms</div>}

                {checkId && (
                  <div className="actions">
                    <button className="btn2" onClick={() => navigator.clipboard.writeText(`${location.origin}/c/${checkId}`)}>
                      <Link /> Share
                    </button>
                    <button className="btn2" onClick={() => { reset(); setUrl(""); go("/"); }}>
                      <Again /> New check
                    </button>
                  </div>
                )}
              </>
            )}

            {tab === "saved" && !listing && (
              <Watchlist onOpen={(id) => { setTab("check"); go(`/c/${id}`); }}
                onWatchChange={setSavedCount} />
            )}

            {tab === "you" && <You hist={hist} onOpen={(id) => { setTab("check"); go(`/c/${id}`); }} />}

            {tab === "settings" && (
              <SettingsScreen s={settings} save={saveSettings}
                savedCount={savedCount}
                onClearSaved={() => { writeWatch([]); setSavedCount(0); }} />
            )}
          </main>

          <Tabbar tab={tab} go={goTab} savedCount={savedCount} />
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
function Billing() {
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

      <Billing />

      <div className="sgroup">
        <div className="shead"><Tag size={14} /> Your numbers</div>
        <div className="scard">
          <label className="srow static">
            <span className="stext">
              <b>Willing to drive</b>
              <span>Longer drives need a bigger margin to be worth it.</span>
            </span>
            <span className="stepper">
              <button aria-label="Less driving time"
                onClick={() => save({ driveMinutes: Math.max(5, s.driveMinutes - 5) })}>−</button>
              <span className="num">{s.driveMinutes}m</span>
              <button aria-label="More driving time"
                onClick={() => save({ driveMinutes: Math.min(90, s.driveMinutes + 5) })}>+</button>
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
            hint="Turns off the card-to-hero animation."
            on={s.reduceMotion} onChange={(v) => save({ reduceMotion: v })} />
        </div>
      </div>

      <Alerts />

      <div className="sgroup">
        <div className="shead"><Save size={14} /> Data</div>
        <div className="scard">
          <div className="srow static">
            <span className="stext">
              <b>{savedCount} saved {savedCount === 1 ? "listing" : "listings"}</b>
              <span>Stored on this device. Signing in is coming.</span>
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
      <p className="soon">Editing these is coming.</p>

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

