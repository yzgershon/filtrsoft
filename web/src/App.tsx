import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Scan, Clock, User, Alert, Check, Info, Link, Again, Eye, Shield, Tag, Ghost } from "./icons.tsx";

// ---------------------------------------------------------------- types
type Call = "BUY" | "FAIR" | "PASS" | "VERIFY" | "RISK" | "INSUFFICIENT_DATA" | "OUT_OF_SCOPE";
interface Channel { channel: string; grossCents: number; feesCents: number; shippingCents: number; netCents: number }
/** A category hard-blocker and whether the listing resolved it. */
interface RiskCheck { code: string; label: string; state: string; question: string; evidence?: string }
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
  bestChannel?: Channel; questions: string[];
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

function Feed({ onOpen }: { onOpen: (id: number) => void }) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [filter, setFilter] = useState<"ALL" | "DEAL" | "CHEAP">("ALL");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Which listing currently occupies the hero slot. */
  const [heroId, setHeroId] = useState<number | null>(null);

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
  const hero = shown.find((i) => i.id === heroId) ?? shown[0] ?? null;
  const rest = shown.filter((i) => i.id !== hero?.id);

  /**
   * PROMOTE a row into the hero slot.
   *
   * The photo and title carry a `view-transition-name`, so the browser morphs
   * the SAME element between its row position and the hero position instead of
   * cross-fading two different ones. That is the difference between reading as
   * "this thing moved" and "the screen changed".
   *
   * `flushSync` is required: `startViewTransition` snapshots the DOM the moment
   * its callback returns, and React would otherwise still be batching the state
   * update — so the browser would capture the OLD layout twice and animate
   * nothing.
   *
   * Degrades to a plain state change where the API is missing, and skips the
   * animation entirely under prefers-reduced-motion. The content is identical
   * either way; only the motion is conditional.
   */
  const promote = (id: number, el: HTMLElement) => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startVT = (document as unknown as {
      startViewTransition?: (cb: () => void) => { finished: Promise<void> };
    }).startViewTransition;
    if (!startVT || reduce) { setHeroId(id); return; }

    /**
     * CLEAR THE CURRENT HERO'S NAMES FIRST.
     *
     * A `view-transition-name` must be unique within a single snapshot. The
     * hero carries `hero-img` from its JSX, so tagging the row as well put two
     * elements with the same name in the OLD snapshot — the browser rejected
     * it with "Unexpected duplicate view-transition-name" and aborted the whole
     * transition, leaving a hard cut.
     *
     * Only the row needs the name going out; the incoming hero gets it back
     * from its own JSX on the re-render, which is the NEW snapshot.
     */
    document.querySelectorAll<HTMLElement>(".hshot img, .hover b")
      .forEach((n) => { n.style.viewTransitionName = ""; });

    const img = el.querySelector("img") as HTMLElement | null;
    const title = el.querySelector("b") as HTMLElement | null;
    if (img) img.style.viewTransitionName = "hero-img";
    if (title) title.style.viewTransitionName = "hero-title";

    const t = startVT.call(document, () => { flushSync(() => setHeroId(id)); });
    t.finished.finally(() => {
      if (img) img.style.viewTransitionName = "";
      if (title) title.style.viewTransitionName = "";
    });
  };

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
                label="Best right now" note="tap any listing to swap it in" />
              <button className={`fhero v-${hero.call}`} onClick={() => onOpen(hero.id)}>
                <span className="hshot">
                  {hero.thumb
                    ? <img src={hero.thumb} alt="" style={{ viewTransitionName: "hero-img" }} />
                    : <span className="noimg"><Ghost size={28} /></span>}
                  <span className="hover">
                    <span className={`dcall b-${hero.call}`}>{LABEL[hero.call]}</span>
                    <b style={{ viewTransitionName: "hero-title" }}>{hero.title}</b>
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
                <div className="feed">
                  {list.map((i) => (
                    <button className="deal" key={i.id}
                      aria-label={`Show ${i.title} at the top`}
                      onClick={(e) => promote(i.id, e.currentTarget)}>
                      {i.thumb
                        ? <img src={i.thumb} alt="" loading="lazy" width={78} height={78} />
                        : <span className="noimg"><Ghost size={20} /></span>}
                      <span className="dbody">
                        <span className={`dcall b-${i.call}`}>{LABEL[i.call]}</span>
                        <b>{i.title}</b>
                        <span className="dmeta">
                          <span className="dloc">{[i.location, ago(i.postedAt)].filter(Boolean).join(" · ")}</span>
                        </span>
                      </span>
                      <span className="dend">
                        <span className="num dprice">{money(i.askingPriceCents)}</span>
                        {i.netProfitCents && i.netProfitCents > 0
                          ? <span className="num dnet">+{money(i.netProfitCents)}</span>
                          : <span className="num dnet z">—</span>}
                      </span>
                    </button>
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

function Numbers({ v }: { v: Verdict }) {
  const val = v.valuation;
  if (val.medianCents == null) return null;
  const ch = v.bestChannel;
  const net = v.netProfitCents ?? 0;
  return (
    <section className="sec rise">
      <h4>The numbers</h4>
      <div className="panel">
        <div className="kv">
          <div className="k">Market value<small>{val.compCount} sold comps · {val.confidence} confidence</small></div>
          <div className="v num">{money(val.lowCents)}–{money(val.highCents)}</div>
        </div>
        {ch && (
          <>
            <div className="kv">
              <div className="k">Best place to resell</div>
              <div className="v" style={{ textTransform: "capitalize" }}>{ch.channel}</div>
            </div>
            <div className="kv sub"><div className="k">gross</div><div className="v num">{money(ch.grossCents)}</div></div>
            {ch.feesCents > 0 && <div className="kv sub"><div className="k">fees</div><div className="v num">−{money(ch.feesCents)}</div></div>}
            {ch.shippingCents > 0 && <div className="kv sub"><div className="k">shipping</div><div className="v num">−{money(ch.shippingCents)}</div></div>}
          </>
        )}
        <div className="kv">
          <div className="k">Your profit at asking price</div>
          <div className={`v num ${net > 0 ? "pos" : "neg"}`}>{net > 0 ? "+" : ""}{money(net)}</div>
        </div>
        <div className="kv">
          <div className="k">You need at least<small>for the drive and the effort</small></div>
          <div className="v num">{money(v.requiredProfitCents)}</div>
        </div>
        {v.targetOfferCents ? (
          <div className="kv hi">
            <div className="k">Offer this or less</div>
            <div className="v num">{money(v.targetOfferCents)}</div>
          </div>
        ) : null}
      </div>
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
    <div className="gal">
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
  const order = { failed: 0, unresolved: 1, inPerson: 2, cleared: 3 } as Record<string, number>;
  const sorted = [...checks].sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9));
  const open = sorted.filter((c) => c.state === "failed" || c.state === "unresolved").length;

  return (
    <section className="sec rise">
      <h4>Hard blockers {open > 0 ? <em>({open} unresolved)</em> : <em>(all clear)</em>}</h4>
      <ul className="risks">
        {sorted.map((c) => (
          <li key={c.code} className={`risk r-${c.state}`}>
            <span className="rstate">{
              c.state === "cleared" ? "clear"
                : c.state === "inPerson" ? "in person"
                : c.state === "failed" ? "disclosed" : "unknown"
            }</span>
            <div>
              <b>{c.label}</b>
              {c.state !== "cleared" && <p>{c.question}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
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
        <div className={`verdict v-${verdict.call} rise`} role="status" aria-live="polite">
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

      {verdict && <Numbers v={verdict} />}
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
export default function App() {
  const { path, go } = useRoute();
  const [tab, setTab] = useState<"deals" | "check" | "you">("deals");
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
  const es = useRef<EventSource | null>(null);

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
    const u = url.trim();
    if (!u || busy) return;
    reset(); setBusy(true); setTab("check");

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
    <div className="stage">
      <div className="phone">
        <div className="app">
          <header className="topbar">
            <div className="brand">ass<span>yze</span></div>
            <div className="spacer" />
            {checkId && (
              <button className="iconbtn" aria-label="Copy link to this verdict"
                onClick={() => navigator.clipboard.writeText(`${location.origin}/c/${checkId}`)}>
                <Link size={18} />
              </button>
            )}
            {listing && (
              <button className="iconbtn" aria-label="Check another listing"
                onClick={() => { reset(); setUrl(""); go("/"); }}>
                <Again size={18} />
              </button>
            )}
          </header>

          <main className="scroll">
            {tab === "deals" && !listing && (
              <>
                <div className="feedhead">
                  <h1>Worth driving for</h1>
                  <p>Only listings the engine actually verified. Newest and best first.</p>
                </div>
                <Feed onOpen={(id) => { setTab("check"); go(`/c/${id}`); }} />
              </>
            )}

            {(tab === "check" || (tab === "deals" && listing)) && (
              <>
                {fresh && !error && (
                  <div className="hero">
                    <h1>Know what it's<br />really worth <span className="under">before you drive.</span></h1>
                    <p>Paste a listing. We read the photos and the fine print, then tell you straight.</p>
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
                  <form className="field" onSubmit={run}>
                    <input
                      value={url} onChange={(e) => setUrl(e.target.value)}
                      placeholder="Paste a listing link" inputMode="url"
                      autoCapitalize="off" autoCorrect="off" spellCheck={false}
                      aria-label="Listing URL"
                    />
                    <button className="cta" disabled={busy || !url.trim()}>
                      {busy ? "…" : "Check"}
                    </button>
                  </form>
                )}

                {fresh && !error && <div className="micro">Craigslist for now. Facebook Marketplace next.</div>}
                {error && <div className="alert" role="alert">{error}</div>}

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
                      <div><b>When we don't know</b><span>Everyone else always gives you a number. A confident wrong answer is worse than none.</span></div>
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

            {tab === "you" && (
              <section className="sec">
                <h4>Your numbers</h4>
                <div className="panel">
                  <div className="kv"><div className="k">Won't leave home for less than</div><div className="v num">$100</div></div>
                  <div className="kv"><div className="k">Your time is worth</div><div className="v num">$125/hr</div></div>
                  <div className="kv"><div className="k">Based in</div><div className="v">Newton, MA</div></div>
                  <div className="kv"><div className="k">Prefer to resell on</div><div className="v">Facebook</div></div>
                </div>
                <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 12, lineHeight: 1.5 }}>
                  Every verdict is calculated against these. The same listing is a buy for one
                  person and a pass for another — editing these is coming.
                </p>
              </section>
            )}
          </main>

          <nav className="tabs">
            <button className="tab" aria-current={tab === "deals" ? "page" : undefined}
              onClick={() => { setTab("deals"); reset(); go("/"); }}>
              <Tag size={21} /> Deals
            </button>
            <button className="tab" aria-current={tab === "check" ? "page" : undefined} onClick={() => setTab("check")}>
              <Scan size={21} /> Check
            </button>
            <button className="tab" aria-current={tab === "you" ? "page" : undefined} onClick={() => setTab("you")}>
              <User size={21} /> You
            </button>
          </nav>
        </div>
      </div>
      <div className="deskhint">Shown at iPhone 16 size. Open on a phone for the real thing.</div>
    </div>
  );
}
