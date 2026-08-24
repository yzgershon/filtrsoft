import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------- types
type Call = "BUY" | "FAIR" | "PASS" | "VERIFY" | "RISK" | "INSUFFICIENT_DATA" | "OUT_OF_SCOPE";

interface Channel {
  channel: string; grossCents: number; feesCents: number;
  shippingCents: number; netCents: number; available: boolean; note?: string;
}
interface Verdict {
  call: Call; confidence: string; headline: string; reasoning: string;
  decidingUnknown?: string; targetOfferCents?: number;
  netProfitCents?: number; requiredProfitCents?: number;
  bestChannel?: Channel; questions: string[];
  valuation: { medianCents: number | null; lowCents: number | null; highCents: number | null; compCount: number; confidence: string };
}
interface Signal { code: string; severity: string; polarity: string; evidence: string }
interface Listing {
  title: string; url: string; askingPriceCents: number | null;
  location: string | null; postedAt: string | null; source: string; photoUrls: string[];
}

const money = (c?: number | null) =>
  c == null ? "—" : `$${Math.round(c / 100).toLocaleString()}`;

const daysAgo = (iso: string | null) => {
  if (!iso) return null;
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`;
};

// --------------------------------------------------------------- router
function useRoute() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  const go = useCallback((p: string) => {
    history.pushState({}, "", p);
    setPath(p);
  }, []);
  return { path, go };
}

// ------------------------------------------------------------ components
function Flags({ signals }: { signals: Signal[] }) {
  if (!signals.length) return null;
  const mark = (s: Signal) =>
    s.severity === "blocker" ? "!!" : s.severity === "high" ? "!" :
    s.severity === "medium" ? "~" : s.polarity === "positive" ? "+" : "·";
  return (
    <div className="sec">
      <h4>What's flagged <span>({signals.length})</span></h4>
      <div className="card">
        {signals.map((s, i) => (
          <div className={`flag s-${s.severity}`} key={i}>
            <div className="mark">{mark(s)}</div>
            <div className="body">
              <b>{s.code.replace(/_/g, " ")}</b>
              {s.evidence}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Money({ v }: { v: Verdict }) {
  const val = v.valuation;
  if (val.medianCents == null) return null;
  const ch = v.bestChannel;
  return (
    <div className="sec">
      <h4>The numbers</h4>
      <div className="card money">
        <div className="k">Market value</div>
        <div className="v">
          {money(val.lowCents)}–{money(val.highCents)}
          <span style={{ color: "var(--dimmer)", fontSize: 12.5 }}>
            {" "}· {val.compCount} comps · {val.confidence}
          </span>
        </div>

        {ch && (
          <>
            <div className="rule" />
            <div className="k">Best channel</div>
            <div className="v best">{ch.channel}</div>
            <div className="k" style={{ paddingLeft: 12 }}>gross</div>
            <div className="v">{money(ch.grossCents)}</div>
            {ch.feesCents > 0 && (<><div className="k" style={{ paddingLeft: 12 }}>fees</div><div className="v">−{money(ch.feesCents)}</div></>)}
            {ch.shippingCents > 0 && (<><div className="k" style={{ paddingLeft: 12 }}>shipping</div><div className="v">−{money(ch.shippingCents)}</div></>)}
          </>
        )}

        <div className="rule" />
        <div className="k">Your net if you buy at asking</div>
        <div className="v" style={{ color: (v.netProfitCents ?? 0) > 0 ? "var(--buy)" : "var(--risk)" }}>
          {money(v.netProfitCents)}
        </div>
        <div className="k">Your floor for this trip</div>
        <div className="v">{money(v.requiredProfitCents)}</div>

        {v.targetOfferCents ? (
          <>
            <div className="rule" />
            <div className="k">Offer this or less</div>
            <div className="v best">{money(v.targetOfferCents)}</div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Questions({ qs }: { qs: string[] }) {
  const [done, setDone] = useState<number | null>(null);
  if (!qs?.length) return null;
  return (
    <div className="sec">
      <h4>Ask the seller</h4>
      <div className="card">
        <ul className="ask-list">
          {qs.map((q, i) => (
            <li key={i}>
              <button
                className="copy"
                onClick={() => {
                  navigator.clipboard.writeText(q);
                  setDone(i);
                  setTimeout(() => setDone(null), 1400);
                }}
              >
                {done === i ? "copied" : "copy"}
              </button>
              <span>{q}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function VerdictView({
  listing, verdict, signals, stages,
}: {
  listing: Listing | null; verdict: Verdict | null;
  signals: Signal[]; stages?: string;
}) {
  if (!listing) return null;
  return (
    <>
      {listing.photoUrls?.length > 0 && (
        <div className="shots">
          {listing.photoUrls.slice(0, 10).map((u, i) => (
            <img key={i} src={u} alt="" loading="lazy" />
          ))}
        </div>
      )}

      <div className="lhead">
        <h2>{listing.title}</h2>
        <div className="ask">{money(listing.askingPriceCents)}</div>
      </div>
      <div className="sub">
        {[listing.location, daysAgo(listing.postedAt), listing.source]
          .filter(Boolean).join(" · ")}
        {" · "}
        <a href={listing.url} target="_blank" rel="noopener noreferrer">view original ↗</a>
      </div>

      {verdict ? (
        <div className={`call c-${verdict.call}`}>
          <span className={`badge b-${verdict.call}`}>{verdict.call.replace(/_/g, " ")}</span>
          <h3>{verdict.headline}</h3>
          <p>{verdict.reasoning}</p>
          {verdict.decidingUnknown && (
            <p style={{ marginTop: 10, color: "var(--dimmer)", fontSize: 13.5 }}>
              What settles it: {verdict.decidingUnknown}
            </p>
          )}
        </div>
      ) : (
        <div className="call c-INSUFFICIENT_DATA">
          <div className="skel" style={{ height: 14, width: 90, marginBottom: 11 }} />
          <div className="skel" style={{ height: 19, width: "62%", marginBottom: 9 }} />
          <div className="skel" style={{ height: 14, width: "85%" }} />
        </div>
      )}

      {verdict && <Money v={verdict} />}
      <Flags signals={signals} />
      {verdict && <Questions qs={verdict.questions} />}

      {stages && <div className="stages">{stages}</div>}
    </>
  );
}

// ------------------------------------------------------------------ app
export default function App() {
  const { path, go } = useRoute();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [stages, setStages] = useState<string>("");
  const [checkId, setCheckId] = useState<number | null>(null);
  const es = useRef<EventSource | null>(null);

  // Permalink: /c/:id
  useEffect(() => {
    const m = path.match(/^\/c\/(\d+)$/);
    if (!m) return;
    setBusy(true);
    fetch(`/v1/checks/${m[1]}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setListing(d.listing);
        setVerdict(d.verdict);
        setCheckId(d.checkId);
      })
      .finally(() => setBusy(false));
  }, [path]);

  const reset = () => {
    es.current?.close();
    setError(null); setListing(null); setVerdict(null);
    setSignals([]); setStages(""); setCheckId(null);
  };

  function run(e?: React.FormEvent) {
    e?.preventDefault();
    const u = url.trim();
    if (!u || busy) return;
    reset();
    setBusy(true);

    const src = new EventSource(`/v1/checks/stream?url=${encodeURIComponent(u)}`);
    es.current = src;
    const t: string[] = [];

    src.addEventListener("fetched", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data);
      setListing({ ...d, url: u, source: "craigslist" });
      t.push(`fetched ${d.elapsedMs}ms`); setStages(t.join(" · "));
    });
    src.addEventListener("signals", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data);
      setSignals(d.signals ?? []);
      t.push(`signals ${d.elapsedMs}ms`); setStages(t.join(" · "));
    });
    src.addEventListener("valued", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data);
      setVerdict(d.verdict);
      t.push(`valued ${d.elapsedMs}ms`); setStages(t.join(" · "));
    });
    src.addEventListener("done", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data);
      if (d.listingId) { setCheckId(d.listingId); history.replaceState({}, "", `/c/${d.listingId}`); }
      setBusy(false); src.close();
    });
    src.addEventListener("error", (ev) => {
      const raw = (ev as MessageEvent).data;
      setError(raw ? (JSON.parse(raw).error ?? "Something broke.") : "Couldn't reach the server.");
      setBusy(false); src.close();
    });
  }

  const onHome = !listing && !busy && !error;

  return (
    <div className="wrap">
      <div className="masthead">
        <a
          className="logo" href="/"
          onClick={(e) => { e.preventDefault(); reset(); setUrl(""); go("/"); }}
        >
          ass<b>yze</b>
        </a>
        <span className="tag">what it's really worth, before you drive</span>
      </div>

      {onHome && (
        <div className="hero">
          <h1>Know what a used tech listing is really worth.</h1>
          <p>
            Paste a listing. Assyze reads the photos and the fine print, tells you what
            it's actually worth, what's wrong with it, and exactly what to ask the seller.
            If it can't tell, it says so.
          </p>
        </div>
      )}

      <form className="inputrow" onSubmit={run}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a Craigslist listing URL"
          autoFocus
          spellCheck={false}
        />
        <button className="go" disabled={busy || !url.trim()}>
          {busy ? "checking…" : "Check it"}
        </button>
      </form>

      {onHome && (
        <div className="hint">
          Craigslist for now. Facebook Marketplace, OfferUp and Mercari next.
        </div>
      )}
      {error && <div className="err">{error}</div>}

      <VerdictView listing={listing} verdict={verdict} signals={signals} stages={stages} />

      {checkId && (
        <div className="share">
          <button
            onClick={() => navigator.clipboard.writeText(`${location.origin}/c/${checkId}`)}
          >
            Copy link to this verdict
          </button>
          <button onClick={() => { reset(); setUrl(""); go("/"); }}>Check another</button>
        </div>
      )}

      {onHome && (
        <div className="foot">
          <p>
            <b>Every competitor always gives you a number.</b> Assyze will tell you when it
            doesn't know — a confident wrong answer is worse than no answer when you're
            about to drive 45 minutes with cash.
          </p>
          <p>Every price shows the sold listings behind it. Check the work.</p>
        </div>
      )}
    </div>
  );
}
