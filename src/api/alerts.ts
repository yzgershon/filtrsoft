/**
 * Saved searches and web-push alerts.
 *
 * **THIS IS WHERE THE FEED STOPS BEING SOMEWHERE YOU VISIT.** Every deal in
 * this market is won on latency: a 4090 at $1,100 is gone in an hour, and a
 * feed you have to remember to open cannot compete with a notification. It is
 * deliberately last in the plan — an alert that fires on a bad verdict is worse
 * than no alert, so it had to wait until the engine was worth trusting.
 *
 * ── WHY THERE IS NO ACCOUNT ────────────────────────────────────────────────
 *
 * A push subscription IS the identity. The browser mints an endpoint URL that
 * only this device can receive on, so searches hang off that rather than a user
 * row. No signup, no password, nothing to leak. The tradeoff, stated in the UI:
 * alerts belong to the device that created them.
 *
 * ── DELIVERY RULES ─────────────────────────────────────────────────────────
 *
 * **Only ever alert on listings analysed AFTER the search was created.** The
 * alternative — matching the whole backlog on first save — sends fifteen
 * notifications for listings that have been sitting there for a week, and gets
 * notifications turned off within a minute of being turned on.
 *
 * **A 410 or 404 from the push service means the subscription is dead.** The
 * browser revoked it, the app was uninstalled, or the user cleared storage.
 * Those are deleted immediately: retrying a dead endpoint forever is how a
 * push queue silently becomes an outbound request storm.
 */
import type { Context } from "hono";
import webpush from "web-push";
import { db, now } from "../db/index.ts";
import { currentUser } from "./auth.ts";
import { loadAccountOverrides } from "./overrides.ts";

/** Push works if a keypair resolves — env, stored, or freshly generated. */
export const pushConfigured = () => configure();

export const vapidPublicKey = () => (configure() ? active!.publicKey : null);

let ready = false;
/** Why push is unusable, if it is. Surfaced on /v1/health. */
let configError: string | null = null;
/** Which keypair is in play, once resolved. */
let active: { publicKey: string; privateKey: string; from: "env" | "generated" } | null = null;

/**
 * A tiny key/value table on the volume, for things the server must remember
 * across restarts and must NOT depend on a human pasting correctly.
 */
function ensureConfigTable() {
  db().run(`
    CREATE TABLE IF NOT EXISTS app_config (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
}

const cfgGet = (k: string): string | null => {
  ensureConfigTable();
  return (db().query("SELECT value FROM app_config WHERE key=?").get(k) as { value: string } | null)?.value ?? null;
};
const cfgSet = (k: string, v: string) => {
  ensureConfigTable();
  db().run(
    "INSERT INTO app_config (key, value, created_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    [k, v, now()],
  );
};

/**
 * ⚠ AN EMPTY ENV VAR IS UNSET, AND `??` DOES NOT AGREE.
 *
 * `process.env.VAPID_SUBJECT ?? "mailto:..."` keeps the empty string, because
 * nullish coalescing only catches null and undefined. A hosting dashboard
 * where somebody created the variable and left the value blank produces
 * exactly that, and push then died with "No subject set in
 * vapidDetails.subject" — a confusing error for a variable that visibly
 * exists.
 *
 * Same shape as the `null ?? 1500` shipping trap already in `valuation`.
 */
const envOr = (name: string, fallback: string) => {
  const v = (process.env[name] ?? "").trim();
  return v || fallback;
};

/** Does this pair actually load? The only test that means anything. */
function pairWorks(subject: string, pub: string, priv: string): string | null {
  try { webpush.setVapidDetails(subject, pub, priv); return null; }
  catch (e) { return (e as Error).message; }
}

/**
 * THE SERVER OWNS ITS OWN VAPID KEYPAIR.
 *
 * It used to require two environment variables, and that put a 87-character
 * and a 43-character base64url string through a human, a clipboard and a
 * hosting dashboard. Predictably one arrived wrong: production ran with a
 * 60-character "private key" and every push failed. Nothing about push needs a
 * human in that loop — the pair is generated, not chosen, and nobody has to
 * know its value.
 *
 * So: if the env vars are present AND load, they win (an existing deployment
 * keeps its keys and its subscriptions). Otherwise the server generates a pair
 * once, stores it beside the database on the same volume, and reuses it
 * forever. Same trust level as the database, which already holds every
 * subscription endpoint.
 *
 * **The pair must be stable across restarts.** Regenerating on each boot would
 * silently invalidate every existing subscription — the browser holds a
 * subscription bound to the public key it subscribed with, so a new pair means
 * every device goes quiet with no error anywhere.
 */
function resolveKeys(): { publicKey: string; privateKey: string; from: "env" | "generated" } | null {
  if (active) return active;
  const subject = envOr("VAPID_SUBJECT", "mailto:hello@filtrsoft.com");

  const envPub = (process.env.VAPID_PUBLIC_KEY ?? "").trim();
  const envPriv = (process.env.VAPID_PRIVATE_KEY ?? "").trim();
  if (envPub && envPriv) {
    const err = pairWorks(subject, envPub, envPriv);
    if (!err) { active = { publicKey: envPub, privateKey: envPriv, from: "env" }; return active; }
    // Do not fail here. A bad env var is now a warning, not an outage.
    console.error(`VAPID env keys rejected (${err}) — falling back to a server-generated pair`);
  }

  try {
    const pub = cfgGet("vapid_public"), priv = cfgGet("vapid_private");
    if (pub && priv && !pairWorks(subject, pub, priv)) {
      active = { publicKey: pub, privateKey: priv, from: "generated" };
      return active;
    }
    const gen = webpush.generateVAPIDKeys();
    const err = pairWorks(subject, gen.publicKey, gen.privateKey);
    if (err) { configError = `generated pair rejected: ${err}`; return null; }
    cfgSet("vapid_public", gen.publicKey);
    cfgSet("vapid_private", gen.privateKey);
    console.log("generated a VAPID keypair and stored it on the volume");
    active = { publicKey: gen.publicKey, privateKey: gen.privateKey, from: "generated" };
    return active;
  } catch (e) {
    // A read-only or full volume lands here. Push is unavailable; nothing else
    // should break because of it.
    configError = `could not store a generated VAPID pair: ${(e as Error).message}`;
    return null;
  }
}

/**
 * ⚠ `setVapidDetails` THROWS, and it used to throw straight out of an HTTP
 * handler as a bare 500.
 *
 * It validates hard: the subject must be a `mailto:` or `https:` URL, the
 * public key must decode to exactly 65 bytes and the private key to 32. A key
 * pasted into a hosting dashboard with a trailing newline, a quote, or one
 * character clipped fails all of those — and the failure surfaced as
 * `POST /v1/push/test -> 500 Internal Server Error` with no body, which says
 * nothing about which of the three is wrong.
 *
 * It also broke `runAlerts` on every crawl for the same reason, because that
 * calls this too.
 *
 * Values are TRIMMED before use. Copy-paste through a browser into an env var
 * picks up whitespace far more often than it should, and a trailing newline in
 * a base64url key is invisible in every UI that displays it.
 */
function configure(): boolean {
  if (ready) return true;
  const keys = resolveKeys();
  if (!keys) { configError ??= "no usable VAPID keypair"; return false; }
  const subject = envOr("VAPID_SUBJECT", "mailto:hello@filtrsoft.com");
  const err = pairWorks(subject, keys.publicKey, keys.privateKey);
  if (err) { configError = err; console.error(`push disabled — VAPID rejected: ${err}`); return false; }
  ready = true;
  configError = null;
  return true;
}

/**
 * Diagnostics for /v1/health. Reports key LENGTHS, never key values — a
 * truncated or whitespace-padded key is visible as a wrong length, and that is
 * the whole failure mode, so there is no reason to expose the secret itself.
 */
export function pushStatus() {
  const ok = configure();
  return {
    usable: ok,
    error: configError,
    /** env = you supplied a pair; generated = the server made its own. */
    keySource: active?.from ?? null,
    subject: envOr("VAPID_SUBJECT", "mailto:hello@filtrsoft.com"),
    publicKeyChars: active?.publicKey.length ?? 0,   // 87 when healthy
    privateKeyChars: active?.privateKey.length ?? 0, // 43 when healthy
  };
}

export function ensureAlertTables() {
  db().run(`
    CREATE TABLE IF NOT EXISTS push_subs (
      id         INTEGER PRIMARY KEY,
      endpoint   TEXT NOT NULL UNIQUE,
      p256dh     TEXT NOT NULL,
      auth       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_ok    TEXT
    )`);
  addColumn("push_subs", "user_id", "INTEGER REFERENCES users(id)");
  db().run(`
    CREATE TABLE IF NOT EXISTS saved_searches (
      id             INTEGER PRIMARY KEY,
      sub_id         INTEGER NOT NULL REFERENCES push_subs(id) ON DELETE CASCADE,
      label          TEXT NOT NULL,
      query          TEXT,
      max_price_cents INTEGER,
      min_profit_cents INTEGER,
      calls          TEXT,
      created_at     TEXT NOT NULL
    )`);
  /**
   * ⚠ THE STANDING ALERT. Yish, 2026-09-04: *"the entire point of the app was
   * to send me a notification when there is a buy and a verify first but its
   * still not working. this may be because the alerts only work for custom
   * alerts that i make."*
   *
   * He diagnosed it exactly. `runAlerts` iterates `saved_searches`, so with no
   * saved search the loop body never ran and the app's whole reason to exist
   * was gated behind a feature he had no reason to use. **Turning a product's
   * core promise into an opt-in is how it silently never happens.**
   *
   * A row rather than a special case, because everything a notification needs
   * is already built around rows: per-listing dedupe in `alert_sent`, the
   * `created_at` backlog guard, dead-subscription cleanup, and `matches()`.
   * A parallel code path would reimplement four things and get one wrong.
   */
  addColumn("saved_searches", "standing", "INTEGER NOT NULL DEFAULT 0");
  /**
   * One row per (search, listing) already sent. This is what stops the same
   * listing alerting on every crawl — a re-verdict bumps a listing's row
   * without changing its id, so "have I sent this" cannot be inferred from
   * timestamps alone.
   */
  db().run(`
    CREATE TABLE IF NOT EXISTS alert_sent (
      search_id  INTEGER NOT NULL,
      listing_id INTEGER NOT NULL,
      sent_at    TEXT NOT NULL,
      PRIMARY KEY (search_id, listing_id)
    )`);
  db().run(`CREATE TABLE IF NOT EXISTS alert_deliveries (
    search_id INTEGER NOT NULL,listing_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,lease_until TEXT,last_error TEXT,updated_at TEXT NOT NULL,
    PRIMARY KEY(search_id,listing_id)
  )`);

  backfillStandingAlerts();
}

/** `schema.sql` is idempotent but never ALTERs a table that already exists. */
function addColumn(table: string, name: string, decl: string) {
  const has = (db().query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .some((c) => c.name === name);
  if (!has) db().run(`ALTER TABLE ${table} ADD COLUMN ${name} ${decl}`);
}

/** Every push subscription gets BUY and VERIFY, whether or not it asked. */
export const STANDING_LABEL = "Buy it and Verify first";
export const STANDING_CALLS = "BUY,VERIFY";

/**
 * Give every subscription that lacks one a standing alert.
 *
 * ⚠ `created_at` IS NOW, NOT THE SUBSCRIPTION'S DATE, and that is the one
 * decision here worth defending. The row's timestamp is the backlog guard, so
 * backdating it would fire one notification per historical match the instant
 * this ships — about thirty at once on the current feed. The existing comment
 * on that guard already records what happens next: *"notifications get switched
 * off immediately."* Starting from now costs him nothing he cannot see in the
 * app, and buys the feature a first impression it survives.
 */
function backfillStandingAlerts() {
  db().run(
    `INSERT INTO saved_searches (sub_id, label, query, max_price_cents, min_profit_cents, calls, created_at, standing)
     SELECT p.id, ?, NULL, NULL, NULL, ?, ?, 1
       FROM push_subs p
      WHERE NOT EXISTS (SELECT 1 FROM saved_searches s WHERE s.sub_id = p.id AND s.standing = 1)`,
    [STANDING_LABEL, STANDING_CALLS, now()],
  );
}

interface SearchRow {
  id: number; sub_id: number; label: string; query: string | null;
  max_price_cents: number | null; min_profit_cents: number | null;
  calls: string | null; created_at: string; standing?: number;
  endpoint: string; p256dh: string; auth: string;
  user_id?: number | null;
}

/** Does this listing satisfy the search? All stated criteria must hold. */
export function matches(s: {
  query: string | null; max_price_cents: number | null;
  min_profit_cents: number | null; calls: string | null;
}, l: { title: string; price: number | null; call: string; net: number | null }): boolean {
  if (s.calls) {
    const want = s.calls.split(",").filter(Boolean);
    if (want.length && !want.includes(l.call)) return false;
  }
  if (s.max_price_cents != null) {
    // A listing with NO price cannot satisfy "under $1,400". Treating unknown
    // as passing is how an alert for a cheap GPU delivers a $0 parse failure.
    if (l.price == null || l.price > s.max_price_cents) return false;
  }
  if (s.min_profit_cents != null) {
    if (l.net == null || l.net < s.min_profit_cents) return false;
  }
  if (s.query) {
    /**
     * EVERY word must appear, not any. "rtx 4090" matching on "rtx" alone
     * returns every graphics card on the site, and an alert that fires on
     * everything carries no information — the same rule the risk engine
     * already follows.
     */
    const hay = l.title.toLowerCase();
    const words = s.query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

/**
 * Match newly-analysed listings against every saved search and notify.
 *
 * Called after a crawl. Returns how many notifications went out, so the
 * scheduler can log it and a runaway is visible in the logs rather than only
 * on someone's lock screen.
 */
export async function runAlerts(): Promise<number> {
  if (!configure()) return 0;
  ensureAlertTables();

  const searches = db().query(`
    SELECT s.*, p.endpoint, p.p256dh, p.auth,p.user_id
    FROM saved_searches s JOIN push_subs p ON p.id = s.sub_id
  `).all() as SearchRow[];
  if (!searches.length) return 0;

  let sent = 0;
  for (const s of searches) {
    const overrides=s.user_id ? loadAccountOverrides(s.user_id) : new Map();
    const at=now();
    /**
     * `captured_at > s.created_at` is the backlog guard. Without it, saving a
     * search fires one notification per historical match — fifteen at once for
     * listings a week old — and notifications get switched off immediately.
     */
    const rows = db().query(`
      SELECT l.id, l.title, l.asking_price_cents price, v.call, v.payload
      FROM listings l
      JOIN verdicts v ON v.id = (SELECT MAX(id) FROM verdicts WHERE listing_id = l.id)
      WHERE l.delisted_at IS NULL
        AND l.captured_at > ?
        AND v.call NOT IN ('OUT_OF_SCOPE')
        AND NOT EXISTS (SELECT 1 FROM alert_sent a WHERE a.search_id = ? AND a.listing_id = l.id)
        AND NOT EXISTS (SELECT 1 FROM alert_deliveries a WHERE a.search_id=? AND a.listing_id=l.id
          AND (a.status IN ('delivered','failed') OR a.next_attempt_at>? OR a.lease_until>?))
      ORDER BY l.id DESC
    `).all(s.created_at,s.id,s.id,at,at) as any[];

    // Match first, then bound delivery work. A newer nonmatch must not hide an
    // older BUY forever. Personal risk labels also apply before this limit.
    const eligible=rows.map(r=>({...r,call:overrides.get(r.id)?.call??r.call})).filter(r=>{
      let net=null;try{net=r.payload?JSON.parse(r.payload).netProfitCents??null:null;}catch{return false;}
      return matches(s,{title:r.title,price:r.price,call:r.call,net});
    }).slice(0,40);
    for (const candidate of eligible) {
      // A slow earlier delivery may give Yish time to relabel or retire the
      // next candidate. Revalidate immediately before claiming its delivery.
      const r=db().query(`SELECT l.id,l.title,l.asking_price_cents price,v.call,v.payload FROM listings l
        JOIN verdicts v ON v.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id)
        WHERE l.id=? AND l.delisted_at IS NULL`).get(candidate.id) as any;
      if(!r)continue;
      if(s.user_id)r.call=loadAccountOverrides(s.user_id).get(r.id)?.call??r.call;
      let net=null;try{net=r.payload?JSON.parse(r.payload).netProfitCents??null:null;}catch{continue;}
      if(!matches(s,{title:r.title,price:r.price,call:r.call,net}))continue;
      const claimed=db().transaction(()=>{
        db().run("INSERT OR IGNORE INTO alert_deliveries(search_id,listing_id,next_attempt_at,updated_at) VALUES(?,?,?,?)",[s.id,r.id,at,at]);
        return db().run(`UPDATE alert_deliveries SET status='sending',attempts=attempts+1,lease_until=?,updated_at=?
          WHERE search_id=? AND listing_id=? AND status NOT IN ('delivered','failed')
            AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?)`,
          [new Date(Date.now()+60_000).toISOString(),at,s.id,r.id,at,at]).changes>0;
      })();
      if(!claimed)continue;

      /**
       * ⚠ THE TITLE NAMES THE CALL, and for the standing alert that is the
       * whole message. A lock-screen line reading "Buy it and Verify first"
       * over every notification tells him nothing about the one that just
       * arrived; "Buy it" versus "Verify first" is the entire decision.
       */
      const heading = s.standing
        ? (r.call === "BUY" ? "Buy it" : r.call === "VERIFY" ? "Verify first" : r.call)
        : s.label;
      const result = await send(s, {
        title: heading,
        body: `${r.title.slice(0, 70)}, ${r.price ? `$${Math.round(r.price / 100)}` : "no price"}`,
        url: `/c/${r.id}`,
      });
      db().transaction(()=>{
        const attempts=(db().query("SELECT attempts FROM alert_deliveries WHERE search_id=? AND listing_id=?").get(s.id,r.id) as {attempts:number}).attempts;
        const status=result.ok?'delivered':result.permanent||attempts>=6?'failed':'retry';
        const next=new Date(Date.now()+Math.min(3_600_000,30_000*2**Math.max(0,attempts-1))).toISOString();
        db().run("UPDATE alert_deliveries SET status=?,next_attempt_at=?,lease_until=NULL,last_error=?,updated_at=? WHERE search_id=? AND listing_id=?",[status,next,result.error,now(),s.id,r.id]);
        if(result.ok)db().run("INSERT OR IGNORE INTO alert_sent(search_id,listing_id,sent_at) VALUES(?,?,?)",[s.id,r.id,now()]);
      })();
      if(result.ok)sent++;
      if(result.permanent)break;
    }
  }
  return sent;
}

async function send(s: SearchRow, payload: { title: string; body: string; url: string }) {
  try {
    await webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      JSON.stringify(payload),
      {timeout:15_000},
    );
    db().run("UPDATE push_subs SET last_ok=? WHERE id=?", [now(), s.sub_id]);
    return {ok:true,permanent:false,error:null};
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    const msg = (e as Error).message ?? "";
    /**
     * Two kinds of permanent death, and the second one is easy to miss.
     *
     * 404/410 is the push SERVICE saying the endpoint is gone — revoked,
     * uninstalled, storage cleared.
     *
     * A key error is worse: `web-push` fails while ENCRYPTING, before any HTTP
     * request happens, so there is no status code at all. A subscription whose
     * p256dh is not a valid P-256 point can never succeed, and without this
     * branch it sits in the table being retried on every crawl forever. Found
     * by planting a malformed subscription: "Public key is not valid for
     * specified curve", no status, row untouched.
     */
    const dead = code === 404 || code === 410 || /curve|public key|invalid.*key/i.test(msg);
    if (dead) {
      db().run("DELETE FROM push_subs WHERE id=?", [s.sub_id]);
      console.log(`alerts: dropped dead subscription ${s.sub_id} (${code ?? msg.slice(0, 40)})`);
    } else {
      console.error(`alerts: send failed (${code ?? "?"}) —`, msg);
    }
    return {ok:false,permanent:dead,error:msg.slice(0,500)};
  }
}

// ------------------------------------------------------------------ routes

export function handleVapid(c: Context) {
  /**
   * `configured` reports whether push can actually WORK, not merely whether
   * two env vars are present. The browser gates its subscribe button on this,
   * and offering to subscribe against a keypair the server cannot load
   * produces a subscription that can never receive anything.
   */
  const st = pushStatus();
  return c.json({ publicKey: st.usable ? vapidPublicKey() : null, configured: st.usable, error: st.error });
}

export async function handleSubscribe(c: Context) {
  ensureAlertTables();
  const user=currentUser(c);
  if(!user)return c.json({error:"sign in required"},401);
  const b = await c.req.json().catch(() => null) as {
    endpoint?: string; keys?: { p256dh?: string; auth?: string };
  } | null;
  if (typeof b?.endpoint !== "string" || !b.endpoint.startsWith("https://") || typeof b.keys?.p256dh !== "string" || typeof b.keys?.auth !== "string" || !b.keys.p256dh || !b.keys.auth) {
    return c.json({ error: "endpoint and keys are required" }, 400);
  }
  const existing=db().query("SELECT user_id,p256dh,auth FROM push_subs WHERE endpoint=?").get(b.endpoint) as {user_id:number|null;p256dh:string;auth:string}|null;
  if(existing && (existing.user_id!==null && existing.user_id!==user.id
    || existing.user_id===null && (existing.p256dh!==b.keys.p256dh || existing.auth!==b.keys.auth))) {
    return c.json({error:"subscription does not belong to this account"},403);
  }
  // Upsert on endpoint: re-subscribing the same device must not create a
  // second row, or every alert arrives twice.
  db().run(
    `INSERT INTO push_subs (endpoint, p256dh, auth, created_at, user_id) VALUES (?,?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth,user_id=excluded.user_id
       WHERE push_subs.user_id=excluded.user_id OR (push_subs.user_id IS NULL AND push_subs.p256dh=excluded.p256dh AND push_subs.auth=excluded.auth)`,
    [b.endpoint, b.keys.p256dh, b.keys.auth, now(),user.id],
  );
  const row = db().query("SELECT id FROM push_subs WHERE endpoint=? AND user_id=?").get(b.endpoint,user.id) as { id: number } | null;
  if(!row)return c.json({error:"subscription ownership changed; retry"},409);
  /**
   * ⚠ A DEVICE IS SUBSCRIBED TO BUY AND VERIFY THE MOMENT IT ALLOWS
   * NOTIFICATIONS. Granting permission and then receiving nothing is
   * indistinguishable from the feature being broken, which is exactly the
   * state Yish found it in.
   */
  backfillStandingAlerts();
  return c.json({ subId: row.id, standing: STANDING_CALLS.split(",") });
}

export function handleListSearches(c: Context) {
  ensureAlertTables();
  const subId = Number(c.req.query("subId"));
  if (!subId) return c.json({ items: [] });
  if(!ownsSubscription(c,subId))return c.json({error:"subscription does not belong to this account"},403);
  const items = db().query(
    "SELECT id, label, query, max_price_cents, min_profit_cents, calls, created_at, standing FROM saved_searches WHERE sub_id=? ORDER BY standing DESC, id DESC",
  ).all(subId);
  return c.json({ items });
}

export async function handleCreateSearch(c: Context) {
  ensureAlertTables();
  const b = await c.req.json().catch(() => null) as {
    subId?: number; label?: string; query?: string;
    maxPriceCents?: number; minProfitCents?: number; calls?: string[];
  } | null;
  if (!b?.subId) return c.json({ error: "subId is required" }, 400);
  if(!ownsSubscription(c,b.subId))return c.json({error:"subscription does not belong to this account"},403);

  const query = (b.query ?? "").trim() || null;
  const hasCriterion = query || b.maxPriceCents != null || b.minProfitCents != null || b.calls?.length;
  // A search with no criteria matches every listing on the site. That is not a
  // saved search, it is the feed with a notification attached to it.
  if (!hasCriterion) return c.json({ error: "add at least one thing to match on" }, 400);

  const sub = db().query("SELECT id FROM push_subs WHERE id=?").get(b.subId);
  if (!sub) return c.json({ error: "unknown subscription" }, 404);

  // Bound saved searches per owned subscription as well as requiring a session.
  const n = (db().query("SELECT COUNT(*) n FROM saved_searches WHERE sub_id=?").get(b.subId) as { n: number }).n;
  if (n >= 20) return c.json({ error: "that's the limit of 20 saved searches" }, 400);

  const label = (b.label ?? "").trim() || query || "Saved search";
  const r = db().run(
    `INSERT INTO saved_searches (sub_id, label, query, max_price_cents, min_profit_cents, calls, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [b.subId, label.slice(0, 60), query, b.maxPriceCents ?? null,
     b.minProfitCents ?? null, b.calls?.length ? b.calls.join(",") : null, now()],
  );
  return c.json({ id: Number(r.lastInsertRowid), label });
}

export function handleDeleteSearch(c: Context) {
  ensureAlertTables();
  const id = Number(c.req.param("id"));
  const subId = Number(c.req.query("subId"));
  if(!ownsSubscription(c,subId))return c.json({error:"subscription does not belong to this account"},403);
  /**
   * ⚠ THE STANDING ALERT CANNOT BE DELETED, ONLY NARROWED. Deleting it would
   * put the device back in the silent state this whole change exists to end,
   * and it would do so through a control that looks like ordinary tidying up.
   * Turning VERIFY off is `PATCH`; turning everything off is the OS permission
   * toggle, which is where a user already expects to find it.
   */
  const target = db().query("SELECT standing FROM saved_searches WHERE id=? AND sub_id=?")
    .get(id, subId) as { standing: number } | null;
  if (target?.standing) {
    return c.json({ error: "that one is built in — switch Verify first off instead", standing: true }, 400);
  }
  // Scoped to the subscription so an id alone cannot delete somebody else's.
  const r = db().run("DELETE FROM saved_searches WHERE id=? AND sub_id=?", [id, subId]);
  return c.json({ deleted: r.changes });
}

/** Send one notification to this device so "it works" is provable. */
export async function handleTestPush(c: Context) {
  ensureAlertTables();
  if(!ownsSubscription(c,Number(c.req.query("subId"))))return c.json({error:"subscription does not belong to this account"},403);
  if (!configure()) {
    return c.json({ error: `push is not usable on the server: ${configError ?? "unknown"}` }, 503);
  }
  const subId = Number(c.req.query("subId"));
  const row = db().query("SELECT id sub_id, endpoint, p256dh, auth FROM push_subs WHERE id=?").get(subId) as SearchRow | null;
  if (!row) return c.json({ error: "unknown subscription" }, 404);
  const result = await send(row, {
    title: "Filtrsoft alerts are on",
    body: "This is what a match will look like.",
    url: "/",
  });
  return c.json({ sent: result.ok });
}

/**
 * Who is actually subscribed, and to what.
 *
 * Reported on `/v1/health` beside `pushStatus()`. The two answer different
 * questions and conflating them cost real time: the server can be perfectly
 * configured for push and have nobody to push to, which is what "alerts don't
 * work" looked like from the outside.
 */
export function alertStatus() {
  try {
    ensureAlertTables();
    const subs = (db().query("SELECT COUNT(*) n FROM push_subs").get() as { n: number }).n;
    const standing = (db().query("SELECT COUNT(*) n FROM saved_searches WHERE standing=1").get() as { n: number }).n;
    const custom = (db().query("SELECT COUNT(*) n FROM saved_searches WHERE standing=0").get() as { n: number }).n;
    const last = (db().query("SELECT MAX(sent_at) t FROM alert_sent").get() as { t: string | null }).t;
    return { subscriptions: subs, standingAlerts: standing, savedSearches: custom, lastAlertAt: last };
  } catch {
    return { subscriptions: 0, standingAlerts: 0, savedSearches: 0, lastAlertAt: null };
  }
}

/**
 * Narrow or widen the standing alert. The only thing about it that is editable.
 *
 * `verify: false` leaves BUY on. There is deliberately no way to reach an empty
 * `calls` here — a standing alert that matches nothing is the silent state this
 * whole mechanism exists to prevent, and the honest control for "no
 * notifications at all" is the operating system's own permission switch.
 */
export async function handleUpdateStanding(c: Context) {
  ensureAlertTables();
  const subId = Number(c.req.query("subId"));
  if (!subId) return c.json({ error: "subId is required" }, 400);
  if(!ownsSubscription(c,subId))return c.json({error:"subscription does not belong to this account"},403);
  const b = await c.req.json().catch(() => null) as { verify?: boolean } | null;
  const calls = b?.verify === false ? "BUY" : STANDING_CALLS;
  const r = db().run("UPDATE saved_searches SET calls=? WHERE sub_id=? AND standing=1", [calls, subId]);
  if (!r.changes) return c.json({ error: "no standing alert for this device" }, 404);
  return c.json({ calls: calls.split(",") });
}

function ownsSubscription(c: Context, id: number): boolean {
  const user=currentUser(c);
  return !!user && Number.isSafeInteger(id) && id>0 && !!db().query("SELECT 1 FROM push_subs WHERE id=? AND user_id=?").get(id,user.id);
}
