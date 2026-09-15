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
import { z } from "zod";

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

export function sweepStaleJobs(at = Date.now()) {
  const d = db();
  d.run(
    `UPDATE crawl_jobs SET status='expired', finished_at=?, error='no agent picked this up in time'
      WHERE status='queued' AND created_at < ?`,
    [new Date(at).toISOString(), new Date(at-JOB_TTL_MIN*60_000).toISOString()],
  );
  d.run(
    `UPDATE crawl_jobs SET status='failed', finished_at=?, error='the agent stopped reporting'
      WHERE status='running' AND COALESCE(heartbeat_at, started_at, created_at) < ?`,
    [new Date(at).toISOString(), new Date(at-RUNNING_TIMEOUT_MIN*60_000).toISOString()],
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
    agentSeenAt: agentSeenAt(),
    agentOnline: agentOnline(),
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
export function agentSeenAt():string|null {
  return (db().query("SELECT MAX(seen_at) at FROM agent_presence").get() as {at:string|null}).at;
}
const agentOnline=()=>{const at=agentSeenAt();return at!==null && Date.now()-Date.parse(at)<90_000;};
function agentId(c:Context):string {return (c.req.header('x-filtrsoft-agent')??'legacy').slice(0,100);}
function touchAgent(c:Context,jobId:number|null=null) {
  db().run("INSERT INTO agent_presence VALUES(?,?,?) ON CONFLICT(agent_id) DO UPDATE SET seen_at=excluded.seen_at,job_id=excluded.job_id",[agentId(c),now(),jobId]);
  const revision=(c.req.header('x-filtrsoft-agent-version')??'legacy').slice(0,64);
  db().run(`INSERT INTO agent_versions VALUES(?,?,?) ON CONFLICT(agent_id) DO UPDATE SET
    revision=CASE WHEN excluded.revision='legacy' THEN agent_versions.revision ELSE excluded.revision END,seen_at=excluded.seen_at`,[agentId(c),revision,now()]);
}

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
  touchAgent(c);
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
    db().run("UPDATE crawl_jobs SET status='running', started_at=?,heartbeat_at=?,agent_id=? WHERE id=? AND status='queued'",
      [now(),now(),agentId(c), row.id]);
    claimed = db().query("SELECT * FROM crawl_jobs WHERE id=?").get(row.id);
  })();

  return c.json({ job: claimed ? publicJob(claimed) : null });
}

/** Progress and completion, both from the agent. */
export async function handleJobUpdate(c: Context) {
  if (!agentAuthorised(c)) return c.json({ error: "unauthorised" }, 401);
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "bad id" }, 400);

  const parsed=z.object({progress:z.string().max(400).optional(),status:z.enum(['running','done','failed']).optional(),
    result:z.record(z.string(),z.string().max(1000)).optional(),error:z.string().max(500).optional(),
    stage:z.object({name:z.string().min(1).max(100),status:z.enum(['running','done','failed']),error:z.string().max(500).optional()}).optional()
  }).safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success) return c.json({error:'bad body'},400);
  const b=parsed.data;
  const current=db().query("SELECT * FROM crawl_jobs WHERE id=?").get(id) as any;
  if(!current) return c.json({error:'job not found'},404);
  if((current.agent_id??'legacy')!==agentId(c)) return c.json({error:'job belongs to another agent'},409);
  if(current.status!=='running') {
    if(b.status===current.status && ['done','failed'].includes(current.status)
      && (!b.result || JSON.stringify(b.result)===current.result)) return c.json({job:publicJob(current)});
    return c.json({error:'job is already terminal'},409);
  }
  touchAgent(c,id);

  if (b.status && !["running", "done", "failed"].includes(b.status)) {
    return c.json({ error: "bad status" }, 400);
  }

  const accepted=db().transaction(()=>{
  const changed=db().run(
    `UPDATE crawl_jobs SET
       progress    = COALESCE(?, progress),
       status      = COALESCE(?, status),
       result      = COALESCE(?, result),
       error       = COALESCE(?, error),
       finished_at = CASE WHEN ? IN ('done','failed') THEN ? ELSE finished_at END
     WHERE id = ? AND status='running' AND COALESCE(agent_id,'legacy')=?`,
    [
      b.progress?.slice(0, 400) ?? null,
      b.status ?? null,
      b.result ? JSON.stringify(b.result).slice(0, 4000) : null,
      b.error?.slice(0, 500) ?? null,
      b.status ?? "", now(), id,agentId(c),
    ],
  );
  if(!changed.changes)return false;
  db().run("UPDATE crawl_jobs SET heartbeat_at=? WHERE id=?",[now(),id]);
  if(b.stage) db().run(`INSERT INTO crawl_job_stages VALUES(?,?,?,?,?,?) ON CONFLICT(job_id,stage) DO UPDATE SET
    status=excluded.status,finished_at=excluded.finished_at,error=excluded.error`,
    [id,b.stage.name,b.stage.status,now(),b.stage.status==='running'?null:now(),b.stage.error??null]);
    return true;
  })();
  if(!accepted)return c.json({error:"job changed during update"},409);
  const row = db().query("SELECT * FROM crawl_jobs WHERE id=?").get(id) as any;
  return c.json({ job: row ? publicJob(row) : null });
}

// ────────────────────────────────────────────── crawling without being asked

/**
 * How often a crawl starts BY ITSELF while his PC is on.
 *
 * Yish, 2026-09-04: *"if I have to even think to crawl then that adds friction
 * to the automation of the app because it should be sending me an alert as soon
 * as the listing is up."*
 *
 * He is right, and the button was never the goal — it was the piece that made
 * crawling possible at all from a phone. A feature you must remember to press
 * is a feature that runs when you are already thinking about deals, which is
 * exactly when it is least useful.
 */
const AUTO_CRAWL_MIN = Number(process.env.FILTRSOFT_AUTO_CRAWL_MIN ?? 45);

/** The agent has to have checked in this recently for a queued job to mean anything. */
const AGENT_FRESH_MS = 120_000;

export function autoCrawlStatus() {
  return {
    everyMinutes: AUTO_CRAWL_MIN,
    agentOnline: agentOnline(),
    lastAgentPollAt: agentSeenAt(),
    collectors: db().query(`SELECT p.seen_at AS seenAt,p.job_id AS jobId,COALESCE(v.revision,'legacy') AS revision
      FROM agent_presence p LEFT JOIN agent_versions v ON v.agent_id=p.agent_id
      WHERE p.seen_at >= ? ORDER BY p.seen_at DESC LIMIT 10`).all(new Date(Date.now()-86400000).toISOString()),
  };
}

/** Narrow collector diagnostics: aggregates only, no user accounts, browsing
 * history, listing bodies or credentials. Does not mark an agent online or claim work. */
export function handleAgentDiagnostics(c:Context) {
  if(!agentAuthorised(c))return c.json({error:'unauthorised'},401);
  const day=new Date(Date.now()-86400000).toISOString(),week=new Date(Date.now()-7*86400000).toISOString();
  const arrivals=db().query(`SELECT source,COUNT(*) total,MAX(captured_at) newestCapture,MAX(last_seen) newestSeen,
    SUM(CASE WHEN captured_at>=? THEN 1 ELSE 0 END) captured24h,
    SUM(CASE WHEN captured_at>=? THEN 1 ELSE 0 END) captured7d FROM listings GROUP BY source`).all(day,week);
  const recentCalls=db().query(`SELECT l.source,COALESCE(v.call,'UNSCORED') call,COUNT(*) count
    FROM listings l LEFT JOIN verdicts v ON v.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id)
    WHERE l.captured_at>=? AND l.delisted_at IS NULL GROUP BY l.source,v.call`).all(week);
  const latestServerCrawls=db().query('SELECT started_at,discovered,analysed,failed FROM crawls ORDER BY id DESC LIMIT 5').all();
  return c.json({at:now(),arrivals,recentCalls,latestServerCrawls,
    serverCrawlEnabled:(process.env.FILTRSOFT_CRAWL??'on').toLowerCase()!=='off',collection:autoCrawlStatus()});
}

/**
 * Queue a crawl if his PC is on, nothing is already running, and it has been a
 * while.
 *
 * ⚠ IT ONLY QUEUES WHILE AN AGENT IS ACTUALLY POLLING, and that condition is
 * what makes this safe to run on a loop. Queuing into the void would build a
 * pile of jobs that all fire at once the next time his machine boots — three
 * simultaneous crawls against one browser profile, which Playwright's
 * persistent context cannot serve and which surfaces as a login error. The TTL
 * sweep would eventually expire them, but "eventually" is not a design.
 *
 * ⚠ AND IT DOES NOT NEED THE PIN. The PIN authenticates a HUMAN asking for a
 * crawl from a phone that might not be his. This is the server talking to its
 * own agent, both sides already authenticated by `FILTRSOFT_PUSH_TOKEN`; asking
 * it for a four-digit code would be theatre.
 */
export function autoQueueCrawl(log: (m: string) => void = () => {}): boolean {
  if (AUTO_CRAWL_MIN <= 0) return false;
  const lastAgentPollAt=agentSeenAt();
  if (lastAgentPollAt == null) return false;
  if (Date.now() - Date.parse(lastAgentPollAt) > AGENT_FRESH_MS) return false;

  sweepStaleJobs();

  const live = db().query(
    "SELECT id FROM crawl_jobs WHERE status IN ('queued','running') LIMIT 1",
  ).get();
  if (live) return false;

  /**
   * Measured from when the last job FINISHED, not when it started. A crawl that
   * takes eleven minutes should not be followed four minutes later just because
   * the interval is counted from the wrong end.
   */
  const last = db().query(
    `SELECT COALESCE(finished_at, created_at) t FROM crawl_jobs ORDER BY id DESC LIMIT 1`,
  ).get() as { t: string } | null;
  if (last && Date.now() - Date.parse(last.t) < AUTO_CRAWL_MIN * 60_000) return false;

  db().run(
    `INSERT INTO crawl_jobs (status, sources, requested_by, created_at) VALUES ('queued',?,NULL,?)`,
    [JSON.stringify([...AGENT_SOURCES]), now()],
  );
  log(`auto-queued a crawl (${AGENT_SOURCES.join(", ")}) — his PC is online`);
  return true;
}
