/** Public introduction and authentication. Archive counts come from the API;
 * the hardware illustration is explicitly illustrative and carries no invented
 * listing price, availability, earnings, or completed-sale claim. */
import { useEffect, useRef, useState } from "react";
import {
  Alert, Bell, Check, Cross, Grid, Scan, Shield, Star, Tag, User,
} from "./icons.tsx";
import { deviceRef, toast } from "./lib.tsx";
import { BrandMark, Wordmark } from "./brand.tsx";

// ─────────────────────────────────────────────────────────────────── types

export interface Providers {
  password: boolean;
  google: boolean; googleClientId: string | null;
  apple: boolean; appleClientId: string | null;
}
export interface Account {
  id: number; email: string; name: string | null;
  avatarUrl: string | null; createdAt: string;
}

// ────────────────────────────────────────────────────────────────── landing

export function Landing({ onStart, onSignIn }: {
  onStart: () => void; onSignIn: () => void;
}) {
  const [stats, setStats] = useState<{ comps?: number; skus?: number; listings?: number } | null>(null);

  useEffect(() => {
    /**
     * `/v1/landing` is public and returns counts only, never listings — the
     * whole point of the change is that the deals themselves are behind the
     * wall. If it fails, the copy degrades to the version with no numbers in
     * it rather than showing zeros, which would read as a dead product.
     */
    fetch("/v1/landing").then((r) => r.json()).then(setStats).catch(() => {});
  }, []);

  const n = (v?: number) => (typeof v === "number" && v > 0 ? v.toLocaleString() : null);

  return (
    <div className="mk redesign-landing">
      <header className="mknav">
        <span className="mkbrand"><BrandMark size={27} className="mark" /><Wordmark /></span>
        <a className="landing-how-link" href="#how-it-works">How it works</a>
        <div className="mknavr"><button className="mklink" onClick={onSignIn}>Sign in</button><button className="mkcta sm" onClick={onStart}>Get started <span aria-hidden="true">↗</span></button></div>
      </header>
      <main>
        <section className="landing-intro">
          <div className="landing-message">
            <span className="landing-kicker"><i /> BUILT FOR THE BOSTON TECH HUNT</span>
            <h1>A good price.<br />Or a good<br /><span>story?</span></h1>
            <p>Know the difference before you drive. Filtrsoft checks used tech against real sold prices and looks for the risks hiding behind the deal.</p>
            <button className="mkcta" onClick={onStart}>Find your next flip <span aria-hidden="true">↗</span></button>
            <small>Free to get started. Your final call, always.</small>
          </div>
          <div className="landing-evidence" aria-label="Illustration of how Filtrsoft reviews a listing">
            <div className="evidence-caption"><span>THE LISTING, LOOKED AT CLOSER</span><span>EXAMPLE</span></div>
            <div className="hardware-drawing" aria-hidden="true">
              <svg viewBox="0 0 520 300" fill="none"><defs><linearGradient id="cardMetal" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#727f90"/><stop offset=".5" stopColor="#293442"/><stop offset="1" stopColor="#48586e"/></linearGradient></defs>
                <g transform="translate(78 60) rotate(-12 180 100)"><rect x="0" y="6" width="365" height="184" rx="17" fill="url(#cardMetal)" stroke="#abb9ce"/><rect x="12" y="18" width="340" height="157" rx="10" fill="#161e2a"/>
                  {[96,265].map(x=><g key={x} transform={`translate(${x} 96)`}><circle r="66" fill="#293443" stroke="#6b7d96"/>{Array.from({length:9},(_,i)=><path key={i} d="M5 -12 C16 -64 48 -54 44 -26 L16 4 Z" fill="#526177" transform={`rotate(${i*40})`}/>)}<circle r="21" fill="#1d2938" stroke="#7d91ab"/><circle r="8" fill="#90aeec"/></g>)}
                  <path d="M30 190H153V198H30" fill="#bc9f69"/><path d="M363 5H376V184H365" stroke="#a2adbe" strokeWidth="5"/>
                </g>
              </svg>
              <span className="hardware-tag">LOOK BEYOND THE ASKING PRICE</span>
            </div>
            <div className="evidence-sample">
              <span className="sample-verdict"><Shield size={15}/> VERIFY FIRST</span>
              <h2>The model matches.<br />The condition still matters.</h2>
              <div className="evidence-check"><Check size={16}/><span>Compare the exact model to completed sales</span></div>
              <div className="evidence-check"><Alert size={16}/><span>Check the unresolved risks before pickup</span></div>
              <div className="sample-foot">Illustrative review <span>Value · Condition · Risk</span></div>
            </div>
          </div>
        </section>
        <div className="landing-sources"><span>YOUR LOCAL MARKET, WITH CONTEXT</span><b>Craigslist</b><b>Facebook Marketplace</b><b>OfferUp</b><b>Mercari</b></div>
        <section className="landing-method" id="how-it-works">
          <div className="method-head"><span className="eyebrow">LESS GUESSWORK</span><h2>The asking price<br />is just the beginning.</h2><p>A cheap listing can be a great buy or an expensive mistake. See what supports the price, what remains unknown, and what to ask next.</p></div>
          <div className="method-grid">
            {[{n:"01", icon:<Tag size={22}/>, title:"Know the real value.",body:"Comparable completed sales for the matching hardware. If the evidence is too thin, Filtrsoft says it can't tell."},
              {n:"02",icon:<Shield size={22}/>,title:"Spot the catch.",body:"Activation locks, missing parts, conflicting specs and seller warning signs. The unresolved questions stay visible."},
              {n:"03",icon:<Grid size={22}/>,title:"Make your own call.",body:"See the estimated return after costs, inspect the evidence, and review the listing. Your judgment belongs in the workflow."}].map(x=><article key={x.n}><div>{x.icon}<span>{x.n}</span></div><h3>{x.title}</h3><p>{x.body}</p></article>)}
          </div>
        </section>
        {(n(stats?.comps) || n(stats?.listings)) && <section className="landing-data" aria-label="Current catalog counts"><div><span className="eyebrow">EVIDENCE, NOT HYPE</span><h2>Grounded in the market.</h2></div><div><b className="num">{n(stats?.comps) || "—"}</b><span>completed sales in the archive</span></div><div><b className="num">{n(stats?.listings) || "—"}</b><span>listings tracked</span></div></section>}
        <section className="landing-finish"><span className="eyebrow">YOUR NEXT FIND IS OUT THERE</span><h2>Go in informed.</h2><p>Start with a short list. Leave with a clearer picture.</p><button className="mkcta" onClick={onStart}>Open your workspace <span aria-hidden="true">↗</span></button></section>
      </main>
      <footer className="mkfoot"><span className="mkbrand"><BrandMark size={20} className="mark" /><Wordmark /></span><span>Greater Boston · Used tech, priced with evidence</span><button className="mklink" onClick={onSignIn}>Sign in ↗</button></footer>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────── auth UI

/**
 * Create account / sign in.
 *
 * ⚠ ONE COMPONENT FOR BOTH, because they are the same form with a different
 * verb and people arrive at the wrong one constantly. Switching modes keeps
 * whatever they have already typed — making someone retype their email because
 * they tapped the wrong link is how a signup gets abandoned.
 *
 * ⚠ THE PROVIDER BUTTONS RENDER ONLY WHEN THE SERVER SAYS THEY ARE
 * CONFIGURED. `authProviders()` reports which have a client id; a "Continue
 * with Apple" that 503s is worse than no button at all, because it reads as
 * the whole product being broken.
 */
export function AuthScreen({ mode, providers, onDone, onMode, onBack }: {
  mode: "signup" | "signin";
  providers: Providers | null;
  onDone: (u: Account) => void;
  onMode: (m: "signup" | "signin") => void;
  onBack: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const googleBox = useRef<HTMLDivElement>(null);

  const signup = mode === "signup";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/v1/auth/${signup ? "signup" : "signin"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        /**
         * ⚠ THE DEVICE REF TRAVELS WITH THE SIGN-IN. The server adopts it onto
         * the account, so the verdict overrides and the plan already attached
         * to this browser survive. Without it, signing in would silently strip
         * every listing he had relabelled himself.
         */
        body: JSON.stringify({ email, password, name: signup ? name : undefined, ref: deviceRef() }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? "Something went wrong.");
        // A 409 on signup means the account exists: offer the right form
        // rather than leaving them to work it out.
        if (d.signIn) onMode("signin");
        return;
      }
      onDone(d.user);
    } catch {
      setError("Couldn't reach Filtrsoft. Check your connection.");
    } finally { setBusy(false); }
  }

  /**
   * Google Identity Services renders its own button into a div.
   *
   * ⚠ THE SCRIPT IS LOADED ONLY WHEN GOOGLE IS ACTUALLY CONFIGURED. Loading
   * it unconditionally puts a third-party script on the page of a product
   * whose landing page promises there are none.
   */
  useEffect(() => {
    if (!providers?.google || !providers.googleClientId || !googleBox.current) return;
    let cancelled = false;

    const init = () => {
      const g = (window as any).google?.accounts?.id;
      if (!g || cancelled || !googleBox.current) return;
      g.initialize({
        client_id: providers.googleClientId,
        callback: async (resp: { credential: string }) => {
          setBusy(true); setError(null);
          try {
            const r = await fetch("/v1/auth/google", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ credential: resp.credential, ref: deviceRef() }),
            });
            const d = await r.json();
            if (!r.ok) { setError(d.error ?? "Google sign-in failed."); return; }
            onDone(d.user);
          } finally { setBusy(false); }
        },
      });
      g.renderButton(googleBox.current, {
        theme: "filled_black", size: "large", shape: "pill",
        text: signup ? "signup_with" : "signin_with", width: 300,
      });
    };

    const existing = document.getElementById("gsi-script");
    if (existing) { init(); return () => { cancelled = true; }; }
    const sc = document.createElement("script");
    sc.src = "https://accounts.google.com/gsi/client";
    sc.async = true; sc.defer = true; sc.id = "gsi-script";
    sc.onload = init;
    document.head.appendChild(sc);
    return () => { cancelled = true; };
  }, [providers?.google, providers?.googleClientId, signup]);

  return (
    <div className="auth">
      <button className="authback" onClick={onBack} aria-label="Back">
        <Cross size={16} />
      </button>

      <div className="authhd">
        <span className="mkbrand"><BrandMark size={21} className="mark" /><Wordmark /></span>
        <h1>{signup ? "Create your account" : "Welcome back"}</h1>
        <p>
          {signup
            ? "Free, no card. Your saved listings and your own verdict labels come with you."
            : "Sign in to pick up where you left off."}
        </p>
      </div>

      {/* ── providers ────────────────────────────────────────────────── */}
      {(providers?.google || providers?.apple) && (
        <>
          <div className="authprov">
            {providers?.google && <div className="gbtn" ref={googleBox} />}
            {providers?.apple && (
              <button className="applebtn" disabled={busy} onClick={() => {
                /**
                 * ⚠ APPLE'S SDK IS LOADED ON DEMAND for the same reason as
                 * Google's, and this button only renders when a Services ID is
                 * configured — which needs a paid Apple Developer membership.
                 */
                const w = window as any;
                const go = () => {
                  w.AppleID?.auth?.init({
                    clientId: providers.appleClientId,
                    scope: "name email",
                    redirectURI: `${location.origin}/`,
                    usePopup: true,
                  });
                  w.AppleID?.auth?.signIn?.().then(async (res: any) => {
                    const r = await fetch("/v1/auth/apple", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        id_token: res?.authorization?.id_token,
                        user: res?.user, ref: deviceRef(),
                      }),
                    });
                    const d = await r.json();
                    if (!r.ok) { setError(d.error ?? "Apple sign-in failed."); return; }
                    onDone(d.user);
                  }).catch(() => setError("Apple sign-in was cancelled."));
                };
                if (w.AppleID) return go();
                const sc = document.createElement("script");
                sc.src = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";
                sc.onload = go;
                document.head.appendChild(sc);
              }}>
                <AppleMark /> Continue with Apple
              </button>
            )}
          </div>
          <div className="authdiv"><span>or with email</span></div>
        </>
      )}

      {/* ── email + password ─────────────────────────────────────────── */}
      <form className="authform" onSubmit={submit}>
        {signup && (
          <label className="authfield">
            <span>Name <em>optional</em></span>
            <input value={name} onChange={(e) => setName(e.target.value)}
              autoComplete="name" placeholder="Yish" />
          </label>
        )}

        <label className="authfield">
          <span>Email</span>
          {/*
            * ⚠ `type="email"` AND `inputMode="email"` BOTH. The type gives the
            * browser its own validation and autofill; the inputMode is what
            * actually changes the on-screen keyboard on Android, which is the
            * device this is used on.
            */}
          <input type="email" inputMode="email" required
            value={email} onChange={(e) => setEmail(e.target.value)}
            autoComplete="email" autoCapitalize="off" autoCorrect="off"
            spellCheck={false} placeholder="you@example.com" />
        </label>

        <label className="authfield">
          <span>Password</span>
          <span className="authpw">
            <input type={show ? "text" : "password"} required
              value={password} onChange={(e) => setPassword(e.target.value)}
              /*
               * `new-password` on signup tells a password manager to OFFER to
               * generate one; `current-password` on sign-in tells it to fill.
               * Using one for both is why managers sometimes do neither.
               */
              autoComplete={signup ? "new-password" : "current-password"}
              minLength={signup ? 12 : undefined}
              placeholder={signup ? "at least 12 characters" : ""} />
            <button type="button" className="authshow" onClick={() => setShow((v) => !v)}
              aria-label={show ? "Hide password" : "Show password"}>
              {show ? "Hide" : "Show"}
            </button>
          </span>
          {signup && (
            <em className="authhint">
              Twelve characters or more. A short sentence beats a scrambled word.
            </em>
          )}
        </label>

        {error && <div className="autherr" role="alert"><Alert size={13} />{error}</div>}

        <button className="mkcta wide" type="submit" disabled={busy}>
          {busy ? "One moment…" : signup ? "Create account" : "Sign in"}
        </button>
      </form>

      <p className="authswap">
        {signup ? "Already have an account? " : "New to Filtrsoft? "}
        <button onClick={() => { setError(null); onMode(signup ? "signin" : "signup"); }}>
          {signup ? "Sign in" : "Create one"}
        </button>
      </p>

      {signup && (
        <p className="authlegal">
          Filtrsoft stores your email and what you save. It never asks for a
          marketplace login and never handles a card number.
        </p>
      )}
    </div>
  );
}

/** Apple's mark, drawn rather than imported so there is no asset to load. */
const AppleMark = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M16.4 12.8c0-2.5 2-3.7 2.1-3.8-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9s-2-.9-3.3-.9C6.2 7 4.7 8 3.9 9.5c-1.7 2.9-.4 7.2 1.2 9.6.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8s1.9.8 3.2.7c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.4-1-2.4-3.4zM14.2 5.3c.7-.8 1.1-2 1-3.3-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3.1 1.1.1 2.2-.6 2.9-1.3z" />
  </svg>
);
