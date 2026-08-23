/**
 * Vision layer — photos to structured facts.
 *
 * Runs through headless Claude Code (`claude -p`), which bills against the
 * subscription rather than the API. Free for Phase 1; swap for the Anthropic SDK
 * when this becomes a server responding to real users.
 *
 * THE RULE: every photo, every time. The Phase 0 miss was a skipped third image
 * that contained the entire spec sheet. The funnel may drop LISTINGS at any
 * stage; once a listing reaches vision it must never drop PHOTOS.
 *
 * The prompt is derived directly from RISK-MODEL.md — it asks for exactly the
 * things that change a verdict, not a general description.
 */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PHOTO_DIR } from "../photos/index.ts";

export interface VisionFact {
  fact: string;
  photo: string;
  confidence: "high" | "medium" | "low";
}

export interface VisionResult {
  components: Record<string, string | null>;
  facts: VisionFact[];
  specScreens: string[];
  lockScreen: boolean;
  bootScreenOnly: boolean;
  screenshotArtifacts: string | null;
  displayOutputsVisible: boolean | null;
  portCondition: string | null;
  portDamage: boolean;
  physicalDamage: string[];
  unreadable: string[];
  raw?: string;
}

const PROMPT = (files: string[]) => `You are inspecting a used-tech marketplace listing. Read ALL ${files.length} images:
${files.map((f, i) => `  ${i}: ${f}`).join("\n")}

Report ONLY what is visibly present. Never infer from the filename or guess a plausible model.
If an image is too blurry or dark to read, say so rather than guessing.

Return ONE json object, no markdown fence, no commentary:

{
  "components": { "cpu": null, "gpu": null, "ram": null, "storage": null, "motherboard": null, "psu": null, "model": null, "storage_tier": null },
  "facts": [ { "fact": "MSI RTX 3050 Gaming X sticker on card edge", "photo": "2", "confidence": "high" } ],
  "specScreens": ["3"],
  "lockScreen": false,
  "bootScreenOnly": false,
  "screenshotArtifacts": null,
  "displayOutputsVisible": null,
  "portCondition": null,
  "portDamage": false,
  "physicalDamage": [],
  "unreadable": []
}

Field rules:
- components: exact models only where legible. null when not shown. "model" is for whole devices (phones, laptops); "storage_tier" for phone/tablet capacity.
- specScreens: photo indices showing a spec readout (Windows System>About, Task Manager, HWiNFO, iOS Settings>About, Battery Health). READ THESE CAREFULLY — sellers put the real specs here and they are the highest-value image in any listing.
- lockScreen: true if a device is shown on a lock screen. Also note any visible DATE or DAY on it in facts — a photo older than the listing matters.
- bootScreenOnly: true if the device only ever appears on a boot/logo screen (Samsung "Secured by Knox", Apple logo, BIOS splash, Windows loading). That proves power and NOTHING else — it cannot rule out activation lock, FRP lock, carrier lock or a dead panel.
- screenshotArtifacts: describe any UI chrome proving the photo was screenshotted from another app — iOS/Android status bar, photo counters ("2/2"), close buttons, share/reply/SAVE icons. A SAVE icon is the strongest tell: you only save a photo someone SENT you, which means the seller may not have the item.
- displayOutputsVisible: for graphics cards only. true if HDMI/DisplayPort/DVI connectors are visible on the I/O bracket, false if the bracket is a solid vented grille with NO display connectors (datacenter/mining card, unusable as a GPU), null if the bracket is not shown.
- portCondition: describe the state of ports, hinges and connectors.
- portDamage: true ONLY if you can actually SEE damage or heavy wear to a port, hinge or connector. false if they look fine or are not shown. These are FUNCTIONAL defects, not cosmetic, no matter how the seller frames them — but do not report damage you cannot see.
- physicalDamage: cracks, dents, swelling, corrosion, missing screws, bent PCB.
- unreadable: photo indices that were too blurry, dark or angled to extract anything from.`;

export async function analyzePhotos(listingId: number, opts?: { timeoutMs?: number }): Promise<VisionResult | null> {
  const dir = join(PHOTO_DIR, String(listingId));
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort(
    (a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0),
  );
  if (!files.length) return null;

  const proc = Bun.spawn(
    ["claude", "-p", PROMPT(files.map((f) => join(dir, f))), "--allowedTools", "Read", "--output-format", "text"],
    { stdout: "pipe", stderr: "pipe", cwd: join(import.meta.dir, "../..") },
  );
  const timer = setTimeout(() => proc.kill(), opts?.timeoutMs ?? 300_000);
  const out = await new Response(proc.stdout).text();
  clearTimeout(timer);

  const json = out.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as VisionResult;
    return { ...parsed, raw: out };
  } catch {
    return null;
  }
}
