/**
 * Hard spending caps for paid model calls, safe across concurrent requests and
 * separate processes that share one SQLite file.
 *
 * Every call reserves its worst-case cost BEFORE it is sent, inside an
 * IMMEDIATE transaction, so two callers can never both see the same remaining
 * balance. A reservation counts at its full amount until usage settles it. If
 * a call fails after it may have reached the provider, the reservation is kept
 * as `uncertain` rather than released: an unknown charge is assumed spent.
 *
 * A cap is an owner decision. `setCap` refuses to change an existing cap
 * unless the caller records who approved the change.
 */
import type { Database } from "bun:sqlite";

export type CapWindow = "total" | "utc-day";
export type SpendStatus = "reserved" | "settled" | "uncertain" | "released";

export class BudgetRefused extends Error {
  constructor(readonly scope: string, readonly committedMicros: number, readonly requestedMicros: number, readonly capMicros: number) {
    super(`budget ${scope}: ${committedMicros}+${requestedMicros} micro-USD would exceed cap ${capMicros}`);
  }
}

export function ensureSpendSchema(d: Database): void {
  d.run(`CREATE TABLE IF NOT EXISTS ai_budget_caps (
    scope TEXT PRIMARY KEY,
    cap_micros INTEGER NOT NULL CHECK (cap_micros >= 0),
    cap_window TEXT NOT NULL CHECK (cap_window IN ('total','utc-day')),
    approval TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  d.run(`CREATE TABLE IF NOT EXISTS ai_spend (
    id INTEGER PRIMARY KEY,
    scope TEXT NOT NULL REFERENCES ai_budget_caps(scope),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    purpose TEXT NOT NULL,
    reserved_micros INTEGER NOT NULL CHECK (reserved_micros > 0),
    actual_micros INTEGER,
    status TEXT NOT NULL CHECK (status IN ('reserved','settled','uncertain','released')),
    detail TEXT,
    created_at TEXT NOT NULL,
    settled_at TEXT
  )`);
  d.run(`CREATE INDEX IF NOT EXISTS ai_spend_scope_time ON ai_spend(scope, created_at)`);
}

export function setCap(d: Database, scope: string, capMicros: number, window: CapWindow, approval: string, at = new Date().toISOString()): void {
  if (!Number.isSafeInteger(capMicros) || capMicros < 0) throw new Error("cap must be a non-negative integer of micro-USD");
  if (!approval.trim()) throw new Error("a cap records who approved it");
  ensureSpendSchema(d);
  d.transaction(() => {
    const old = d.query(`SELECT cap_micros, cap_window AS window FROM ai_budget_caps WHERE scope=?`).get(scope) as { cap_micros: number; window: string } | null;
    if (old && (old.cap_micros !== capMicros || old.window !== window))
      throw new Error(`budget ${scope} already has cap ${old.cap_micros} (${old.window}); use changeCap with a new approval`);
    if (!old) d.query(`INSERT INTO ai_budget_caps (scope, cap_micros, cap_window, approval, updated_at) VALUES (?,?,?,?,?)`).run(scope, capMicros, window, approval, at);
  }).immediate();
}

/** Explicit, recorded change of an owner-approved cap. Never called automatically. */
export function changeCap(d: Database, scope: string, capMicros: number, approval: string, at = new Date().toISOString()): void {
  if (!Number.isSafeInteger(capMicros) || capMicros < 0) throw new Error("cap must be a non-negative integer of micro-USD");
  if (!approval.trim()) throw new Error("a cap change records who approved it");
  const changed = d.query(`UPDATE ai_budget_caps SET cap_micros=?, approval=approval || char(10) || ?, updated_at=? WHERE scope=?`).run(capMicros, approval, at, scope);
  if (changed.changes !== 1) throw new Error(`unknown budget ${scope}`);
}

function windowStart(window: CapWindow, at: string): string {
  if (window === "total") return "";
  const t = new Date(at);
  if (!Number.isFinite(t.getTime())) throw new Error(`invalid timestamp ${at}`);
  return `${t.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

function capFor(d: Database, scope: string): { cap_micros: number; window: CapWindow } {
  const cap = d.query(`SELECT cap_micros, cap_window AS window FROM ai_budget_caps WHERE scope=?`).get(scope) as { cap_micros: number; window: CapWindow } | null;
  if (!cap) throw new Error(`no approved cap for ${scope}; paid calls are refused`);
  return cap;
}

/** Micro-USD committed in the current window: settled actuals plus every unsettled or uncertain reservation. */
export function committedMicros(d: Database, scope: string, at = new Date().toISOString()): number {
  const cap = capFor(d, scope);
  const row = d.query(`SELECT COALESCE(SUM(CASE status
      WHEN 'settled' THEN actual_micros
      WHEN 'released' THEN 0
      ELSE reserved_micros END),0) AS micros
    FROM ai_spend WHERE scope=? AND created_at >= ?`).get(scope, windowStart(cap.window, at)) as { micros: number };
  return Number(row.micros) || 0;
}

export type Reservation = { id: number; scope: string; reservedMicros: number };

export function reserve(d: Database, scope: string, reservedMicros: number, meta: { provider: string; model: string; purpose: string; detail?: unknown }, at = new Date().toISOString()): Reservation {
  const micros = Math.ceil(reservedMicros);
  if (!(micros > 0)) throw new Error("reservation must be positive");
  return d.transaction(() => {
    const cap = capFor(d, scope), committed = committedMicros(d, scope, at);
    if (committed + micros > cap.cap_micros) throw new BudgetRefused(scope, committed, micros, cap.cap_micros);
    const row = d.query(`INSERT INTO ai_spend (scope, provider, model, purpose, reserved_micros, status, detail, created_at)
      VALUES (?,?,?,?,?,'reserved',?,?) RETURNING id`).get(scope, meta.provider, meta.model, meta.purpose, micros,
      meta.detail === undefined ? null : JSON.stringify(meta.detail), at) as { id: number };
    return { id: row.id, scope, reservedMicros: micros };
  }).immediate();
}

/**
 * Settle a reservation at its measured cost. An actual cost above the
 * reservation is recorded truthfully (it was spent) and reported to the
 * caller, which must stop: the reservation bound was wrong.
 */
export function settle(d: Database, id: number, actualMicros: number, detail?: unknown, at = new Date().toISOString()): { overrun: boolean } {
  const actual = Math.ceil(actualMicros);
  if (!(actual >= 0)) throw new Error("actual cost must be non-negative");
  const row = d.query(`SELECT reserved_micros, status FROM ai_spend WHERE id=?`).get(id) as { reserved_micros: number; status: SpendStatus } | null;
  if (!row) throw new Error(`unknown reservation ${id}`);
  if (row.status !== "reserved") throw new Error(`reservation ${id} is already ${row.status}`);
  d.query(`UPDATE ai_spend SET actual_micros=?, status='settled', settled_at=?, detail=COALESCE(?, detail) WHERE id=?`)
    .run(actual, at, detail === undefined ? null : JSON.stringify(detail), id);
  return { overrun: actual > row.reserved_micros };
}

/** The request may have been billed but no usage is known: keep the full reservation. */
export function markUncertain(d: Database, id: number, reason: string, at = new Date().toISOString()): void {
  d.query(`UPDATE ai_spend SET status='uncertain', settled_at=?, detail=json_set(COALESCE(detail,'{}'),'$.outcome',?) WHERE id=? AND status='reserved'`)
    .run(at, reason.slice(0, 500), id);
}

/**
 * Only for a request that never left this process, or that the provider
 * provably refused before processing (a 429 rate-limit rejection is not billed).
 */
export function release(d: Database, id: number, reason: string, at = new Date().toISOString()): void {
  d.query(`UPDATE ai_spend SET status='released', actual_micros=0, settled_at=?, detail=json_set(COALESCE(detail,'{}'),'$.outcome',?) WHERE id=? AND status='reserved'`)
    .run(at, reason.slice(0, 500), id);
}

export function spendSummary(d: Database, scope: string, at = new Date().toISOString()) {
  const cap = capFor(d, scope);
  const counts = d.query(`SELECT status, COUNT(*) AS n, COALESCE(SUM(reserved_micros),0) AS reserved, COALESCE(SUM(actual_micros),0) AS actual
    FROM ai_spend WHERE scope=? AND created_at >= ? GROUP BY status`).all(scope, windowStart(cap.window, at)) as { status: SpendStatus; n: number; reserved: number; actual: number }[];
  const committed = committedMicros(d, scope, at);
  return { scope, window: cap.window, capMicros: cap.cap_micros, committedMicros: committed, remainingMicros: Math.max(0, cap.cap_micros - committed), byStatus: counts };
}
