/**
 * Store only verdict history that carries new information.
 *
 * A re-score used to append even when call, confidence and payload were byte-for-
 * byte identical. With frequent engine bumps that produced 12,291 rows for 936
 * listings; 9,212 rows were consecutive duplicates and no reader used anything
 * except MAX(id).
 *
 * If the answer is unchanged, update the latest row's engine version in place so
 * `reverdictStale()` knows the listing was evaluated by current code. If any part
 * of the answer changed, append it: transitions are useful history, repetition is
 * not.
 */
import { db, now } from "./index.ts";
import type { Database } from "bun:sqlite";

export interface VerdictPayload {
  call: string;
  confidence?: string | null;
  [key: string]: unknown;
}

export interface StoreVerdictResult {
  inserted: boolean;
  refreshed: boolean;
  id: number;
}

export function storeVerdict(
  listingId: number,
  engineVersion: string,
  verdict: VerdictPayload,
  createdAt = now(),
): StoreVerdictResult {
  return storeVerdictWithDb(db(), listingId, engineVersion, verdict, createdAt);
}

/** Database-injected core, used by the regression suite with SQLite in memory. */
export function storeVerdictWithDb(
  d: Database,
  listingId: number,
  engineVersion: string,
  verdict: VerdictPayload,
  createdAt: string,
): StoreVerdictResult {
  const payload = JSON.stringify(verdict);
  const confidence = verdict.confidence ?? null;
  const latest = d.query(
    `SELECT id, engine_version, call, confidence, payload
       FROM verdicts WHERE listing_id=$id ORDER BY id DESC LIMIT 1`,
  ).get({ $id: listingId }) as {
    id: number;
    engine_version: string;
    call: string;
    confidence: string | null;
    payload: string;
  } | null;

  if (latest && latest.call === verdict.call &&
      latest.confidence === confidence && latest.payload === payload) {
    if (latest.engine_version !== engineVersion) {
      d.query(
        `UPDATE verdicts SET engine_version=$v, created_at=$now WHERE id=$id`,
      ).run({ $v: engineVersion, $now: createdAt, $id: latest.id });
      return { inserted: false, refreshed: true, id: latest.id };
    }
    return { inserted: false, refreshed: false, id: latest.id };
  }

  const r = d.query(
    `INSERT INTO verdicts (listing_id, engine_version, call, confidence, payload, created_at)
     VALUES ($lid,$v,$call,$conf,$p,$now)`,
  ).run({
    $lid: listingId,
    $v: engineVersion,
    $call: verdict.call,
    $conf: confidence,
    $p: payload,
    $now: createdAt,
  });
  return { inserted: true, refreshed: false, id: Number(r.lastInsertRowid) };
}
