/** Public introduction and authentication. Archive counts come from the API;
 * the hardware illustration is explicitly illustrative and carries no invented
 * listing price, availability, earnings, or completed-sale claim. */
import { useEffect, useRef, useState } from "react";
import {
  Alert, Bell, Check, Cross, Grid, Scan, Shield, Star, Tag, User,
} from "./icons.tsx";
import { deviceRef, toast } from "./lib.tsx";
import { BrandMark, Wordmark } from "./brand.tsx";
import { loadGoogleIdentity } from './google-identity.ts';
import {PASSWORD_MIN} from '../../src/account-sync.ts';

// ─────────────────────────────────────────────────────────────────── types

export interface Providers {
  registrationOpen?: boolean;
  password: boolean;
  google: boolean; googleClientId: string | null;
  apple: boolean; appleClientId: string | null;
}
export interface Account {
  id: number; email: string; name: string | null;
  avatarUrl: string | null; createdAt: string;
}

export function PrivateLanding({onSignIn}:{onSignIn:()=>void}) {
  return <main className="private-entry"><div className="private-entry-card">
    <div className="mkbrand"><BrandMark size={38}/><Wordmark/></div>
    <span className="private-entry-label"><Shield size={15}/> Private workspace</span>
    <h1>Your market.<br/>Your call.</h1>
    <p>Listings, evidence and the tools to follow a deal through.</p>
    <button className="btn" onClick={onSignIn}>Sign in <span aria-hidden="true">↗</span></button>
    <small>Access is limited to existing accounts.</small>
  </div></main>;
}

// ────────────────────────────────────────────────────────────────── landing

export {LandingPage as Landing} from './landing-page.tsx';

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
  const [googleState,setGoogleState]=useState<'loading'|'ready'|'error'>('loading');
  const [googleRetry,setGoogleRetry]=useState(0);
  const done=useRef(onDone);done.current=onDone;
  const submitting=useRef(false);

  const signup = mode === "signup" && providers?.registrationOpen !== false;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current=true;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/v1/auth/${signup ? "signup" : "signin"}`, {
        method: "POST",
        signal: AbortSignal.timeout(15000),
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
      setError("The sign-in request couldn't finish. Please try again.");
    } finally { submitting.current=false;setBusy(false); }
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
    const clientId=providers.googleClientId;
    let cancelled = false;

    setGoogleState('loading');
    loadGoogleIdentity().then(g=>{
      if (cancelled || !googleBox.current) return;
      g.initialize({
        client_id: clientId,
        callback: async (resp: { credential: string }) => {
          if(cancelled||submitting.current)return;
          submitting.current=true;
          setBusy(true); setError(null);
          try {
            const r = await fetch("/v1/auth/google", {
              method: "POST",
              signal: AbortSignal.timeout(15000),
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ credential: resp.credential, ref: deviceRef() }),
            });
            const d = await r.json();
            if (!r.ok) { setError(d.error ?? "Google sign-in failed."); return; }
            if(!cancelled)done.current(d.user);
          } catch {if(!cancelled)setError("Google sign-in couldn't finish. Please try again.");}
          finally {submitting.current=false;if(!cancelled)setBusy(false);}
        },
      });
      g.renderButton(googleBox.current, {
        theme: document.documentElement.dataset.theme==='light'?'outline':'filled_black', size: "large", shape: "pill",
        text: signup ? "signup_with" : "signin_with", width: Math.min(360,googleBox.current.clientWidth||300),
      });
      setGoogleState('ready');
    }).catch(()=>{if(!cancelled)setGoogleState('error');});
    return () => { cancelled = true; };
  }, [providers?.google, providers?.googleClientId, signup,googleRetry]);

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
            {providers?.google && <div className="google-provider" aria-busy={googleState==='loading'||busy}>
              <div className="gbtn" ref={googleBox} inert={busy}/>
              {googleState==='loading'&&<p role="status">Loading Google sign-in…</p>}
              {googleState==='error'&&<div role="alert"><p>Google sign-in couldn't load. You can still use email.</p><button type="button" className="btn sm" onClick={()=>setGoogleRetry(v=>v+1)}>Retry Google</button></div>}
            </div>}
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
              minLength={signup ? PASSWORD_MIN : undefined}
              placeholder={signup ? `at least ${PASSWORD_MIN} characters` : ""} />
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
        {providers?.registrationOpen === false ? 'Private workspace. Existing accounts only.' : signup ? "Already have an account? " : "New to Filtrsoft? "}
        {providers?.registrationOpen !== false && <>
        <button onClick={() => { setError(null); onMode(signup ? "signin" : "signup"); }}>
          {signup ? "Sign in" : "Create one"}
        </button>
        </>}
      </p>

      <p className="authlegal">Your account connects your reviews and workspace. <a href="/privacy">Privacy details</a>.</p>
    </div>
  );
}

/** Apple's mark, drawn rather than imported so there is no asset to load. */
const AppleMark = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M16.4 12.8c0-2.5 2-3.7 2.1-3.8-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9s-2-.9-3.3-.9C6.2 7 4.7 8 3.9 9.5c-1.7 2.9-.4 7.2 1.2 9.6.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8s1.9.8 3.2.7c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.4-1-2.4-3.4zM14.2 5.3c.7-.8 1.1-2 1-3.3-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3.1 1.1.1 2.2-.6 2.9-1.3z" />
  </svg>
);
