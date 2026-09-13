/**
 * Store only verdict history that carries new information.
 *
 * A re-score used to append even when call, confidence and payload were byte-for-
 * byte identical. With frequent engine bumps that produced 12,291 rows for 936
 * listings; 9,212 rows were consecutive duplicates and no reader used anything
 * except MAX(id).
 *
 * Identical answers at the same engine revision are deduplicated so
 * repeated work does not grow history. A different revision is immutable history. If any part
 * of the answer changed, append it: transitions are useful history, repetition is
 * not.
 */
import { db, now } from "./index.ts";
import type { Database } from "bun:sqlite";

/**
 * What this layer needs from a verdict: the two columns it indexes, and the
 * whole object to serialise.
 *
 * ⚠ THE INDEX SIGNATURE IS GONE. `[key: string]: unknown` made this
 * structurally incompatible with `VerdictResult` — an interface with declared
 * properties has no implicit index signature, so EVERY real caller
 * (`engine`, `scheduler`, `push`, `verdict.ts`) failed to typecheck against the
 * very type they were meant to satisfy. Five errors from one line that was
 * trying to say "and anything else".
 */
export interface VerdictPayload {
  call: string;
  confidence?: string | null;
}

export interface StoreVerdictResult {
  inserted: boolean;
  refreshed: boolean;
  id: number;
}

/** A global hourly expiry tick is a reason to recompute, not a new answer.
 * Keep the first persisted revision as provenance when every actual fact,
 * selected comp, risk, value and economic input is unchanged. September 13's
 * 4.42 GB production database exposed the timestamp defeating exact dedupe.
 * Only this scheduling marker is ignored; no seller evidence is normalized. */
function decisionContent(payload:string):string {
  try {
    const value=JSON.parse(payload);
    if(value?.provenance && typeof value.provenance==='object')delete value.provenance.dataRevision;
    return JSON.stringify(value);
  }catch{return payload;}
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
      latest.confidence === confidence && (latest.payload === payload || decisionContent(latest.payload)===decisionContent(payload))) {
    if(latest.engine_version===engineVersion)return {inserted:false,refreshed:false,id:latest.id};
    // An engine revision is historical evidence once a label references it.
    // Append rather than rewriting its version and timestamp under that label.
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
