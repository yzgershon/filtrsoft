/**
 * Turn stored vision output into text the matcher and signal layer can use.
 *
 * Closes the Phase 0 gap directly: the Dedham NZXT listing has no specs in its
 * description, so the engine returned INSUFFICIENT_DATA — while vision had
 * already read "Ryzen 5 9600X / RTX 5070 12GB" off photo 3. The data existed and
 * simply wasn't wired to the verdict.
 */
import { db } from "../db/index.ts";
import type { VisionResult } from "./index.ts";

export function loadVision(listingId: number): VisionResult | null {
  const row = db()
    .query(`SELECT payload FROM vision_results WHERE listing_id=$id ORDER BY id DESC LIMIT 1`)
    .get({ $id: listingId }) as { payload: string } | null;
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
