/**
 * Spend and abuse protection for the public API.
 *
 * WHY THIS EXISTS, stated plainly: on 2026-08-24 `GET /v1/checks/stream` was
 * public, defaulted vision ON, and had no auth, no rate limit, no quota and no
 * spend ceiling. A single anonymous GET made Assyze fetch a third-party page,
 * download images, and call a paid Anthropic model. I demonstrated it myself
 * against production from an unauthenticated machine — roughly $0.02 of Yish's
 * money per request, in a loop, from anyone who found the URL.
 *
 * It was also a GET performing expensive state-changing work, which means a
 * browser prefetch, a link scanner or a chat-app unfurler could spend money by
 * merely LOOKING at a shared link. That is the part that turns a slow leak into
 * a fast one.
 *
 * Four independent layers, because each fails differently:
 *   1. kill switch    — turn all paid work off in one env var, no deploy
 *   2. vision token   — paid work needs a secret; text checks stay public
 *   3. daily ceiling  — a hard cap even for authorised callers
 *   4. rate + single-flight — bounds free work and de-duplicates paid work
 */
import { db } from "../db/index.ts";

// ---------------------------------------------------------------- 1. switch

/** `ASSYZE_VISION_ENABLED=0` stops all paid work immediately, no redeploy. */
export function visionKilled(): boolean {
  return process.env.ASSYZE_VISION_ENABLED === "0";
}

// ----------------------------------------------------------------- 2. token

/**
 * Paid vision requires a bearer token when `ASSYZE_VISION_TOKEN` is set.
 *
 * DELIBERATE DESIGN: an unauthorised caller is NOT rejected — their check runs
 * on the free text layer and returns a real verdict. The public demo keeps
 * working; it just cannot spend money. Refusing outright would have made the
 * safe fix feel like a regression and invited turning it back off.
 *
 * If the variable is unset, paid vision is refused for anonymous callers rather
 * than allowed. Fail closed: an unset secret must never mean "no security".
 */
export function visionAllowed(authHeader: string | null | undefined): boolean {
  if (visionKilled()) return false;
  const want = process.env.ASSYZE_VISION_TOKEN;
  if (!want) return false;
  if (!authHeader) return false;
  const got = authHeader.replace(/^Bearer\s+/i, "").trim();
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Constant-time compare so a token cannot be recovered byte-by-byte by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// --------------------------------------------------------------- 3. ceiling

/** Dollars of Anthropic spend allowed per UTC day across the whole service. */
export const DAILY_BUDGET_USD = Number(process.env.ASSYZE_DAILY_BUDGET_USD) || 2;

export function spentTodayUsd(): number {
  const r = db()
    .query(
      `SELECT COALESCE(SUM(cost_micros),0) m FROM vision_results
       WHERE created_at >= date('now') || 'T00:00:00.000Z'`,
    )
    .get() as { m: number };
  return r.m / 1e6;
}

export function budgetLeftUsd(): number {
  return Math.max(0, DAILY_BUDGET_USD - spentTodayUsd());
}

/**
 * Is there budget for one more call?
 *
 * Checked BEFORE the call, using the largest plausible single-listing cost
 * rather than an average. A listing with 17 photos cost $0.02 measured; an
 * average-based check would let a run of expensive listings walk past the cap.
 */
const WORST_CASE_CALL_USD = 0.05;
export function budgetAvailable(): boolean {
  return budgetLeftUsd() >= WORST_CASE_CALL_USD;
}

// ------------------------------------------------------- 4. rate + coalesce

interface Bucket { tokens: number; last: number }
const buckets = new Map<string, Bucket>();

/**
 * Token bucket per client. Bounds the FREE work too — every check fetches a
 * Craigslist page, and hammering them from one host is how an IP gets blocked,
 * which would take out the crawler and the tracker as collateral.
 *
 * In-process and therefore per-replica. Railway runs one replica today; the
 * moment that changes this has to move to the database or a shared store, and
 * that is a real limitation rather than an oversight.
 */
export function rateLimit(key: string, perMinute = 20): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const refill = perMinute / 60_000;
  const b = buckets.get(key) ?? { tokens: perMinute, last: now };
  b.tokens = Math.min(perMinute, b.tokens + (now - b.last) * refill);
  b.last = now;

  if (b.tokens < 1) {
    buckets.set(key, b);
    return { ok: false, retryAfter: Math.ceil((1 - b.tokens) / refill / 1000) };
  }
  b.tokens -= 1;
  buckets.set(key, b);

  // Bounded memory: a botnet cycling source addresses must not grow this map
  // without limit. Drop the coldest entries once it gets large.
  if (buckets.size > 5000) {
    const stale = [...buckets.entries()].sort((x, y) => x[1].last - y[1].last).slice(0, 2500);
    for (const [k] of stale) buckets.delete(k);
  }
  return { ok: true, retryAfter: 0 };
}

const inflight = new Map<string, Promise<unknown>>();

/**
 * One execution per key while it is running; concurrent callers share it.
 *
 * Twenty simultaneous requests for the same listing become ONE source fetch and
 * ONE vision call. Without this, a link posted somewhere busy multiplies cost by
 * however many people click it at once.
 */
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Best-effort client identity behind Railway's proxy. */
export function clientKey(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}

export function guardStatus() {
  return {
    visionEnabled: !visionKilled(),
    tokenRequired: Boolean(process.env.ASSYZE_VISION_TOKEN),
    dailyBudgetUsd: DAILY_BUDGET_USD,
    spentTodayUsd: Number(spentTodayUsd().toFixed(4)),
    budgetLeftUsd: Number(budgetLeftUsd().toFixed(4)),
  };
}
