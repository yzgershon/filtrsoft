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

/**
 * Haiku 4.5 by default, because MASTER-PLAN 3.4 budgets ~$0.011/check and the
 * Phase 3 gate is an absolute cost/check <= $0.03. Opus 5 on the same request
 * shape is roughly 5x that and blows the gate on its own.
 *
 * Override per run to compare:
 *   ASSYZE_VISION_MODEL=claude-opus-5 bun run check <url>
 */
export const VISION_MODEL = process.env.ASSYZE_VISION_MODEL ?? "claude-haiku-4-5";

/** $ per million tokens. Used to report REAL cost instead of the 3.4 estimate. */
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-fable-5": { in: 10, out: 50 },
};

/**
 * 1024px longest edge, NOT the 768 that MASTER-PLAN 3.1 assumed.
 *
 * Measured 2026-08-24 on listing 6, whose spec screen is the exact photo Phase 0
 * skipped. Craigslist serves these at ~900px tall, so a 768 cap was DOWNSCALING
 * the highest-value image in the set. At 768 the model read "Ryzen 5 5600X" off
 * a screen that says "Ryzen 5 9600X" — a Zen 5 chip read as a 4-year-old Zen 3,
 * about a $110 error on one component, flowing straight into sum-of-parts.
 *
 * Anthropic bills roughly (w*h)/750 tokens per image. 414x900 is ~497 tokens
 * against ~361 at 768: the entire saving was a third of a cent per listing, paid
 * for with the digits. Cap above the source size so nothing is thrown away, and
 * keep a cap at all so a 4000px phone photo does not cost 20k tokens.
 */
const MAX_EDGE = Number(process.env.ASSYZE_VISION_MAX_EDGE) || 1024;

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
}

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

/** Downscale to MAX_EDGE and re-encode. withoutEnlargement so small photos are left alone. */
async function prepare(path: string): Promise<string> {
  const buf = await sharp(readFileSync(path))
    .rotate() // honour EXIF; a sideways spec screen is much harder to read
    .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return buf.toString("base64");
}

export async function analyzePhotos(listingId: number): Promise<VisionResult | null> {
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
  for (let i = 0; i < files.length; i++) {
    content.push({ type: "text", text: `Image ${i}:` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: await prepare(join(dir, files[i])) },
    });
  }
  content.push({
    type: "text",
    text: `That is all ${files.length} images from this listing. Inspect every one and extract the fields.`,
  });

  try {
    const res = await c.messages.parse({
      model: VISION_MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(VisionSchema) },
    });

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

    const price = PRICING[VISION_MODEL] ?? { in: 0, out: 0 };
    const usage = {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      costUsd: (res.usage.input_tokens * price.in + res.usage.output_tokens * price.out) / 1e6,
      ms: Date.now() - t0,
    };

    return { ...parsed, model: VISION_MODEL, usage, raw: JSON.stringify(parsed) };
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
