import { useCallback, useEffect, useRef, useState } from "react";
import { Scan, Clock, User, Alert, Check, Info, Link, Again, Eye, Shield, Tag, Ghost } from "./icons.tsx";

// ---------------------------------------------------------------- types
type Call = "BUY" | "FAIR" | "PASS" | "VERIFY" | "RISK" | "INSUFFICIENT_DATA" | "OUT_OF_SCOPE";
interface Channel { channel: string; grossCents: number; feesCents: number; shippingCents: number; netCents: number }
interface Verdict {
  call: Call; confidence: string; headline: string; reasoning: string;
  decidingUnknown?: string; targetOfferCents?: number;
  netProfitCents?: number; requiredProfitCents?: number;
  bestChannel?: Channel; questions: string[];
  valuation: { medianCents: number | null; lowCents: number | null; highCents: number | null; compCount: number; confidence: string };
}
interface Signal { code: string; severity: string; polarity: string; evidence: string }
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

function Feed({ onOpen }: { onOpen: (id: number) => void }) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [filter, setFilter] = useState<Call | "ALL">("ALL");
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/v1/feed?limit=60").then((r) => r.json()).then((d) => {
      setItems(d.items ?? []); setCounts(d.counts ?? {});
    }).catch(() => setItems([]));
  }, []);

  if (!items) return (
    <div className="sec">
      {[0,1,2,3].map((i) => <div className="skel" key={i} style={{ height: 84, marginBottom: 10 }} />)}
    </div>
  );

  const shown = filter === "ALL" ? items : items.filter((i) => i.call === filter);
  const chips: Array<Call | "ALL"> = ["ALL", "BUY", "VERIFY", "FAIR"];

  return (
    <>
      <div className="chips">
        {chips.map((c) => (
          <button key={c} className={`chip ${filter === c ? "on" : ""}`} onClick={() => setFilter(c)}>
            {c === "ALL" ? "Everything" : LABEL[c]}
            {c !== "ALL" && counts[c] ? <em>{counts[c]}</em> : null}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <Ghost />
          <b>Nothing here yet</b>
          <span>Deals show up once the engine has priced enough listings.</span>
        </div>
      ) : (
        <div className="feed">
          {shown.map((i) => (
            <button className="deal" key={i.id} onClick={() => onOpen(i.id)}>
              {i.thumb
                ? <img src={i.thumb} alt="" loading="lazy" width={78} height={78} />
                : <span className="noimg"><Ghost size={20} /></span>}
              <span className="dbody">
                <span className={`dcall b-${i.call}`}>{LABEL[i.call]}</span>
                <b>{i.title}</b>
                <span className="dmeta">
                  <span className="num dprice">{money(i.askingPriceCents)}</span>
                  {i.netProfitCents ? <span className="num dnet">+{money(i.netProfitCents)} net</span> : null}
                  <span className="dloc">{[i.location, ago(i.postedAt)].filter(Boolean).join(" · ")}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
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
  return (
    <section className="sec rise">
      <h4>Ask the seller <em>(before you drive)</em></h4>
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

function Report({ listing, verdict, signals, stage, reading }: {
  listing: Listing | null; verdict: Verdict | null; signals: Signal[]; stage: number; reading: number;
}) {
  if (!listing) return null;
  return (
    <>
      {listing.photoUrls?.length > 0 && (
        <div className="shots">
          {listing.photoUrls.slice(0, 12).map((u, i) => <img key={i} src={u} alt="" loading="lazy" width={120} height={90} />)}
        </div>
      )}

      <div className="lh rise">
        <h2>{listing.title}</h2>
        <div className="meta">
          <span className="price num">{money(listing.askingPriceCents)}</span>
          <span className="facts">
            {[listing.location, ago(listing.postedAt)].filter(Boolean).join(" · ")}
          </span>
        </div>
        <div style={{ marginTop: 8 }}>
          <a href={listing.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5 }}>
            view original listing ↗
          </a>
        </div>
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
      <Flags signals={signals} />
      {verdict && <Questions qs={verdict.questions} />}
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
      setListing(d.listing); setVerdict(d.verdict); setCheckId(d.checkId); setStage(3);
    }).finally(() => setBusy(false));
  }, [path]);

  const reset = () => {
    es.current?.close();
    setError(null); setListing(null); setVerdict(null);
    setSignals([]); setStage(0); setMs(null); setCheckId(null); setReading(0);
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

                <Report listing={listing} verdict={verdict} signals={signals} stage={stage} reading={reading} />

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
