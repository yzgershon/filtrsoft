/**
 * Crawl jobs — the button in the app that starts a crawl on his PC.
 *
 * Yish, 2026-09-03: *"code a button in Filtrsoft that I click and put in a pin ...
 * that automatically starts the crawl ... so I dont need to waste my claude
 * usage asking you to crawl."*
 *
 * ── WHY IT IS A QUEUE AND NOT A CALL ───────────────────────────────────────
 *
 * filtrsoft.com is a Railway container. His desktop is behind a home router with
 * no inbound route and no fixed address. **The server cannot reach his PC**, so
 * a button that tried to call it could never work in any amount of code.
 *
 * Inverted: the button writes a row, and `bun run agent` on his machine polls
 * for it. That machine is the only one that can do the work anyway — Facebook,
 * OfferUp and Mercari all need a logged-in browser, which the container has
 * neither of.
 *
 * The honest consequence, which the UI states rather than hides: **if his PC is
 * off, the job waits.** A spinner over a job nothing is working on is how a
 * feature gets reported as broken the first time he taps it from school.
 *
 * ── THE PIN ────────────────────────────────────────────────────────────────
 *
 * ⚠ THE PIN IS THE SECOND FACTOR, NOT THE ONLY ONE. The endpoint already sits
 * behind the account wall, so an attacker needs his password AND the PIN. That
 * matters, because four digits is 10,000 guesses — on its own it would be
 * worth roughly nothing. What the PIN actually buys is that a stolen session,
 * or his own phone in a pocket, cannot start a crawl by accident.
 *
 * ⚠ AND IT LIVES IN AN ENV VAR, NEVER IN THE REPO. Same rule as every other
 * secret in this project. A PIN committed to git is a PIN in the clone, in the
 * fork and in the history forever, and rotating it would take a deploy. Set
 * `FILTRSOFT_CRAWL_PIN` on Railway; unset, the feature reports itself as
 * unconfigured rather than defaulting to something guessable.
 */
import type { Context } from "hono";
import { timingSafeEqual } from "node:crypto";
import { db, now } from "../db/index.ts";
import { currentUser } from "./auth.ts";

const PIN = () => (process.env.FILTRSOFT_CRAWL_PIN ?? "").trim();
export const crawlPinConfigured = () => PIN().length >= 4;

/** Sources only a browser with a real session can reach. */
export const AGENT_SOURCES = ["facebook", "offerup", "mercari"] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

/**
 * A job older than this was queued against a PC that never came online.
 *
 * ⚠ IT MUST EXPIRE RATHER THAN WAIT FOREVER. Otherwise tapping the button
 * three times on a Tuesday means three crawls all firing at once on Saturday
 * when the machine next boots — and the whole point of the feature is fresh
 * listings, which a four-day-old request is not.
 */
export const JOB_TTL_MIN = 45;

/**
 * ⚠ A JOB THAT CLAIMED AND DIED MUST NOT BLOCK THE QUEUE FOREVER. The agent
 * marks a job `running` and then crashes, the machine sleeps, the network
 * drops — without this, `queued` never advances again and the button silently
 * stops working. Longer than the TTL because a real crawl legitimately takes
 * this long.
 */
export const RUNNING_TIMEOUT_MIN = 40;

function sweepStaleJobs() {
  const d = db();
  d.run(
    `UPDATE crawl_jobs SET status='expired', finished_at=?, error='no agent picked this up in time'
      WHERE status='queued' AND created_at < datetime('now', ?)`,
    [now(), `-${JOB_TTL_MIN} minutes`],
  );
  d.run(
    `UPDATE crawl_jobs SET status='failed', finished_at=?, error='the agent stopped reporting'
      WHERE status='running' AND COALESCE(started_at, created_at) < datetime('now', ?)`,
    [now(), `-${RUNNING_TIMEOUT_MIN} minutes`],
  );
}

// ────────────────────────────────────────────────────────── rate limiting

/**
 * Wrong-PIN attempts, per user. Same reasoning as the sign-in lock: four digits
 * is small enough that an unthrottled endpoint is a free brute force.
 */
const pinFails = new Map<number, { n: number; until: number }>();
const PIN_LOCK_AFTER = 5;
const PIN_LOCK_MS = 10 * 60_000;

function pinBlocked(userId: number): number {
  const a = pinFails.get(userId);
  if (!a || a.until <= Date.now()) return 0;
  return a.n >= PIN_LOCK_AFTER ? Math.ceil((a.until - Date.now()) / 1000) : 0;
}

/** Constant-time, and length-safe: `timingSafeEqual` throws on a length mismatch. */
function pinMatches(given: string): boolean {
  const want = PIN();
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ─────────────────────────────────────────────────────────────── the button

export async function handleStartCrawl(c: Context) {
  const user = currentUser(c);
  if (!user) return c.json({ error: "sign in first" }, 401);
  if (!crawlPinConfigured()) {
    return c.json({
      error: "crawling from the app is not set up yet",
      detail: "FILTRSOFT_CRAWL_PIN is not set on the server.",
    }, 503);
  }

  const wait = pinBlocked(user.id);
  if (wait) {
    return c.json({ error: `too many wrong PINs, try again in ${Math.ceil(wait / 60)} min` },
      429, { "Retry-After": String(wait) });
  }

  const body = await c.req.json().catch(() => null) as
    { pin?: string; sources?: string[] } | null;

  if (!pinMatches(String(body?.pin ?? ""))) {
    const a = pinFails.get(user.id);
    const n = a && a.until > Date.now() ? a.n + 1 : 1;
    pinFails.set(user.id, { n, until: Date.now() + PIN_LOCK_MS });
    return c.json({ error: "wrong PIN" }, 403);
  }
  pinFails.delete(user.id);

  sweepStaleJobs();

  /**
   * ⚠ ONE LIVE JOB AT A TIME. Two concurrent crawls would drive the same
   * browser profile from two processes, and Playwright's persistent context is
   * single-writer — the second one fails in a way that looks like a login
   * problem. Returning the EXISTING job rather than an error also makes a
   * double tap harmless.
   */
  const live = db().query(
    `SELECT * FROM crawl_jobs WHERE status IN ('queued','running') ORDER BY id DESC LIMIT 1`,
  ).get() as any;
  if (live) return c.json({ job: publicJob(live), alreadyRunning: true });

  const sources = (Array.isArray(body?.sources) ? body!.sources : [...AGENT_SOURCES])
    .filter((s): s is AgentSource => (AGENT_SOURCES as readonly string[]).includes(s));
  if (!sources.length) return c.json({ error: "no valid sources" }, 400);

  const r = db().run(
    `INSERT INTO crawl_jobs (status, sources, requested_by, created_at) VALUES ('queued',?,?,?)`,
    [JSON.stringify(sources), user.id, now()],
  );
  const job = db().query("SELECT * FROM crawl_jobs WHERE id=?").get(Number(r.lastInsertRowid)) as any;
  return c.json({ job: publicJob(job) });
}

const publicJob = (r: any) => ({
  id: r.id,
  status: r.status,
  sources: (() => { try { return JSON.parse(r.sources); } catch { return []; } })(),
  createdAt: r.created_at,
  startedAt: r.started_at ?? null,
  finishedAt: r.finished_at ?? null,
  progress: r.progress ?? null,
  result: (() => { try { return r.result ? JSON.parse(r.result) : null; } catch { return null; } })(),
  error: r.error ?? null,
});

/** What the app polls to draw the status. */
export function handleLatestJob(c: Context) {
  if (!currentUser(c)) return c.json({ error: "sign in first" }, 401);
  sweepStaleJobs();
  const row = db().query("SELECT * FROM crawl_jobs ORDER BY id DESC LIMIT 1").get() as any;
  return c.json({
    job: row ? publicJob(row) : null,
    configured: crawlPinConfigured(),
    /**
     * Whether an agent has checked in recently. This is what lets the UI say
     * "your PC is offline, the job will start when it wakes up" instead of
     * spinning — the single most likely reason a tap appears to do nothing.
     */
    agentSeenAt: lastAgentPollAt,
    agentOnline: lastAgentPollAt != null && Date.now() - Date.parse(lastAgentPollAt) < 90_000,
  });
}

// ────────────────────────────────────────────────────────────── the agent

/**
 * ⚠ THE AGENT AUTHENTICATES WITH `FILTRSOFT_PUSH_TOKEN`, NOT A SESSION. It is a
 * headless process on his desktop, not a browser: it has no cookie, and giving
 * it a 60-day user session would put an account credential in a background
 * service. It already needs that token to `push` its results, so this adds no
 * new secret to manage.
 */
let lastAgentPollAt: string | null = null;

function agentAuthorised(c: Context): boolean {
  const want = (process.env.FILTRSOFT_PUSH_TOKEN ?? "").trim();
  if (!want) return false;
  const got = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/** The agent asks for work. Claims the job in the same request. */
export function handleNextJob(c: Context) {
  if (!agentAuthorised(c)) return c.json({ error: "unauthorised" }, 401);
  lastAgentPollAt = now();
  sweepStaleJobs();

  /**
   * ⚠ CLAIM AND READ IN ONE TRANSACTION. Two agents (his desktop and a laptop,
   * or one left running after a restart) polling together would otherwise both
   * read the same queued row and both start a crawl against the same browser
   * profile.
   */
  let claimed: any = null;
  db().transaction(() => {
    const row = db().query(
      "SELECT * FROM crawl_jobs WHERE status='queued' ORDER BY id ASC LIMIT 1").get() as any;
    if (!row) return;
    db().run("UPDATE crawl_jobs SET status='running', started_at=? WHERE id=? AND status='queued'",
      [now(), row.id]);
    claimed = db().query("SELECT * FROM crawl_jobs WHERE id=?").get(row.id);
  })();

  return c.json({ job: claimed ? publicJob(claimed) : null });
}

/** Progress and completion, both from the agent. */
export async function handleJobUpdate(c: Context) {
  if (!agentAuthorised(c)) return c.json({ error: "unauthorised" }, 401);
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "bad id" }, 400);

  const b = await c.req.json().catch(() => null) as
    { progress?: string; status?: string; result?: unknown; error?: string } | null;
  if (!b) return c.json({ error: "bad body" }, 400);

  if (b.status && !["running", "done", "failed"].includes(b.status)) {
    return c.json({ error: "bad status" }, 400);
  }

  db().run(
    `UPDATE crawl_jobs SET
       progress    = COALESCE(?, progress),
       status      = COALESCE(?, status),
       result      = COALESCE(?, result),
       error       = COALESCE(?, error),
       finished_at = CASE WHEN ? IN ('done','failed') THEN ? ELSE finished_at END
     WHERE id = ?`,
    [
      b.progress?.slice(0, 400) ?? null,
      b.status ?? null,
      b.result ? JSON.stringify(b.result).slice(0, 4000) : null,
      b.error?.slice(0, 500) ?? null,
      b.status ?? "", now(), id,
    ],
  );
  const row = db().query("SELECT * FROM crawl_jobs WHERE id=?").get(id) as any;
  return c.json({ job: row ? publicJob(row) : null });
}
