/** Atomic daily spend accounting at the paid Anthropic boundary. */
import type { Database } from "bun:sqlite";
import { db, now } from "../db/index.ts";

const configuredBudget = Number(process.env.FILTRSOFT_DAILY_BUDGET_USD);

/** Dollars of Anthropic spend allowed per UTC day across the whole service. */
export const DAILY_BUDGET_USD =
  Number.isFinite(configuredBudget) && configuredBudget >= 0 ? configuredBudget : 2;
export const DAILY_BUDGET_MICROS = Math.floor(DAILY_BUDGET_USD * 1e6);

/** `FILTRSOFT_VISION_ENABLED=0` stops all paid work immediately, no redeploy. */
export function visionKilled(): boolean {
  return process.env.FILTRSOFT_VISION_ENABLED === "0";
}

/**
 * Reserve the theoretical cost before a request starts.
 *
 * Haiku 4.5 is pinned at $1/M input and $5/M output. Each image is capped at
 * 1,568 visual tokens and output at 16k; 20k input tokens leaves ample room for
 * the prompt, schema and labels. The 300k ceiling also covers the model's full
 * 200k context at this price. This is deliberately much larger than the
 * measured ~$0.003 call: reservations are released down to actual cost as soon
 * as a response arrives, while concurrent requests must be safe at their max.
 */
export const MAX_VISION_RESERVATION_MICROS = 300_000;
export function visionReservationMicros(photoCount: number): number {
  const photos = Math.max(1, Math.min(100, Math.floor(photoCount)));
  return Math.min(MAX_VISION_RESERVATION_MICROS, 100_000 + photos * 1_568);
}
export const MIN_VISION_RESERVATION_MICROS = visionReservationMicros(1);

function utcDayStart(at: string): string {
  const parsed = new Date(at);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`invalid budget timestamp: ${at}`);
  return `${parsed.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

/**
 * Count old unlinked result costs plus the new reservation ledger.
 *
 * Linked result rows are excluded because their actual cost already lives in
 * `vision_spend`. An unsettled reservation counts at its maximum: the process
 * may have died after Anthropic accepted the request but before usage arrived.
 */
export function spentVisionMicrosWithDb(d: Database, at = now()): number {
  const row = d.query(`
    SELECT
      (SELECT COALESCE(SUM(cost_micros),0)
         FROM vision_results
        WHERE budget_reservation_id IS NULL AND created_at >= $start)
      +
      (SELECT COALESCE(SUM(
         CASE WHEN settled_at IS NULL THEN reserved_micros
              ELSE COALESCE(actual_micros, reserved_micros) END
       ),0)
         FROM vision_spend
        WHERE created_at >= $start) AS micros
  `).get({ $start: utcDayStart(at) }) as { micros: number };
  return Number(row.micros) || 0;
}

export function spentVisionMicros(at = now()): number {
  return spentVisionMicrosWithDb(db(), at);
}

export function spentTodayUsd(): number {
  return spentVisionMicros() / 1e6;
}

export function budgetLeftUsd(): number {
  return Math.max(0, DAILY_BUDGET_USD - spentTodayUsd());
}

/** Coarse caller gate. The reservation below is the authoritative gate. */
export function budgetAvailable(): boolean {
  return DAILY_BUDGET_MICROS - spentVisionMicros() >= MIN_VISION_RESERVATION_MICROS;
}

/**
 * Reserve inside one SQLite transaction so different URLs arriving together
 * cannot all observe the same remaining balance and overshoot it.
 */
export function reserveVisionBudgetWithDb(
  d: Database,
  reservedMicros: number,
  budgetMicros = DAILY_BUDGET_MICROS,
  at = now(),
): number | null {
  const reserve = Math.max(1, Math.round(reservedMicros));
  const reserveTransaction = d.transaction(() => {
    if (spentVisionMicrosWithDb(d, at) + reserve > budgetMicros) return null;
    const row = d.query(`
      INSERT INTO vision_spend (reserved_micros, actual_micros, created_at, settled_at)
      VALUES ($reserved,NULL,$at,NULL)
      RETURNING id
    `).get({ $reserved: reserve, $at: at }) as { id: number };
    return row.id;
  });
  // Acquire the write lock before reading the balance. This matters if a manual
  // script and the API use the same volume from separate processes.
  return reserveTransaction.immediate();
}

export function reserveVisionBudget(reservedMicros: number): number | null {
  if (visionKilled()) return null;
  return reserveVisionBudgetWithDb(db(), reservedMicros);
}

export function settleVisionBudgetWithDb(
  d: Database,
  reservationId: number,
  actualMicros: number,
  at = now(),
): void {
  d.query(`
    UPDATE vision_spend
       SET actual_micros=$actual, settled_at=$at
     WHERE id=$id AND settled_at IS NULL
  `).run({ $actual: Math.max(0, Math.round(actualMicros)), $at: at, $id: reservationId });
}

export function settleVisionBudget(reservationId: number, actualMicros: number): void {
  settleVisionBudgetWithDb(db(), reservationId, actualMicros);
}
