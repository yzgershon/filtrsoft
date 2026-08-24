/**
 * The engine as a callable service.
 *
 * Everything before this lived in scripts that each re-implemented the pipeline
 * inline. This is the single entry point the web API, the mobile app and any
 * batch job all call. Nothing above this layer should know about SQL, photo
 * paths, or the order the stages run in.
 *
 * STAGES EXIST FOR LATENCY, NOT TIDINESS. The cheap signals are pure text
 * computation and land in well under a second; vision takes seconds. The API
 * streams each stage as it completes so the page is useful long before the slow
 * part finishes. See MASTER-PLAN §3.1.
 */
import { fetchListing } from "../sources/craigslist.ts";
import { analyze } from "../signals/index.ts";
import { matchSku, type Match } from "../catalog/match.ts";
import { buildVerdict, type VerdictResult } from "../verdict/index.ts";
import { loadVision, visionToText, visionSignals } from "../vision/merge.ts";
import { analyzePhotos, type VisionResult } from "../vision/index.ts";
import { downloadPhoto, dhash } from "../photos/index.ts";
import { getEconomics, type UserEconomics } from "../valuation/index.ts";
import { db, now } from "../db/index.ts";
import type { RawListing, Signal, SignalReport } from "../types.ts";

export type StageName = "fetched" | "signals" | "valued" | "vision" | "done";

export interface Stage {
  stage: StageName;
  elapsedMs: number;
  data: unknown;
}

export interface CheckResult {
  listingId: number | null;
  listing: RawListing;
  signals: SignalReport;
  match: Match;
  verdict: VerdictResult;
  vision: VisionResult | null;
  elapsedMs: number;
}

export interface CheckOptions {
  econ?: UserEconomics;
  driveMinutes?: number;
  /** Run the vision pass. Slow (seconds). Off by default so callers opt in. */
  vision?: boolean;
  /** Write the listing and photos to the database. */
  persist?: boolean;
  /** Called as each stage completes, for streaming. */
  onStage?: (s: Stage) => void;
}

/**
 * Pure core: given a listing and optional vision output, produce a verdict.
 * No I/O, no fetching. This is the piece that must stay deterministic so the
 * eval set means something.
 */
export function runPipeline(
  listing: RawListing,
  vision: VisionResult | null,
  opts: { econ?: UserEconomics; driveMinutes?: number; clusterSize?: number } = {},
): { signals: SignalReport; match: Match; verdict: VerdictResult } {
  const vText = visionToText(vision);

  const signals = analyze(listing, {
    visionText: vText,
    clusterSize: opts.clusterSize,
  });
  for (const vs of visionSignals(vision)) {
    signals.signals.push({ ...vs, polarity: "negative" } as Signal);
  }

  // Vision text joins the matcher's input — photos are a first-class source of
  // specs, not a fallback. The Dedham build's entire spec sheet was in photo 3.
  const match = matchSku(
    listing.title,
    `${listing.description}\n${vText}`,
    signals.category,
  );

  const verdict = buildVerdict({
    title: listing.title,
    description: listing.description,
    askingPriceCents: listing.askingPriceCents,
    signals,
    match,
    driveMinutes: opts.driveMinutes,
    econ: opts.econ,
  });

  return { signals, match, verdict };
}

/** How many other listings share this seller. Drives cluster detection. */
function clusterSize(seller: string | null | undefined): number | undefined {
  if (!seller) return undefined;
  const r = db()
    .query("SELECT COUNT(*) n FROM listings WHERE seller_ref = $s")
    .get({ $s: seller }) as { n: number };
  return r.n || undefined;
}

function persistListing(l: RawListing): number {
  const row = db()
    .query(
      `INSERT INTO listings (source, source_id, url, title, description, asking_price_cents,
         location, posted_at, updated_at, captured_at, photo_count, seller_ref, raw_json)
       VALUES ($src,$sid,$url,$title,$desc,$price,$loc,$posted,$updated,$cap,$photos,$seller,$raw)
       ON CONFLICT(source, source_id) DO UPDATE SET
         updated_at=excluded.updated_at, captured_at=excluded.captured_at,
         asking_price_cents=excluded.asking_price_cents
       RETURNING id`,
    )
    .get({
      $src: l.source, $sid: l.sourceId, $url: l.url, $title: l.title,
      $desc: l.description, $price: l.askingPriceCents, $loc: l.location,
      $posted: l.postedAt, $updated: l.updatedAt, $cap: now(),
      $photos: l.photoUrls.length, $seller: null, $raw: JSON.stringify(l.raw),
    }) as { id: number };
  return row.id;
}

async function persistPhotos(listingId: number, urls: string[]) {
  const d = db();
  d.query("DELETE FROM listing_photos WHERE listing_id=$id").run({ $id: listingId });
  const ins = d.query(
    `INSERT INTO listing_photos (listing_id, url, local_path, phash, position, captured_at)
     VALUES ($lid,$url,$path,$phash,$pos,$cap)`,
  );
  for (const [i, u] of urls.entries()) {
    let path: string | null = null, phash: string | null = null;
    try {
      const got = await downloadPhoto(u, listingId, i);
      path = got.path;
      phash = await dhash(got.buf);
    } catch { /* a dead image URL must not kill the check */ }
    ins.run({ $lid: listingId, $url: u, $path: path, $phash: phash, $pos: i, $cap: now() });
  }
}

/**
 * Check a listing by URL. This is what the API calls.
 *
 * Emits a verdict TWICE when vision is on: once from text alone so the user has
 * something immediately, then again once photos have been read. Both are real
 * verdicts, not a placeholder and a real one.
 */
export async function checkListing(url: string, opts: CheckOptions = {}): Promise<CheckResult> {
  const t0 = Date.now();
  const since = () => Date.now() - t0;
  const emit = (stage: StageName, data: unknown) =>
    opts.onStage?.({ stage, elapsedMs: since(), data });

  const econ = opts.econ ?? getEconomics();

  // --- fetch -----------------------------------------------------------
  const listing = await fetchListing(url);
  emit("fetched", {
    title: listing.title,
    askingPriceCents: listing.askingPriceCents,
    location: listing.location,
    postedAt: listing.postedAt,
    photoUrls: listing.photoUrls,
  });

  let listingId: number | null = null;
  if (opts.persist) listingId = persistListing(listing);

  // --- text-only pass: instant, and usually the whole story ------------
  const cluster = clusterSize(null);
  let out = runPipeline(listing, null, { econ, driveMinutes: opts.driveMinutes, clusterSize: cluster });
  emit("signals", { signals: out.signals.signals, category: out.signals.category,
    listingQuality: out.signals.listingQuality, sellerSophistication: out.signals.sellerSophistication });
  emit("valued", { match: out.match, verdict: out.verdict });

  // --- vision: seconds, optional, refines the verdict -------------------
  let vision: VisionResult | null = null;
  if (opts.vision && listingId) {
    await persistPhotos(listingId, listing.photoUrls);
    vision = await analyzePhotos(listingId);
    if (vision) {
      db().query(
        `INSERT INTO vision_results (listing_id, model, payload, duration_ms, created_at)
         VALUES ($lid,'claude-code-headless',$p,$ms,$now)`,
      ).run({ $lid: listingId, $p: JSON.stringify(vision), $ms: since(), $now: now() });
      out = runPipeline(listing, vision, { econ, driveMinutes: opts.driveMinutes, clusterSize: cluster });
      emit("vision", { vision, verdict: out.verdict });
    }
  } else if (opts.persist && listingId) {
    // Photos are wanted for the phash index and any later vision run, but they
    // are NOT on the critical path when vision is off. Blocking on them added
    // ~1.1s to a response that was otherwise complete at 163ms.
    const id = listingId;
    void persistPhotos(id, listing.photoUrls).catch(() => {});
  }

  if (listingId) {
    db().query(
      `INSERT INTO verdicts (listing_id, engine_version, call, confidence, payload, created_at)
       VALUES ($lid,$v,$call,$conf,$p,$now)`,
    ).run({
      $lid: listingId, $v: ENGINE_VERSION, $call: out.verdict.call,
      $conf: out.verdict.confidence, $p: JSON.stringify(out.verdict), $now: now(),
    });
  }

  const result: CheckResult = {
    listingId, listing, signals: out.signals, match: out.match,
    verdict: out.verdict, vision, elapsedMs: since(),
  };
  emit("done", result);
  return result;
}

/** Re-score a listing already in the database. Used by the eval loop. */
export function checkStored(
  listingId: number,
  opts: { econ?: UserEconomics; driveMinutes?: number } = {},
): { signals: SignalReport; match: Match; verdict: VerdictResult; listing: RawListing } {
  const r = db()
    .query(
      `SELECT source, source_id, url, title, description, asking_price_cents,
              location, posted_at, updated_at, photo_count, seller_ref
       FROM listings WHERE id = $id`,
    )
    .get({ $id: listingId }) as any;
  if (!r) throw new Error(`no listing ${listingId}`);

  const listing: RawListing = {
    source: r.source, sourceId: r.source_id, url: r.url, title: r.title ?? "",
    description: r.description ?? "", askingPriceCents: r.asking_price_cents,
    location: r.location, postedAt: r.posted_at, updatedAt: r.updated_at,
    photoUrls: new Array(r.photo_count ?? 0).fill(""), attributes: {}, raw: {},
  };

  const out = runPipeline(listing, loadVision(listingId), {
    econ: opts.econ, driveMinutes: opts.driveMinutes, clusterSize: clusterSize(r.seller_ref),
  });
  return { ...out, listing };
}

export const ENGINE_VERSION = "0.3.0";
