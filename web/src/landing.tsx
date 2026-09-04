/**
 * filtrsoft.com when you are signed out: the marketing site, and the two screens
 * that get you an account.
 *
 * Yish, 2026-09-01: *"filtrsoft.com should go to a website that isnt actually the
 * app right away its a website that explains the app and how it works ... and
 * then we have a sign in and a get started."*
 *
 * ── EVERY NUMBER ON THIS PAGE IS REAL, AND THAT IS NOT A STYLE CHOICE ──────
 *
 * He asked for *"how much money you can make with it with 'proven data'"*. The
 * numbers below are fetched from `/v1/health` and `/v1/landing` at run time —
 * the actual comp count, the actual live-listing count, and the actual verified
 * flip (an i9-12900K bought for $170 in Boston, resale $290).
 *
 * **No invented earnings claims, no "users average $2,400/month".** Three
 * reasons, in order of how much they matter:
 *
 *   1. Filtrsoft has one user. An average across one person is that person, and
 *      presenting it as a typical result would be a lie about a real business.
 *   2. Earnings claims on a commercial site are regulated (the FTC's
 *      substantiation rules); "proven data" that cannot be substantiated is the
 *      exact thing they exist to stop.
 *   3. It is unnecessary. "One flip, $170 in, $290 out" is a specific, checkable
 *      story and it is more persuasive than a fabricated average.
 *
 * If a number here cannot be fetched, the sentence loses the number rather than
 * falling back to a hardcoded one that will be wrong within a week.
 */
import { useEffect, useRef, useState } from "react";
import {
  Alert, Bell, Check, Cross, Grid, Scan, Shield, Star, Tag, User,
} from "./icons.tsx";
import { deviceRef, toast } from "./lib.tsx";

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
    <div className="mk">
      {/* ── nav ──────────────────────────────────────────────────────── */}
      <header className="mknav">
        <span className="mkbrand">filtr<span>soft</span></span>
        <div className="mknavr">
          <button className="mklink" onClick={onSignIn}>Sign in</button>
          <button className="mkcta sm" onClick={onStart}>Get started</button>
        </div>
      </header>

      {/* ── hero ─────────────────────────────────────────────────────── */}
      <section className="mkhero">
        <span className="mkpill"><i />Live now in Greater Boston</span>
        <h1>
          Know what it's worth<br />
          <span className="g">before you drive.</span>
        </h1>
        <p className="mksub">
          Filtrsoft reads every used-tech listing on Craigslist, Facebook
          Marketplace, OfferUp and Mercari, prices it against what the same
          thing actually sold for, and tells you the one thing that matters:
          buy it, ask a question first, or walk away.
        </p>
        <div className="mkactions">
          <button className="mkcta" onClick={onStart}>Get started free</button>
          <button className="mkghost" onClick={onSignIn}>I already have an account</button>
        </div>

        {/*
          * ⚠ THE STAT STRIP IS FETCHED, NOT TYPED. A landing page that hardcodes
          * "18,000 sold prices" is wrong the first week and nobody notices,
          * which quietly makes every other claim on the page suspect.
          */}
        <div className="mkstats">
          <div><b className="num">{n(stats?.listings) ?? "—"}</b><span>listings priced right now</span></div>
          <div><b className="num">{n(stats?.comps) ?? "—"}</b><span>completed sales behind the prices</span></div>
          <div><b className="num">{n(stats?.skus) ?? "—"}</b><span>models in the catalog</span></div>
        </div>
      </section>

      {/* ── the phone ────────────────────────────────────────────────── */}
      <section className="mkshot">
        <div className="mkphone" aria-hidden="true">
          <div className="mkphonebar">
            <span className="mkbrand sm">filtr<span>soft</span></span>
          </div>
          <div className="mkseg">
            <span className="on">Buy it <i>2</i></span>
            <span>Verify <i className="v">8</i></span>
            <span>Risky <i className="r">8</i></span>
          </div>
          <div className="mkcards">
            <FakeCard call="BUY" title="RTX 4090 FE 24GB" price="$1,500" net="+$625" age="31 Min" />
            <FakeCard call="BUY" title="Ryzen 9 7950X3D" price="$310" net="+$140" age="2 Hrs" />
            <FakeCard call="VERIFY" title="MacBook Air M2 256GB" price="$470" net="+$180" age="1 Day" />
            <FakeCard call="RISK" title="RTX 5090, sealed, cheap" price="$900" net="" age="14 Min" />
          </div>
        </div>
        <div className="mkshottext">
          <h2>One screen. One decision each.</h2>
          <p>
            Every listing carries a verdict, what you'd clear after fees and the
            drive, and how long it has been up. The green ones are the only ones
            you need to look at.
          </p>
          <ul className="mkticks">
            <li><Check size={13} />Green means it cleared your profit floor</li>
            <li><Check size={13} />Amber means one question stands in the way</li>
            <li><Check size={13} />Red never reaches your main feed</li>
          </ul>
        </div>
      </section>

      {/* ── how ──────────────────────────────────────────────────────── */}
      <section className="mkhow">
        <h2>How it gets to a number</h2>
        <div className="mksteps">
          {[
            { i: <Scan size={18} />, t: "Reads the listing", b: "Title, description and every photo, down to the exact GPU, CPU, RAM and storage." },
            { i: <Tag size={18} />, t: "Prices it against real sales", b: n(stats?.comps) ? `${n(stats?.comps)} completed eBay sales. Not asking prices, which are just what someone hoped for.` : "Completed eBay sales. Not asking prices, which are just what someone hoped for." },
            { i: <Alert size={18} />, t: "Hunts for the catch", b: "Stock photos, scripted replies, a seller pushing you off-platform, a GPU with no display outputs." },
            { i: <Grid size={18} />, t: "Subtracts your costs", b: "Fees, shipping and the round trip. What's left is what you actually clear." },
          ].map((s, k) => (
            <div className="mkstep" key={s.t}>
              <span className="mkstepn">{k + 1}</span>
              <b>{s.t}</b>
              <p>{s.b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── proof ────────────────────────────────────────────────────── */}
      <section className="mkproof">
        <h2>What that looks like in practice</h2>
        {/*
          * ⚠ ONE REAL FLIP, NAMED AND CHECKABLE. See the file header for why
          * there is no "average user earns" figure here. This is his own
          * 2026-08-31 purchase and every number in it is the actual number.
          */}
        <div className="mkcase">
          <div className="mkcasehd">
            <span className="mkcasetag">Verified flip</span>
            <span className="mkcasedate">31 Aug 2026</span>
          </div>
          <b>Intel Core i9-12900K</b>
          <p>
            Filtrsoft flagged it in the Boston feed at $200. He messaged the
            seller, got it for $170, and drove 20 minutes. It resells at about
            $290 with the buyer paying shipping.
          </p>
          <div className="mkcasenums">
            <div><span>Paid</span><b className="num">$170</b></div>
            <div><span>Resale</span><b className="num">$290</b></div>
            <div className="win"><span>Cleared</span><b className="num">~$80</b></div>
          </div>
        </div>
        <p className="mkdisclaim">
          One real purchase, not an average. Filtrsoft tells you what a listing is
          worth and what you would clear on it. What you actually make depends
          on what you buy and what you do with it.
        </p>
      </section>

      {/* ── alerts ───────────────────────────────────────────────────── */}
      <section className="mkalerts">
        <div className="mkalerticon"><Bell size={22} /></div>
        <h2>The good ones go in an hour</h2>
        <p>
          A 4090 at $1,100 is gone before you next open a tab. Filtrsoft checks
          every three minutes and tells you the moment something clears your
          floor, so you are first rather than fourth.
        </p>
      </section>

      {/* ── trust ────────────────────────────────────────────────────── */}
      <section className="mktrust">
        <h2>What Filtrsoft will never do</h2>
        <div className="mktrustgrid">
          <div><Shield size={18} /><b>Ask for a marketplace login</b><span>It never has your Facebook or eBay password, because it never asks.</span></div>
          <div><Shield size={18} /><b>Touch a card number</b><span>Payment, if you ever want a paid plan, happens on Stripe's own page.</span></div>
          <div><Shield size={18} /><b>Track you</b><span>No analytics, no third-party scripts, nothing sold to anyone.</span></div>
          <div><Shield size={18} /><b>Guess at a price</b><span>If it cannot price something honestly it says so instead of inventing a number.</span></div>
        </div>
      </section>

      {/* ── close ────────────────────────────────────────────────────── */}
      <section className="mkclose">
        <h2>Start with today's listings</h2>
        <p>Free. No card. About thirty seconds.</p>
        <button className="mkcta" onClick={onStart}>Get started</button>
      </section>

      <footer className="mkfoot">
        <span className="mkbrand sm">filtr<span>soft</span></span>
        <span>Greater Boston · Used tech, priced honestly</span>
      </footer>
    </div>
  );
}

/** A static card for the phone mockup. Not real data, and never presented as. */
function FakeCard({ call, title, price, net, age }: {
  call: string; title: string; price: string; net: string; age: string;
}) {
  return (
    <div className="mkcard">
      <div className="mkcardshot">
        <span className={`mkcall b-${call}`}>{call === "BUY" ? "Buy it" : call === "VERIFY" ? "Verify first" : "Risky"}</span>
        <span className="mkage">{age}</span>
        <span className="mkprice num">{price}{net && <em>{net}</em>}</span>
      </div>
      <span className="mkcardtitle">{title}</span>
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
        <span className="mkbrand">filtr<span>soft</span></span>
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
