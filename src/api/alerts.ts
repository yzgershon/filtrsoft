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

export const pushConfigured = () =>
  Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? null;

let ready = false;
function configure() {
  if (ready || !pushConfigured()) return pushConfigured();
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:hello@assyze.com",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  ready = true;
  return true;
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
}

interface SearchRow {
  id: number; sub_id: number; label: string; query: string | null;
  max_price_cents: number | null; min_profit_cents: number | null;
  calls: string | null; created_at: string;
  endpoint: string; p256dh: string; auth: string;
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
    SELECT s.*, p.endpoint, p.p256dh, p.auth
    FROM saved_searches s JOIN push_subs p ON p.id = s.sub_id
  `).all() as SearchRow[];
  if (!searches.length) return 0;

  let sent = 0;
  for (const s of searches) {
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
      ORDER BY l.id DESC LIMIT 40
    `).all(s.created_at, s.id) as any[];

    for (const r of rows) {
      const net = r.payload ? (JSON.parse(r.payload).netProfitCents ?? null) : null;
      if (!matches(s, { title: r.title, price: r.price, call: r.call, net })) continue;

      const ok = await send(s, {
        title: s.label,
        body: `${r.title.slice(0, 70)} — ${r.price ? `$${Math.round(r.price / 100)}` : "no price"}`,
        url: `/c/${r.id}`,
      });
      // Recorded even on failure. A listing that could not be delivered once
      // should not be retried on every crawl forever.
      db().run("INSERT OR IGNORE INTO alert_sent (search_id, listing_id, sent_at) VALUES (?,?,?)",
        [s.id, r.id, now()]);
      if (ok) sent++;
    }
  }
  return sent;
}

async function send(s: SearchRow, payload: { title: string; body: string; url: string }) {
  try {
    await webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      JSON.stringify(payload),
    );
    db().run("UPDATE push_subs SET last_ok=? WHERE id=?", [now(), s.sub_id]);
    return true;
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
    return false;
  }
}

// ------------------------------------------------------------------ routes

export function handleVapid(c: Context) {
  return c.json({ publicKey: vapidPublicKey(), configured: pushConfigured() });
}

export async function handleSubscribe(c: Context) {
  ensureAlertTables();
  const b = await c.req.json().catch(() => null) as {
    endpoint?: string; keys?: { p256dh?: string; auth?: string };
  } | null;
  if (!b?.endpoint || !b.keys?.p256dh || !b.keys?.auth) {
    return c.json({ error: "endpoint and keys are required" }, 400);
  }
  // Upsert on endpoint: re-subscribing the same device must not create a
  // second row, or every alert arrives twice.
  db().run(
    `INSERT INTO push_subs (endpoint, p256dh, auth, created_at) VALUES (?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth`,
    [b.endpoint, b.keys.p256dh, b.keys.auth, now()],
  );
  const row = db().query("SELECT id FROM push_subs WHERE endpoint=?").get(b.endpoint) as { id: number };
  return c.json({ subId: row.id });
}

export function handleListSearches(c: Context) {
  ensureAlertTables();
  const subId = Number(c.req.query("subId"));
  if (!subId) return c.json({ items: [] });
  const items = db().query(
    "SELECT id, label, query, max_price_cents, min_profit_cents, calls, created_at FROM saved_searches WHERE sub_id=? ORDER BY id DESC",
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

  const query = (b.query ?? "").trim() || null;
  const hasCriterion = query || b.maxPriceCents != null || b.minProfitCents != null || b.calls?.length;
  // A search with no criteria matches every listing on the site. That is not a
  // saved search, it is the feed with a notification attached to it.
  if (!hasCriterion) return c.json({ error: "add at least one thing to match on" }, 400);

  const sub = db().query("SELECT id FROM push_subs WHERE id=?").get(b.subId);
  if (!sub) return c.json({ error: "unknown subscription" }, 404);

  // Cap per device. This endpoint is unauthenticated by design, so the bound
  // is what stops one browser filling the table.
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
  // Scoped to the subscription so an id alone cannot delete somebody else's.
  const r = db().run("DELETE FROM saved_searches WHERE id=? AND sub_id=?", [id, subId]);
  return c.json({ deleted: r.changes });
}

/** Send one notification to this device so "it works" is provable. */
export async function handleTestPush(c: Context) {
  if (!configure()) return c.json({ error: "push is not configured on the server" }, 503);
  const subId = Number(c.req.query("subId"));
  const row = db().query("SELECT id sub_id, endpoint, p256dh, auth FROM push_subs WHERE id=?").get(subId) as SearchRow | null;
  if (!row) return c.json({ error: "unknown subscription" }, 404);
  const ok = await send(row, {
    title: "Assyze alerts are on",
    body: "This is what a match will look like.",
    url: "/",
  });
  return c.json({ sent: ok });
}
