/**
 * Vision layer — photos to structured facts, via the Anthropic API.
 *
 * WHAT CHANGED 2026-08-24: this used to shell out to headless Claude Code
 * (`claude -p`) against Yish's three personal subscriptions, with failover
 * between them. That is gone. It cost ~60s per listing (most of it CLI startup
 * plus SEQUENTIAL per-photo Read calls), it could not run in production because
 * the container has no CLI and must never carry credentials, and it died
 * whenever three subscriptions happened to be out of quota at once.
 *
 * Now: ONE request, ALL photos, in a single API call. MASTER-PLAN 3.1 fix 2.
 *
 * THE RULE, unchanged: every photo, every time. The Phase 0 miss was a skipped
 * third image that contained the entire spec sheet. The funnel may drop
 * LISTINGS at any stage; once a listing reaches vision it must never drop
 * PHOTOS.
 *
 * The prompt is derived directly from RISK-MODEL.md — it asks for exactly the
 * things that change a verdict, not a general description.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import sharp from "sharp";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PHOTO_DIR } from "../photos/index.ts";
import {
  reserveVisionBudget,
  settleVisionBudget,
  visionKilled,
  visionReservationMicros,
} from "./budget.ts";

/**
 * PINNED to Haiku 4.5. Not an env var, not a default that something else can
 * override — a constant, so no stray Railway variable can silently move this
 * onto a model that costs ten times as much per listing.
 *
 * Measured 2026-08-24 on listing 6: Haiku, Sonnet 5 and Opus 5 all read the CPU,
 * GPU, RAM and storage correctly off the same spec screen. Opus cost 10x and
 * took 4x as long. Changing this is a deliberate one-line edit, and anyone
 * making it should re-run the comparison first.
 */
export const VISION_MODEL = "claude-haiku-4-5";

/** $ per million tokens, for reporting REAL cost instead of the 3.4 estimate. */
const PRICING = { in: 1, out: 5 };

/**
 * NEVER DOWNSCALE A SOURCE PHOTO. Yish's rule, 2026-08-24, and he is right:
 * the 768px cap this file shipped with made Haiku read "Ryzen 5 5600X" off a
 * screen that says "Ryzen 5 9600X" — a Zen 5 chip read as a 4-year-old Zen 3,
 * roughly $110 of error on one component, flowing straight into sum-of-parts.
 * The saving was a third of a cent.
 *
 * So the pipeline now sends ORIGINAL BYTES, untouched, whenever they fit. No
 * resize and — just as important — NO RE-ENCODE. The old code re-encoded every
 * JPEG at quality 82, which is a SECOND lossy compression pass on an already
 * lossy source. Anthropic's own guidance calls that out: heavy or repeated JPEG
 * compression makes text hard to read, and small text on a spec screen is the
 * single most valuable thing in these listings.
 *
 * The ceiling is not ours to choose. Haiku 4.5 is a STANDARD-tier vision model:
 * long edge 1568px and 1568 visual tokens, whichever binds first. Anything
 * bigger the API downscales itself before the model ever sees it, so sending a
 * 4000px photo buys literally nothing. The high-resolution tier (2576px / 4784
 * tokens) is Claude 4.7 and later only — Haiku 4.5 does not get it.
 *
 * Practically: Craigslist serves ~900px, which is far under both limits, so in
 * normal operation nothing is touched at all. The resize path below exists for
 * the phone-camera 4032px case, where the choice is between our resampler and
 * theirs — not between full resolution and reduced.
 */
const MAX_LONG_EDGE = 1568;
const MAX_VISUAL_TOKENS = 1568;
/** Claude bills ceil(w/28) * ceil(h/28) visual tokens — 28px patches, not pixels. */
const PATCH = 28;
const visualTokens = (w: number, h: number) => Math.ceil(w / PATCH) * Math.ceil(h / PATCH);

export interface VisionFact {
  fact: string;
  photo: string;
  confidence: "high" | "medium" | "low";
}

/**
 * Structured output schema. This REPLACES "return ONE json object, no markdown
 * fence" and the regex that dug the JSON back out of prose. The old path had a
 * real failure mode — malformed JSON meant the whole listing returned null —
 * and the API now enforces the shape server-side instead.
 *
 * Every field is .nullable(), never .optional(): structured outputs want all
 * keys present, and "the model did not mention it" and "the model says no" have
 * to stay distinguishable.
 */
const ComponentsSchema = z.object({
  cpu: z.string().nullable(),
  gpu: z.string().nullable(),
  ram: z.string().nullable(),
  storage: z.string().nullable(),
  motherboard: z.string().nullable(),
  psu: z.string().nullable(),
  model: z.string().nullable(),
  storage_tier: z.string().nullable(),
});

const VisionSchema = z.object({
  components: ComponentsSchema,
  facts: z.array(
    z.object({
      fact: z.string(),
      photo: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
  specScreens: z.array(z.string()),
  lockScreen: z.boolean(),
  bootScreenOnly: z.boolean(),
  screenshotArtifacts: z.string().nullable(),
  displayOutputsVisible: z.boolean().nullable(),
  portCondition: z.string().nullable(),
  portDamage: z.boolean(),
  physicalDamage: z.array(z.string()),
  unreadable: z.array(z.string()),
});

export interface VisionResult extends z.infer<typeof VisionSchema> {
  raw?: string;
  /** Which model produced this. Stored so a re-run can be compared against it. */
  model?: string;
  usage?: { inputTokens: number; outputTokens: number; costUsd: number; ms: number };
  /** Links this result to the atomic daily-budget reservation that paid for it. */
  budgetReservationId?: number;
}

/**
 * Bump this whenever SYSTEM or VisionSchema changes.
 *
 * It is part of the cache key. Without it, a prompt fix keeps serving answers
 * generated by the OLD prompt for every photo set already seen — the fix looks
 * inert, and you debug the prompt instead of the cache.
 */
export const PROMPT_VERSION = "2026-08-24.1";

const SYSTEM = `You inspect photos from used-tech marketplace listings and extract only what is visibly present.

Report ONLY what you can actually see. Never infer from a filename, never guess a plausible model number, and never report damage you cannot see. If an image is too blurry, dark or angled to read, list it as unreadable rather than guessing.

Field rules:
- components: the BARE model string and nothing else — "AMD Ryzen 5 9600X", "NVIDIA GeForce RTX 5070 12GB", "16GB". No commentary, no hedging, no "exact SKU not legible", no "confirmed via spec screen". These strings are matched against a catalog by an exact-ish matcher and any prose in them breaks the match. Put every caveat in facts instead. null when not shown. "model" is for whole devices (phones, laptops); "storage_tier" for phone/tablet capacity.
- specScreens: image indices showing a spec readout (Windows System>About, Task Manager, HWiNFO, iOS Settings>About, Battery Health). READ THESE CAREFULLY — sellers put the real specs here and they are the highest-value image in any listing.
- lockScreen: true if a device is shown on a lock screen. Also note any visible DATE or DAY on it in facts — a photo older than the listing matters.
- bootScreenOnly: true if the device only ever appears on a boot/logo screen (Samsung "Secured by Knox", Apple logo, BIOS splash, Windows loading). That proves power and NOTHING else — it cannot rule out activation lock, FRP lock, carrier lock or a dead panel.
- screenshotArtifacts: describe any UI chrome proving the photo was screenshotted from another app — iOS/Android status bar, photo counters ("2/2"), close buttons, share/reply/SAVE icons. A SAVE icon is the strongest tell: you only save a photo someone SENT you, which means the seller may not have the item.
- displayOutputsVisible: for graphics cards only. true if HDMI/DisplayPort/DVI connectors are visible on the I/O bracket, false if the bracket is a solid vented grille with NO display connectors (datacenter/mining card, unusable as a GPU), null if the bracket is not shown.
- portCondition: describe the state of ports, hinges and connectors.
- portDamage: true ONLY if you can actually SEE damage or heavy wear to a port, hinge or connector. false if they look fine or are not shown. These are FUNCTIONAL defects, not cosmetic, no matter how the seller frames them.
- physicalDamage: cracks, dents, swelling, corrosion, missing screws, bent PCB.
- facts, specScreens and unreadable reference images by the INDEX given in the text label before each image.`;

let _client: Anthropic | null = null;
function client(): Anthropic | null {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  _client = new Anthropic();
  return _client;
}

export function visionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Per-image base64 ceiling on the Claude API is 10 MB; base64 inflates by ~4/3. */
const MAX_RAW_BYTES = Math.floor((10 * 1024 * 1024 * 3) / 4);

const MEDIA: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp"> = {
  jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
};

/**
 * Original bytes if they fit, a single careful resize if they do not.
 *
 * The pass-through branch is the point of this function. It does not decode,
 * re-encode, or touch the file at all — the exact bytes on disk go to the API.
 */
async function prepare(path: string): Promise<{ data: string; media: string; note: string } | null> {
  const raw = readFileSync(path);
  const meta = await sharp(raw).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const media = MEDIA[meta.format ?? ""] ?? null;

  if (!w || !h) {
    console.warn(`vision: could not read dimensions of ${path} — skipping`);
    return null;
  }

  const fits =
    Math.max(w, h) <= MAX_LONG_EDGE &&
    visualTokens(w, h) <= MAX_VISUAL_TOKENS &&
    raw.byteLength <= MAX_RAW_BYTES &&
    media !== null;

  if (fits) {
    return { data: raw.toString("base64"), media: media!, note: `${w}x${h} original` };
  }

  /**
   * Oversized. The API would downscale this itself, so the only decision left is
   * WHO resamples and how well. Lanczos3 and quality 95 beat an unknown default,
   * and 95 keeps the second compression pass close to lossless where it matters.
   *
   * Solve both limits at once: scale factor s such that the long edge fits AND
   * the patch grid fits. The token limit is the one that usually binds, and
   * doing this in one step avoids resizing twice.
   */
  const byEdge = MAX_LONG_EDGE / Math.max(w, h);
  const byTokens = Math.sqrt((MAX_VISUAL_TOKENS * PATCH * PATCH) / (w * h));
  const s = Math.min(byEdge, byTokens, 1);
  const tw = Math.max(1, Math.floor(w * s));
  const th = Math.max(1, Math.floor(h * s));

  const buf = await sharp(raw)
    .rotate() // honour EXIF; a sideways spec screen is much harder to read
    .resize(tw, th, { kernel: "lanczos3", fit: "fill" })
    .jpeg({ quality: 95 })
    .toBuffer();

  return { data: buf.toString("base64"), media: "image/jpeg", note: `${w}x${h} -> ${tw}x${th}` };
}

export async function analyzePhotos(listingId: number): Promise<VisionResult | null> {
  if (visionKilled()) {
    console.error("vision: switched off by ASSYZE_VISION_ENABLED");
    return null;
  }
  const c = client();
  if (!c) {
    console.error("vision: ANTHROPIC_API_KEY is not set — vision is off");
    return null;
  }

  const dir = join(PHOTO_DIR, String(listingId));
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort(
    (a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0),
  );
  if (!files.length) return null;

  const t0 = Date.now();

  /**
   * Interleave a text label before each image. Without it the model has no
   * stable way to say WHICH photo a fact came from, and "photo": "2" becomes a
   * guess — which matters because the evidence line in the verdict cites it.
   */
  const content: Anthropic.ContentBlockParam[] = [];
  const notes: string[] = [];
  let bytes = 0;

  for (let i = 0; i < files.length; i++) {
    const img = await prepare(join(dir, files[i]));
    // A photo we cannot decode is a photo we cannot inspect. Say so out loud —
    // silently dropping one is exactly the Phase 0 failure.
    if (!img) continue;
    bytes += img.data.length;
    notes.push(`${i}:${img.note}`);
    content.push({ type: "text", text: `Image ${i}:` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.media as "image/jpeg", data: img.data },
    });
  }

  const sent = content.filter((b) => b.type === "image").length;
  if (!sent) return null;
  if (sent !== files.length) {
    console.warn(`vision: listing ${listingId} — ${files.length - sent} of ${files.length} photos unusable`);
  }

  /**
   * Request-level ceilings, both of which fail as opaque 400s if hit. Haiku 4.5
   * has a 200k context, which caps the API at 100 images per request; the whole
   * request body caps at 32 MB. A marketplace listing has under 30 photos, so
   * this is a guard rail, not a code path — but an opaque 400 at 2am is worth
   * one comparison.
   */
  if (sent > 100) {
    console.error(`vision: listing ${listingId} has ${sent} photos, over the 100-image request limit`);
    return null;
  }
  if (bytes > 30 * 1024 * 1024) {
    console.error(`vision: listing ${listingId} payload is ${(bytes / 1e6).toFixed(1)} MB, over the request limit`);
    return null;
  }

  content.push({
    type: "text",
    text: `That is all ${sent} images from this listing. Inspect every one and extract the fields.`,
  });

  // This is the authoritative spend gate. API and scheduler checks are only a
  // quick refusal; every direct caller reaches this atomic reservation too.
  const budgetReservationId = reserveVisionBudget(visionReservationMicros(sent));
  if (budgetReservationId === null) {
    console.error(`vision: daily budget cannot reserve a ${sent}-photo request`);
    return null;
  }

  try {
    const res = await c.messages.parse({
      model: VISION_MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(VisionSchema) },
    });

    const price = PRICING;
    const usage = {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      costUsd: (res.usage.input_tokens * price.in + res.usage.output_tokens * price.out) / 1e6,
      ms: Date.now() - t0,
    };

    // A refusal or unparseable HTTP-200 response is still billed. Settle before
    // inspecting the content so every response is charged to the hard ledger.
    try {
      settleVisionBudget(budgetReservationId, Math.round(usage.costUsd * 1e6));
    } catch (e) {
      // Leaving the reservation at its theoretical maximum is conservative and
      // keeps the cap safe if the volume becomes unwritable after the call.
      console.error(`vision: could not settle budget reservation: ${(e as Error).message}`);
    }

    // Safety classifiers can decline (HTTP 200, no content). Vanishingly
    // unlikely for photos of a graphics card, but reading .content without
    // checking would throw rather than log something anyone can act on.
    if (res.stop_reason === "refusal") {
      console.error(`vision: refused (${res.stop_details?.category ?? "unknown"})`);
      return null;
    }

    const parsed = res.parsed_output;
    if (!parsed) {
      console.error("vision: response did not parse against the schema");
      return null;
    }

    console.log(`vision: listing ${listingId} — ${sent} photos [${notes.join(" ")}] ${usage.inputTokens} tok $${usage.costUsd.toFixed(4)} ${(usage.ms / 1000).toFixed(1)}s`);
    return {
      ...parsed,
      model: VISION_MODEL,
      usage,
      budgetReservationId,
      raw: JSON.stringify(parsed),
    };
  } catch (e) {
    // Most specific first — a 429 is worth retrying later, a 400 is a bug in
    // this file and retrying it forever is how you burn an afternoon.
    if (e instanceof Anthropic.RateLimitError) {
      console.error("vision: rate limited");
    } else if (e instanceof Anthropic.AuthenticationError) {
      console.error("vision: ANTHROPIC_API_KEY rejected — check the key in .env");
    } else if (e instanceof Anthropic.BadRequestError) {
      console.error(`vision: bad request (this is a bug, not a transient): ${e.message}`);
    } else if (e instanceof Anthropic.APIConnectionError) {
      console.error("vision: could not reach the API");
    } else {
      console.error(`vision: ${(e as Error).message}`);
    }
    return null;
  }
}
