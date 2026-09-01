/**
 * Yish's own call, overriding the engine's.
 *
 * *"I noticed some scams were labelled as verify first, so I want there to be
 * an option for me to manually change the label of things in the app so I can
 * manually change them to risky."* — 2026-08-31, after a seller running two
 * listings at once sent him the same scripted message on both.
 *
 * ── THE THREE DECISIONS THAT MATTER ────────────────────────────────────────
 *
 * ⚠ **SCOPED TO A DEVICE REF, NOT GLOBAL.** assyze.com is public and this is an
 * unauthenticated write. Global overrides would let anyone relabel a scam as a
 * buy for everybody. `deviceRef()` already exists in the web app — a random
 * uuid minted once per browser for Stripe — so an override belongs to whoever
 * made it, with no login and no token typed into a form.
 *
 * ⚠ **A SEPARATE TABLE, NEVER AN UPDATE TO `verdicts`.** `reverdictAll`
 * rewrites that table on every engine bump, so an override stored there would
 * be erased by the next deploy — and an erased override is worse than none,
 * because the listing silently goes back to looking safe.
 *
 * ⚠ **APPLIED AT READ TIME, INCLUDING TO THE SEGMENT COUNTS.** A relabelled
 * listing has to leave the segment it was in and join the one he chose,
 * everywhere — feed rows, counts and pagination. Applying it only to the card
 * would leave "Risky 25" beside a list of 26, which is the exact class of lie
 * `segmentCounts`' invariant exists to prevent.
 */
import { db } from "../db/index.ts";
import type { Context } from "hono";

/** The engine's own vocabulary. An override may only say something it could. */
export const OVERRIDE_CALLS = [
  "BUY", "VERIFY", "RISK", "FAIR", "PASS", "INSUFFICIENT_DATA",
] as const;

/** A device ref is opaque to us; bound only so it cannot be used as a payload. */
const okRef = (r: unknown): r is string =>
  typeof r === "string" && /^[a-z0-9]{8,64}$/i.test(r);

export type OverrideMap = Map<number, { call: string; note: string | null }>;

/**
 * Every override this device has made. One query per request rather than one
 * per row — the feed ranks hundreds of listings and a per-row lookup there is
 * how a page turns into hundreds of statements.
 */
export function loadOverrides(ref: string | undefined | null): OverrideMap {
  const out: OverrideMap = new Map();
  if (!okRef(ref)) return out;
  const rows = db()
    .query("SELECT listing_id, call, note FROM verdict_overrides WHERE device_ref=$r")
    .all({ $r: ref }) as Array<{ listing_id: number; call: string; note: string | null }>;
  for (const r of rows) out.set(r.listing_id, { call: r.call, note: r.note });
  return out;
}

/**
 * Rewrite a row's call in place.
 *
 * ⚠ IT MUST STAY VISIBLE THAT A HUMAN DID THIS. `overriddenFrom` carries what
 * the engine said, so the card and the detail can show "you marked this" rather
 * than quietly presenting his judgement as the engine's. An override that looks
 * like an engine call is how you forget which listings you have actually
 * checked yourself.
 */
export function applyOverride<T extends { id: number; call: string }>(
  row: T, overrides: OverrideMap,
): T & { overriddenFrom?: string; overrideNote?: string | null } {
  const o = overrides.get(row.id);
  if (!o || o.call === row.call) return row;
  return { ...row, call: o.call, overriddenFrom: row.call, overrideNote: o.note };
}

/** `POST /v1/checks/:id/override` — `{ ref, call, note? }`. */
export async function handleSetOverride(c: Context) {
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({})) as {
    ref?: string; call?: string; note?: string;
  };
  if (!okRef(body.ref)) return c.json({ error: "a device ref is required" }, 400);
  if (!body.call || !(OVERRIDE_CALLS as readonly string[]).includes(body.call)) {
    return c.json({ error: `call must be one of ${OVERRIDE_CALLS.join(", ")}` }, 400);
  }
  const listing = db().query("SELECT id FROM listings WHERE id=$id").get({ $id: id });
  if (!listing) return c.json({ error: "not found" }, 404);

  db().query(
    `INSERT INTO verdict_overrides (device_ref, listing_id, call, note, created_at)
     VALUES ($r,$id,$c,$n,$at)
     ON CONFLICT(device_ref, listing_id) DO UPDATE SET
       call=excluded.call, note=excluded.note, created_at=excluded.created_at`,
  ).run({
    $r: body.ref, $id: id, $c: body.call,
    $n: (body.note ?? "").slice(0, 300) || null,
    $at: new Date().toISOString(),
  });
  return c.json({ ok: true, call: body.call });
}

/** `DELETE /v1/checks/:id/override?ref=…` — back to whatever the engine says. */
export function handleClearOverride(c: Context) {
  const id = Number(c.req.param("id"));
  const ref = c.req.query("ref");
  if (!okRef(ref)) return c.json({ error: "a device ref is required" }, 400);
  db().query("DELETE FROM verdict_overrides WHERE device_ref=$r AND listing_id=$id")
    .run({ $r: ref, $id: id });
  return c.json({ ok: true });
}
