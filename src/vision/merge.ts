/**
 * Turn stored vision output into text the matcher and signal layer can use.
 *
 * Closes the Phase 0 gap directly: the Dedham NZXT listing has no specs in its
 * description, so the engine returned INSUFFICIENT_DATA — while vision had
 * already read "Ryzen 5 9600X / RTX 5070 12GB" off photo 3. The data existed and
 * simply wasn't wired to the verdict.
 */
import { createHash } from "node:crypto";
import { db } from "../db/index.ts";
import type { VisionResult } from "./index.ts";

/**
 * The newest result for this listing. Model and prompt version are optional so
 * `checkStored` (a pure re-score of whatever we have) still works, but the live
 * path always passes them — serving a result from a superseded prompt makes a
 * prompt fix look inert.
 */
export function loadVision(listingId: number, model?: string, promptVersion?: string): VisionResult | null {
  const row = db()
    .query(
      `SELECT payload FROM vision_results
       WHERE listing_id=$id
         AND ($m IS NULL OR model=$m)
         AND ($pv IS NULL OR prompt_version=$pv)
       ORDER BY id DESC LIMIT 1`,
    )
    .get({ $id: listingId, $m: model ?? null, $pv: promptVersion ?? null }) as { payload: string } | null;
  if (!row) return null;
  try { return JSON.parse(row.payload) as VisionResult; } catch { return null; }
}

/** Flatten components and high-confidence facts into matchable text. */
export function visionToText(v: VisionResult | null): string {
  if (!v) return "";
  const parts: string[] = [];
  for (const [k, val] of Object.entries(v.components ?? {})) {
    if (val) parts.push(`${k}: ${val}`);
  }
  for (const f of v.facts ?? []) {
    if (f.confidence === "high") parts.push(f.fact);
  }
  return parts.join("\n");
}

/** Signals derived from vision that the text layer cannot produce. */
export function visionSignals(v: VisionResult | null) {
  const out: Array<{ code: string; severity: "blocker" | "high" | "medium"; evidence: string }> = [];
  if (!v) return out;

  if (v.displayOutputsVisible === false) {
    out.push({
      code: "NO_DISPLAY_OUTPUT", severity: "blocker",
      evidence: "The I/O bracket in the photos carries no display connectors at all. You cannot plug a monitor into this card.",
    });
  }
  if (v.bootScreenOnly) {
    out.push({
      code: "BOOT_SCREEN_ONLY", severity: "high",
      evidence: "Every photo shows the device on a boot or logo screen. That proves it powers on and rules out nothing — activation lock, FRP lock, carrier lock and a failing panel are all still unverified. Ask to see it at the home screen.",
    });
  }
  if (v.screenshotArtifacts) {
    out.push({
      code: "SCREENSHOT_ARTIFACTS", severity: "high",
      evidence: `Photos are screenshots taken from another app rather than original pictures. ${v.screenshotArtifacts}`,
    });
  }
  if (v.portDamage && v.portCondition) {
    out.push({
      code: "PORT_DAMAGE", severity: "high",
      evidence: `Visible damage to ports, hinges or connectors — a FUNCTIONAL defect regardless of how the seller frames it. ${v.portCondition}`,
    });
  }
  for (const dmg of v.physicalDamage ?? []) {
    out.push({ code: "PHYSICAL_DAMAGE", severity: "medium", evidence: dmg });
  }
  return out;
}

/**
 * Content fingerprint of a listing's photos: sorted dhashes, hashed.
 *
 * THE CACHE KEY PROBLEM. Vision results were cached on `listing_id`, which is
 * wrong in both directions at once:
 *
 *   stale  — a seller edits the listing and swaps the photos, and the cache
 *            happily serves the analysis of pictures that are no longer there.
 *   costly — the same graphics card photographed by two different sellers, or
 *            the same listing reposted next week, pays full price every time.
 *
 * Sorted, so photo ORDER changing between crawls is not a cache miss. Hashed
 * rather than stored raw so the key is fixed-width and indexable.
 */
export function photoFingerprint(listingId: number): string | null {
  const rows = db()
    .query(`SELECT phash FROM listing_photos WHERE listing_id=$id AND phash IS NOT NULL`)
    .all({ $id: listingId }) as Array<{ phash: string }>;
  if (!rows.length) return null;
  return fingerprintOf(rows.map((r) => r.phash));
}

export function fingerprintOf(hashes: string[]): string {
  return createHash("sha256").update([...hashes].sort().join(",")).digest("hex").slice(0, 32);
}

/**
 * A cached result for these exact photos, from this exact model and prompt.
 *
 * Model and prompt version are part of the key on purpose: a cache that ignores
 * them keeps serving yesterday's answers after a prompt fix, which makes the fix
 * look like it did nothing and is a genuinely miserable thing to debug.
 */
export function loadVisionByFingerprint(
  fingerprint: string, model: string, promptVersion: string,
): VisionResult | null {
  const row = db()
    .query(
      `SELECT payload FROM vision_results
       WHERE photo_fingerprint=$fp AND model=$m AND prompt_version=$pv
       ORDER BY id DESC LIMIT 1`,
    )
    .get({ $fp: fingerprint, $m: model, $pv: promptVersion }) as { payload: string } | null;
  if (!row) return null;
  try { return JSON.parse(row.payload) as VisionResult; } catch { return null; }
}

/**
 * Are the photos we have on file still the photos the listing shows?
 *
 * Cheap staleness check with NO download: Craigslist image ids change when a
 * seller swaps a picture, so comparing the URL set catches an edited listing
 * before spending bandwidth, let alone money.
 */
export function photosUnchanged(listingId: number, currentUrls: string[]): boolean {
  const rows = db()
    .query(`SELECT url FROM listing_photos WHERE listing_id=$id`)
    .all({ $id: listingId }) as Array<{ url: string }>;
  if (rows.length !== currentUrls.length) return false;
  const have = new Set(rows.map((r) => r.url));
  return currentUrls.every((u) => have.has(u));
}
