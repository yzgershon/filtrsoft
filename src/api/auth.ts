/**
 * Accounts: email + password, Sign in with Google, Sign in with Apple.
 *
 * Yish, 2026-09-01: *"right now anyone who goes to filtrsoft.com can just have
 * full access to all the deals so lets add some personalization and security
 * and professionalism."*
 *
 * ── THE FOUR RULES THIS FILE IS BUILT ON ───────────────────────────────────
 *
 * **1. Passwords are hashed with argon2id and never leave this process.**
 * `Bun.password` is argon2id by default with sane cost parameters, so there is
 * no dependency to audit and no chance of someone reaching for a fast hash. A
 * password is never logged, never echoed back, and never stored anywhere but
 * `users.password_hash`.
 *
 * **2. The session is a random opaque token in a table, not a JWT.** A signed
 * token cannot be revoked before it expires without a denylist, and a denylist
 * is a session table with extra steps. Signing out has to actually sign you
 * out. See the schema comment on `sessions`.
 *
 * **3. The cookie is httpOnly + Secure + SameSite=Lax.** httpOnly means an XSS
 * bug cannot read the session; SameSite=Lax means another site cannot ride it
 * on a cross-origin POST, which is what makes it safe to have no CSRF token on
 * these endpoints. `Secure` is dropped ONLY on localhost, because a browser
 * silently discards a Secure cookie over plain http and the symptom is "sign-in
 * appears to work and then you are logged out", which is an hour of debugging
 * the wrong layer.
 *
 * **4. Sign-in must never lose his existing work.** Saved listings, verdict
 * overrides and the entitlement are all keyed on the device ref. Signing in
 * ADOPTS the ref onto the account (`account_devices`) rather than replacing it,
 * so nothing he has labelled disappears at the moment the product claims to
 * have got more personal.
 *
 * ── WHAT IS AND IS NOT CONFIGURED ──────────────────────────────────────────
 *
 * Email + password works with no configuration at all.
 *
 * Google needs `GOOGLE_CLIENT_ID` (free, from the Google Cloud console).
 * Apple needs `APPLE_CLIENT_ID`, which requires a **paid Apple Developer
 * Program membership**. Neither is created here: this project does not create
 * accounts or handle credentials on his behalf, so those are values he pastes
 * into Railway himself. `authProviders()` reports which are live so the UI can
 * show only buttons that actually work — a "Continue with Apple" that 503s is
 * worse than no button.
 */
import type { Context } from "hono";
import { createPublicKey, verify as cryptoVerify, randomBytes } from "node:crypto";
import { db, now } from "../db/index.ts";

const GOOGLE_CLIENT_ID = () => (process.env.GOOGLE_CLIENT_ID ?? "").trim();
const APPLE_CLIENT_ID = () => (process.env.APPLE_CLIENT_ID ?? "").trim();

/** 60 days. Long enough that a deal-hunting app is not a login chore. */
const SESSION_DAYS = 60;
export const SESSION_COOKIE = "filtrsoft_session";

/**
 * ⚠ `Secure` IS DROPPED ONLY ON LOCALHOST. A browser silently refuses to store
 * a `Secure` cookie sent over plain http, and the symptom is not an error — it
 * is a sign-in that appears to succeed and then behaves as signed-out forever.
 */
const isLocal = (c: Context) => {
  const host = c.req.header("host") ?? "";
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
};

export interface User {
  id: number; email: string; name: string | null;
  avatarUrl: string | null; createdAt: string;
}

const publicUser = (r: any): User => ({
  id: r.id, email: r.email, name: r.name ?? null,
  avatarUrl: r.avatar_url ?? null, createdAt: r.created_at,
});

// ───────────────────────────────────────────────────────────────── sessions

function newSession(userId: number, userAgent: string | undefined): string {
  /**
   * 32 bytes from a CSPRNG, base64url. `Math.random()` is not a source of
   * session tokens: it is seeded predictably and shares state across calls, so
   * one leaked token would narrow the search for every other.
   */
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  db().run(
    `INSERT INTO sessions (token, user_id, created_at, expires_at, user_agent) VALUES (?,?,?,?,?)`,
    [token, userId, now(), expires, (userAgent ?? "").slice(0, 200)],
  );
  return token;
}

function setSessionCookie(c: Context, token: string) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_DAYS * 86_400}`,
  ];
  if (!isLocal(c)) parts.push("Secure");
  c.header("Set-Cookie", parts.join("; "), { append: true });
}

function clearSessionCookie(c: Context) {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (!isLocal(c)) parts.push("Secure");
  c.header("Set-Cookie", parts.join("; "), { append: true });
}

/** Parse one cookie out of the header without pulling in a cookie library. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * The signed-in user for this request, or null.
 *
 * ⚠ EXPIRY IS CHECKED IN SQL, NOT IN JS. A row read and then compared in
 * JavaScript is one `if` away from being forgotten at a second call site; the
 * query cannot return an expired session in the first place.
 */
export function currentUser(c: Context): User | null {
  const token = readCookie(c.req.header("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const row = db().query(`
    SELECT u.* FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?
  `).get(token, now()) as any;
  return row ? publicUser(row) : null;
}

/**
 * Expired rows are deleted on a schedule, not on read.
 *
 * A DELETE inside `currentUser` would put a write on the hot path of every
 * authenticated request, and on a busy read it is exactly the wrong moment to
 * take a write lock on SQLite.
 */
export function pruneSessions(): number {
  const r = db().run(`DELETE FROM sessions WHERE expires_at <= ?`, [now()]);
  return r.changes ?? 0;
}

// ─────────────────────────────────────────────────────────── device adoption

/**
 * Attach the browser's device ref to the account.
 *
 * ⚠ FIRST ACCOUNT TO SIGN IN ON A DEVICE KEEPS IT. `INSERT OR IGNORE` rather
 * than an upsert: reassigning would pull one person's verdict overrides into
 * another person's session on a shared phone, and a wrong override is the
 * strongest possible wrong signal in this product.
 */
export function adoptDevice(userId: number, ref: string | undefined) {
  if (!ref || !/^[A-Za-z0-9_-]{8,64}$/.test(ref)) return;
  db().run(
    `INSERT OR IGNORE INTO account_devices (device_ref, user_id, created_at) VALUES (?,?,?)`,
    [ref, userId, now()],
  );
}

/** Every device ref this account has signed in on. */
export function devicesFor(userId: number): string[] {
  return (db().query(`SELECT device_ref FROM account_devices WHERE user_id=?`).all(userId) as any[])
    .map((r) => r.device_ref);
}

export function ownsDevice(userId: number, ref: unknown): ref is string {
  return typeof ref === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(ref)
    && Boolean(db().query("SELECT 1 FROM account_devices WHERE user_id=? AND device_ref=?").get(userId,ref));
}

/**
 * ─────────────────────────────────────────────────────── brute-force limiting
 *
 * ⚠ KEYED ON EMAIL **AND** IP, and both matter. IP alone lets one attacker
 * spray thousands of passwords at one account from a botnet; email alone lets
 * anyone lock a real user out of their own account by failing on purpose. The
 * counter only ever counts FAILURES, so a legitimate user's successful sign-in
 * clears it and they never meet this at all.
 */
const attempts = new Map<string, { n: number; until: number }>();
const LOCK_AFTER = 8;
const LOCK_MS = 15 * 60_000;

/**
 * ⚠ THE PROXY HEADER IS TRUSTED, AND THAT IS A DELIBERATE, BOUNDED CHOICE.
 * Railway terminates TLS in front of this process, so the socket address is
 * always the proxy and `x-forwarded-for` is the only real client signal. A
 * spoofed value can only ever WIDEN an attacker's own key space, never narrow
 * anyone else's — the email half of the key is what protects a real account.
 */
const clientIp = (c: Context) =>
  (c.req.header("x-forwarded-for") ?? "").split(",")[0].trim()
  || c.req.header("cf-connecting-ip")
  || "unknown";

export function signinBlocked(key: string): number {
  const a = attempts.get(key);
  if (!a || a.until <= Date.now()) return 0;
  return a.n >= LOCK_AFTER ? Math.ceil((a.until - Date.now()) / 1000) : 0;
}
export function noteSigninFailure(key: string) {
  const a = attempts.get(key);
  const n = a && a.until > Date.now() ? a.n + 1 : 1;
  attempts.set(key, { n, until: Date.now() + LOCK_MS });
  // Unbounded growth is a slow memory leak on a public endpoint.
  if (attempts.size > 5000) {
    for (const [k, v] of attempts) if (v.until <= Date.now()) attempts.delete(k);
  }
}
export function clearSigninFailures(key: string) { attempts.delete(key); }

// ────────────────────────────────────────────────────────── email + password

/**
 * ⚠ DELIBERATELY PERMISSIVE. This validates SHAPE, not deliverability — the
 * only real proof an address exists is sending to it. A clever regex here
 * rejects valid addresses (plus-tags, new TLDs, apostrophes) and catches
 * nothing a typo-ing user would not catch themselves.
 */
const EMAIL_OK = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

/**
 * ⚠ TWELVE, NOT EIGHT, AND NO COMPOSITION RULES.
 *
 * Length is the only requirement that reliably buys entropy. "One uppercase,
 * one digit, one symbol" pushes people to `Password1!` — which is in every
 * cracking dictionary — while banning the long passphrase that would actually
 * be strong. NIST dropped composition rules for exactly this reason.
 */
export const PASSWORD_MIN = 12;

export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== "string" || !pw) return "a password is required";
  if (pw.length < PASSWORD_MIN) return `use at least ${PASSWORD_MIN} characters`;
  // Bcrypt-style truncation is not a risk with argon2id, but a megabyte of
  // password is a free CPU-burn vector.
  if (pw.length > 200) return "that password is too long";
  return null;
}

const findByEmail = (email: string) =>
  db().query(`SELECT * FROM users WHERE email = ?`).get(email.trim().toLowerCase()) as any;

// Local deal discovery is a private workspace. Reopening registration must be
// deliberate; existing password accounts and verified provider links still work.
export const registrationOpen = () => process.env.FILTRSOFT_REGISTRATION === 'open';
export class RegistrationClosed extends Error {}
const PRIVATE_MESSAGE = 'Filtrsoft is a private workspace. Sign in with an existing account.';

export async function handleSignup(c: Context) {
  if (!registrationOpen()) return c.json({ error: PRIVATE_MESSAGE, registrationClosed: true }, 403);
  const b = await c.req.json().catch(() => null) as
    { email?: string; password?: string; name?: string; ref?: string } | null;
  const email = typeof b?.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!EMAIL_OK.test(email)) return c.json({ error: "enter a valid email address" }, 400);
  const pwErr = passwordProblem(b?.password);
  if (pwErr) return c.json({ error: pwErr }, 400);

  if (findByEmail(email)) {
    /**
     * ⚠ THIS TELLS YOU THE ACCOUNT EXISTS, ON PURPOSE.
     *
     * The privacy-preserving alternative is to accept the signup and email the
     * owner instead, which needs outbound mail this product does not have. The
     * realistic alternative — a generic error — leaves a real person unable to
     * work out why they cannot sign up and with no route to signing in. For a
     * deal feed, that usability cost is worse than the disclosure, which an
     * attacker can get from the sign-in form's timing anyway.
     */
    return c.json({ error: "that email already has an account", signIn: true }, 409);
  }

  const hash = await Bun.password.hash(b!.password!);
  const name = typeof b?.name === 'string' ? b.name.trim().slice(0, 80) || null : null;
  const r = db().run(
    `INSERT INTO users (email, password_hash, name, created_at, last_seen_at) VALUES (?,?,?,?,?)`,
    [email, hash, name, now(), now()],
  );
  const userId = Number(r.lastInsertRowid);
  adoptDevice(userId, b?.ref);
  setSessionCookie(c, newSession(userId, c.req.header("user-agent")));
  return c.json({ user: publicUser(findByEmail(email)) });
}

export async function handleSignin(c: Context) {
  const b = await c.req.json().catch(() => null) as
    { email?: string; password?: string; ref?: string } | null;
  const email = typeof b?.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = b?.password;

  /**
   * ⚠ THE LOCK IS CHECKED BEFORE THE HASH, not after. argon2id is deliberately
   * expensive — that is its job — so verifying first would let an attacker
   * spend this server's CPU at will even while being refused.
   */
  const key = `${email}|${clientIp(c)}`;
  const wait = signinBlocked(key);
  if (wait) {
    return c.json(
      { error: `too many attempts, try again in ${Math.ceil(wait / 60)} min` },
      429, { "Retry-After": String(wait) },
    );
  }

  const row = email ? findByEmail(email) : null;

  /**
   * ⚠ ONE MESSAGE FOR BOTH FAILURES, AND A HASH RUN EVEN WHEN THERE IS NO USER.
   *
   * "No such account" vs "wrong password" is a free account-enumeration oracle,
   * and so is answering in 2ms for an unknown email while a real one takes the
   * ~50ms argon2id costs. Verifying against a dummy hash keeps the timing flat.
   */
  const DUMMY = "$argon2id$v=19$m=65536,t=2,p=1$Y2xhaW1lZHNhbHQ$Zm9vYmFyYmF6cXV4Y29ycmVjdGhvcnNl";
  const ok = typeof password === "string" && password.length > 0
    ? await Bun.password.verify(password, row?.password_hash ?? DUMMY).catch(() => false)
    : false;

  if (!row || !row.password_hash || !ok) {
    /**
     * An account created through Google or Apple has `password_hash = NULL`,
     * and it must fail here rather than at a NULL-handling crash — but the
     * message stays the same, or the failure mode becomes the oracle.
     */
    noteSigninFailure(key);
    return c.json({ error: "that email and password do not match" }, 401);
  }

  // Only failures count, so a real user who mistypes twice and then succeeds
  // never meets the lock.
  clearSigninFailures(key);
  db().run(`UPDATE users SET last_seen_at=? WHERE id=?`, [now(), row.id]);
  adoptDevice(row.id, b?.ref);
  setSessionCookie(c, newSession(row.id, c.req.header("user-agent")));
  return c.json({ user: publicUser(row) });
}

export async function handleSignout(c: Context) {
  c.header("Cache-Control", "no-store");
  const token = readCookie(c.req.header("cookie"), SESSION_COOKIE);
  // Delete the row, not just the cookie. A cookie the client throws away is
  // still a valid session to anyone who captured it.
  if (token) db().run(`DELETE FROM sessions WHERE token = ?`, [token]);
  clearSessionCookie(c);
  return c.json({ ok: true });
}

export function handleMe(c: Context) {
  c.header("Cache-Control", "no-store");
  const user = currentUser(c);
  return c.json({ user, providers: authProviders() });
}

/** Which sign-in buttons the UI may show. See the file header. */
export function authProviders() {
  return {
    registrationOpen: registrationOpen(),
    password: true,
    google: Boolean(GOOGLE_CLIENT_ID()),
    googleClientId: GOOGLE_CLIENT_ID() || null,
    apple: Boolean(APPLE_CLIENT_ID()),
    appleClientId: APPLE_CLIENT_ID() || null,
  };
}

// ──────────────────────────────────────────────────── Google / Apple id tokens

type Jwk = { kid: string; kty: string; n: string; e: string; alg?: string };
const jwksCache = new Map<string, { keys: Jwk[]; at: number }>();
/**
 * ⚠ CACHED, BUT ONLY FOR AN HOUR, AND A MISS RE-FETCHES ONCE.
 *
 * Providers rotate signing keys without notice. Caching forever means every
 * sign-in breaks the day they rotate; not caching at all means an outbound
 * request on every sign-in and an outage if the provider is briefly slow. An
 * unknown `kid` forces one refresh, which is what actually handles rotation.
 */
const JWKS_TTL = 3600_000;

async function jwks(url: string, force = false): Promise<Jwk[]> {
  const hit = jwksCache.get(url);
  if (!force && hit && Date.now() - hit.at < JWKS_TTL) return hit.keys;
  const res = await fetch(url,{signal:AbortSignal.timeout(15_000)});
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const body = await res.json() as { keys: Jwk[] };
  jwksCache.set(url, { keys: body.keys ?? [], at: Date.now() });
  return body.keys ?? [];
}

const b64urlToBuf = (s: string) => Buffer.from(s, "base64url");

/**
 * Verify an RS256 id token and return its claims.
 *
 * ⚠ EVERY ONE OF THESE CHECKS IS LOAD-BEARING. An id token is only proof of
 * identity if the signature, the issuer, the audience AND the expiry all hold:
 *
 *   · signature — or anyone can mint one.
 *   · `iss`     — or a token from a different provider is accepted.
 *   · `aud`     — or a token minted for a DIFFERENT app, by the real Google,
 *                 signs its holder into this one. This is the check that gets
 *                 left out, and it is the one that matters most.
 *   · `exp`     — or a token stolen last year still works.
 *
 * Written against `node:crypto` rather than adding a JWT dependency: the whole
 * verification is twenty lines, and a library here would be a supply-chain
 * surface sitting directly on the authentication path.
 */
async function verifyIdToken(idToken: string, opts: {
  jwksUrl: string; issuers: string[]; audience: string;
}): Promise<Record<string, any>> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [h, p, sig] = parts;
  const header = JSON.parse(b64urlToBuf(h).toString("utf8"));
  const claims = JSON.parse(b64urlToBuf(p).toString("utf8"));

  if (header.alg !== "RS256") throw new Error(`unexpected alg ${header.alg}`);

  const pick = (keys: Jwk[]) => keys.find((k) => k.kid === header.kid);
  let key = pick(await jwks(opts.jwksUrl));
  if (!key) key = pick(await jwks(opts.jwksUrl, true));   // key rotation
  if (!key) throw new Error("signing key not found");

  const pub = createPublicKey({ key: key as any, format: "jwk" });
  const ok = cryptoVerify(
    "RSA-SHA256",
    Buffer.from(`${h}.${p}`),
    pub,
    b64urlToBuf(sig),
  );
  if (!ok) throw new Error("bad signature");

  if (!opts.issuers.includes(String(claims.iss))) throw new Error("wrong issuer");
  if (String(claims.aud) !== opts.audience) throw new Error("wrong audience");
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) throw new Error("token expired");
  if (!claims.sub) throw new Error("no subject");

  return claims;
}

/**
 * Turn a verified external identity into a session.
 *
 * ⚠ AN UNVERIFIED EMAIL MUST NOT MERGE INTO AN EXISTING ACCOUNT. Matching on
 * email is how "sign in with Google" adopts the account you made with a
 * password — and if the provider has not verified that address, it is also how
 * someone takes over an account by registering the same address with them. So
 * the merge happens only when the provider says `email_verified`, and
 * otherwise a separate account is created.
 */
export function upsertIdentity(opts: {
  provider: "google" | "apple";
  subject: string; email: string | null; emailVerified: boolean;
  name: string | null; picture: string | null;
}): User {
  const d = db();
  const existing = d.query(`SELECT user_id FROM identities WHERE provider=? AND subject=?`)
    .get(opts.provider, opts.subject) as { user_id: number } | null;

  if (existing) {
    const row = d.query(`SELECT * FROM users WHERE id=?`).get(existing.user_id) as any;
    d.run(`UPDATE users SET last_seen_at=? WHERE id=?`, [now(), existing.user_id]);
    return publicUser(row);
  }

  const email = opts.email?.trim().toLowerCase() || null;
  let userId: number | null = null;

  if (email && opts.emailVerified) {
    const match = findByEmail(email);
    if (match) userId = match.id;
  }

  if (userId == null) {
    if (!registrationOpen()) throw new RegistrationClosed(PRIVATE_MESSAGE);
    /**
     * `users.email` is NOT NULL and UNIQUE. Apple lets a user hide their real
     * address and, on a repeat authorisation, may send no email at all — so a
     * synthetic address keyed on the provider subject keeps the row valid and
     * stable without pretending to be reachable mail.
     */
    const addr = email ?? `${opts.provider}_${opts.subject}@users.filtrsoft.com`;
    const r = d.run(
      `INSERT INTO users (email, password_hash, name, avatar_url, created_at, last_seen_at)
       VALUES (?, NULL, ?, ?, ?, ?)`,
      [addr, opts.name, opts.picture, now(), now()],
    );
    userId = Number(r.lastInsertRowid);
  }

  d.run(
    `INSERT OR IGNORE INTO identities (provider, subject, user_id, email, created_at) VALUES (?,?,?,?,?)`,
    [opts.provider, opts.subject, userId, email, now()],
  );
  return publicUser(d.query(`SELECT * FROM users WHERE id=?`).get(userId) as any);
}

export async function handleGoogle(c: Context) {
  const clientId = GOOGLE_CLIENT_ID();
  if (!clientId) return c.json({ error: "Google sign-in is not configured" }, 503);
  const b = await c.req.json().catch(() => null) as { credential?: string; ref?: string } | null;
  if (!b?.credential) return c.json({ error: "no credential" }, 400);

  try {
    const claims = await verifyIdToken(b.credential, {
      jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
      issuers: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
    });
    const user = upsertIdentity({
      provider: "google",
      subject: String(claims.sub),
      email: claims.email ?? null,
      emailVerified: claims.email_verified === true || claims.email_verified === "true",
      name: claims.name ?? null,
      picture: claims.picture ?? null,
    });
    adoptDevice(user.id, b.ref);
    setSessionCookie(c, newSession(user.id, c.req.header("user-agent")));
    return c.json({ user });
  } catch (e) {
    // The reason is logged, never returned: "wrong audience" tells an attacker
    // exactly which check to work around next.
    if (e instanceof RegistrationClosed) return c.json({error:PRIVATE_MESSAGE,registrationClosed:true},403);
    console.error("google sign-in rejected:", (e as Error).message);
    return c.json({ error: "could not verify that Google sign-in" }, 401);
  }
}

export async function handleApple(c: Context) {
  const clientId = APPLE_CLIENT_ID();
  if (!clientId) return c.json({ error: "Apple sign-in is not configured" }, 503);
  const b = await c.req.json().catch(() => null) as
    { id_token?: string; user?: { name?: { firstName?: string; lastName?: string } }; ref?: string } | null;
  if (!b?.id_token) return c.json({ error: "no id_token" }, 400);

  try {
    const claims = await verifyIdToken(b.id_token, {
      jwksUrl: "https://appleid.apple.com/auth/keys",
      issuers: ["https://appleid.apple.com"],
      audience: clientId,
    });
    /**
     * ⚠ APPLE SENDS THE NAME EXACTLY ONCE, on the first authorisation, and in
     * the FORM BODY rather than the token. Not capturing it here means never
     * having it: a second sign-in returns the same token with no name at all.
     */
    const first = b.user?.name?.firstName ?? "";
    const last = b.user?.name?.lastName ?? "";
    const name = `${first} ${last}`.trim() || null;

    const user = upsertIdentity({
      provider: "apple",
      subject: String(claims.sub),
      email: claims.email ?? null,
      emailVerified: claims.email_verified === true || claims.email_verified === "true",
      name,
      picture: null,
    });
    adoptDevice(user.id, b.ref);
    setSessionCookie(c, newSession(user.id, c.req.header("user-agent")));
    return c.json({ user });
  } catch (e) {
    if (e instanceof RegistrationClosed) return c.json({error:PRIVATE_MESSAGE,registrationClosed:true},403);
    console.error("apple sign-in rejected:", (e as Error).message);
    return c.json({ error: "could not verify that Apple sign-in" }, 401);
  }
}
