import {evidenceHash} from "./provenance.ts";
import {pricingSignature} from "../db/revisions.ts";
import {recoveryPlan,type ReadReceipt} from '../agent/recovery.ts';
import {readReceipt,recordDetailAttempt} from '../db/enrichment.ts';
import {textFacts} from '../signals/factual-text.ts';
import {closedDomain,boundedDecision} from '../verdict/bounded.ts';
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
import { matchSku,extractAttributes, type Match } from "../catalog/match.ts";
import { buildVerdict, type VerdictResult } from "../verdict/index.ts";
import { loadCurrentVision, syncPhotoUrls, loadVisionByFingerprint, photoFingerprint, photosUnchanged, visionToText, visionSignals } from "../vision/merge.ts";
import { analyzePhotos, VISION_MODEL, PROMPT_VERSION, type VisionResult } from "../vision/index.ts";
import { releasePhotos, KEEP_PHOTOS,createPhotoWorkspace,type PhotoWorkspace } from "../photos/index.ts";
import { downloadPhoto, fetchPhoto, dhash } from "../photos/index.ts";
import { thumbFromBytes, putThumb, THUMBS_OFF } from "../photos/thumb.ts";
import { getEconomics, type UserEconomics } from "../valuation/index.ts";
import { db, now } from "../db/index.ts";
import { upsertListingFacts } from "../db/listings.ts";
import { storeVerdict } from "../db/verdicts.ts";
import { normalizedListing, rawObject, storedAttributes } from "../db/facts.ts";
import type { RawListing, Signal, SignalReport } from "../types.ts";

export type StageName = "fetched" | "signals" | "valued" | "vision_start" | "vision" | "done";

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
  /**
   * Read the photos with the paid model. OFF by default: callers must opt in.
   * The dedicated vision pass does that only for candidates where photos can
   * change an answer.
   *
   * It's slow on a cold listing, which is why the pipeline streams: the text
   * verdict lands in ~200ms and vision refines it when it arrives.
   */
  vision?: boolean;
  /** Write the listing and photos to the database. */
  persist?: boolean;
  /** Internal enrichment uses saved facts without claiming a fresh source visit. */
  storedListingId?: number;
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
  opts: { econ?: UserEconomics; driveMinutes?: number; clusterSize?: number;bounded?:boolean;recovery?:ReadReceipt|null } = {},
): { signals: SignalReport; match: Match; verdict: VerdictResult } {
  const vText = visionToText(vision);

  const signals = analyze(listing, {
    visionText: vText,
    clusterSize: opts.clusterSize,
  });
  /**
   * ⚠ THE POLARITY COMES FROM THE SIGNAL, NOT FROM HERE.
   *
   * This used to be `{ ...vs, polarity: "negative" }`, which made a positive
   * finding from vision structurally impossible — every photo observation was
   * evidence against the seller by construction. That is half of why a listing
   * whose seller had PHOTOGRAPHED HIS OWN SPEC SCREEN to prove the components
   * was flagged as a scam (2026-08-31, on an RTX 5090 the feed found in 30
   * minutes). See `visionSignals` in vision/merge.ts.
   */
  for (const vs of visionSignals(vision)) {
    signals.signals.push(vs as Signal);
  }

  // Vision text joins the matcher's input — photos are a first-class source of
  // specs, not a fallback. The Dedham build's entire spec sheet was in photo 3.
  const match = matchSku(
    listing.title,
    `${listing.description}\n${Object.entries(listing.attributes).map(([k,v])=>`${k}: ${v}`).join("\n")}\n${vText}`,
    signals.category,
  );

  const economics=opts.econ??getEconomics();
  const verdict = buildVerdict({
    source: listing.source,
    title: listing.title,
    description: listing.description,
    askingPriceCents: listing.askingPriceCents,
    signals,
    match,
    // Photos are evidence for the risk gate, not just for specs — a device shown
    // only on a boot screen proves power and rules out nothing.
    visionText: vText,
    vision,
    driveMinutes: opts.driveMinutes,
    econ: economics,
  });
  const extraction=rawObject(rawObject(listing.raw).extraction);
  if(extraction.complete===false&&['BUY','VERIFY','FAIR'].includes(verdict.call)){
    verdict.call='INSUFFICIENT_DATA';verdict.confidence='low';verdict.headline='Seller description is incomplete.';
    verdict.decidingUnknown='complete seller description';verdict.reasoning='The page was only partially read. Missing text may disclose defects or sale conditions.';
  }
  const domain=opts.bounded!==false?closedDomain(listing.description):null;
  const outsideDomain=domain?extractAttributes(`${listing.title}\n${listing.description.replace(domain.quote,'')}\n${Object.values(listing.attributes).join('\n')}\n${vText}`):{};
  if(domain&&verdict.call==='INSUFFICIENT_DATA'&&extraction.complete===true&&extraction.truncated!==true&&outsideDomain[domain.field]==null){
    const cases=domain.values.map(value=>{
      const label=domain.field==='ram_gb'?'RAM':'Storage';
      const candidate={...listing,description:listing.description.replace(domain.quote,`${label}: ${value}GB.`)};
      return {value,verdict:runPipeline(candidate,vision,{...opts,bounded:false}).verdict};
    });
    const bounded=boundedDecision(domain,cases,{category:signals.category,ask:listing.askingPriceCents,econ:economics,drive:opts.driveMinutes??15,
      conflict:textFacts(`${listing.title}\n${listing.description}`).conflicts.length>0,
      conditionKnown:/\b(?:fully working|fully functional|works perfectly|tested working)\b/i.test(listing.description)&&!signals.signals.some(s=>['UNTESTED','NON_WORKING','DAMAGED_DISPLAY'].includes(s.code))});
    if(bounded){
      verdict.call=bounded.call;verdict.confidence='medium';verdict.boundedDecision=bounded;
      verdict.headline=bounded.call==='PASS'?'Pass across every explicitly stated configuration.':'Potential value across the stated configurations; verify which one.';
      verdict.reasoning=`Supported sold range $${(bounded.lowCents/100).toFixed(0)}–$${(bounded.highCents/100).toFixed(0)}. ${bounded.limitation}`;
      verdict.decidingUnknown=domain.field.replace('_gb','');verdict.netProfitCents=bounded.profitLowCents;
      const evidence=[...new Map(cases.flatMap(c=>c.verdict.valuation.evidence??[]).map(e=>[e.id,e])).values()];
      verdict.valuation={...verdict.valuation,status:'ok',confidence:'medium',compCount:evidence.length,evidence,lowCents:bounded.lowCents,highCents:bounded.highCents,medianCents:null};
    }
  }

  const {raw,...facts}=listing;
  verdict.provenance={version:1,engineVersion:ENGINE_VERSION,dataRevision:pricingSignature(db()),factsHash:evidenceHash({facts,vision}),
    facts,signals,match,visionEvidence:vision,visionHash:vision?evidenceHash(vision):null,
    economics:{version:1,hash:evidenceHash({economics,driveMinutes:opts.driveMinutes??15}),values:{...economics},
      driveMinutes:opts.driveMinutes??15,scope:opts.econ || opts.driveMinutes!=null?'personal':'canonical'}};
  verdict.textEvidence=textFacts(`${listing.title}\n${listing.description}`);
  verdict.recovery=recoveryPlan({...listing,verdict,call:verdict.call,recovery:opts.recovery}).blockers;
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
  return upsertListingFacts(db(), {
    source: l.source,
    sourceId: l.sourceId,
    url: l.url,
    title: l.title,
    description: l.description,
    askingPriceCents: l.askingPriceCents,
    location: l.location,
    postedAt: l.postedAt,
    updatedAt: l.updatedAt,
    photoCount: l.photoUrls.length,
    sellerRef: l.sellerRef,
    raw: l.raw,
  }).id;
}

async function persistPhotos(listingId: number, urls: string[], keepFiles: boolean,workspace?:PhotoWorkspace) {
  const d = db();
  if(urls.length>40)throw new Error('Gallery exceeds the 40-photo analysis limit');
  let downloaded=0;
  const ins = d.query(
    `UPDATE listing_photos SET local_path=COALESCE($path,local_path),phash=COALESCE($phash,phash)
      WHERE listing_id=$lid AND url=$url`,
  );
  for (const [i, u] of urls.entries()) {
    if (!photosUnchanged(listingId, urls)) {
      if(keepFiles)throw new Error('Gallery changed during analysis');
      return;
    }
    if (!keepFiles && (d.query("SELECT phash FROM listing_photos WHERE listing_id=? AND url=?").get(listingId,u) as {phash:string|null}|null)?.phash) continue;
    let path: string | null = null, phash: string | null = null;
    try {
      const got = keepFiles
        ? await downloadPhoto(u, listingId, i,workspace)
        : { path: null, buf: await fetchPhoto(u) };
      path = got.path;
      phash = await dhash(got.buf);
      downloaded++;
      /**
       * ⚠ THE THUMBNAIL COMES OFF THESE BYTES, NOT A SECOND REQUEST.
       *
       * We have just downloaded this photo to hash it, so the hero is in
       * memory at exactly the moment the cache wants it. Calling `fetchThumb`
       * here would re-fetch an image we are holding — a wasted round trip per
       * listing against a source we are deliberately gentle with.
       *
       * Only position 0: one image per listing is what bounds the cache. Why a
       * cache exists at all, and why it is not the retention that filled the
       * volume in 2026-08, is in `photos/thumb.ts`.
       */
      if (i === 0 && !THUMBS_OFF) {
        const t = await thumbFromBytes(got.buf);
        if (t) putThumb(listingId, u, t);
      }
    } catch { /* a dead image URL must not kill the check */ }
    ins.run({ $lid: listingId, $url: u, $path: path, $phash: phash });
  }
  if(keepFiles && downloaded!==urls.length)throw new Error('Could not read the complete gallery; no paid analysis attempted');
}

/**
 * Text-only checks hash in the background without writing a byte to the volume.
 * Serialise jobs per listing so a paid vision revisit cannot race a stale hash
 * job that deletes and replaces the same `listing_photos` rows.
 */
const photoHashJobs = new Map<number, Promise<void>>();

function queuePhotoHashes(listingId: number, urls: string[]): Promise<void> {
  const prior = photoHashJobs.get(listingId) ?? Promise.resolve();
  const task = prior
    .catch(() => {})
    .then(() => persistPhotos(listingId, urls, false))
    .finally(() => {
      if (photoHashJobs.get(listingId) === task) photoHashJobs.delete(listingId);
    });
  photoHashJobs.set(listingId, task);
  return task;
}

async function waitForPhotoHashes(listingId: number) {
  await photoHashJobs.get(listingId)?.catch(() => {});
}


/**
 * Check a listing by URL. This is what the API calls.
 *
 * Emits a verdict TWICE when vision is on: once from text alone so the user has
 * something immediately, then again once photos have been read. Both are real
 * verdicts, not a placeholder and a real one.
 */
export async function checkListing(url: string, opts: CheckOptions = {}): Promise<CheckResult> {
  return checkFetched(await fetchListing(url), opts);
}

/**
 * Same pipeline, for a listing somebody else already fetched.
 *
 * This is the seam that lets Facebook Marketplace in. Facebook needs a real
 * logged-in browser, so it cannot be a `fetch()` behind `fetchListing` — but
 * once it has produced a `RawListing`, every stage after that point is
 * source-agnostic and MUST stay that way. Signals, matching, vision and the
 * verdict should never learn which site a listing came from; the moment one of
 * them branches on `source`, the eval set stops meaning anything.
 */
export async function checkFetched(listing: RawListing, opts: CheckOptions = {}): Promise<CheckResult> {
  listing = normalizedListing(listing);
  const t0 = Date.now();
  const since = () => Date.now() - t0;
  const emit = (stage: StageName, data: unknown) =>
    opts.onStage?.({ stage, elapsedMs: since(), data });

  const econ = opts.econ;

  emit("fetched", {
    title: listing.title,
    askingPriceCents: listing.askingPriceCents,
    location: listing.location,
    postedAt: listing.postedAt,
    photoUrls: listing.photoUrls,
  });

  let listingId: number | null = null;
  if (opts.persist) {
    if(opts.storedListingId) listingId=opts.storedListingId;
    else {
      const prior=db().query("SELECT id,description FROM listings WHERE source=? AND source_id=?").get(listing.source,listing.sourceId) as {id:number;description:string}|null;
      listingId = persistListing(listing);
      if(listing.description || !prior?.description) syncPhotoUrls(listingId, listing.photoUrls,listing.description?now():undefined);
      // Pricing the card alone would throw away the details we just preserved.
      if(!listing.description && prior) listing=checkStored(listingId).listing;
    }
  }
  const evidenceId = listingId ?? (db().query("SELECT id FROM listings WHERE source=? AND source_id=?").get(listing.source,listing.sourceId) as {id:number}|null)?.id;
  const extraction=rawObject(rawObject(listing.raw).extraction);
  if(listingId&&!opts.storedListingId&&listing.source==='craigslist'&&typeof extraction.complete==='boolean')
    recordDetailAttempt(listingId,'read',Date.now(),{complete:extraction.complete,reason:extraction.complete?'complete':'incomplete'});
  let vision = evidenceId && photosUnchanged(evidenceId, listing.photoUrls)
    ? loadCurrentVision(evidenceId,VISION_MODEL,PROMPT_VERSION) : null;

  // Paid work is optional; preserving applicable stored evidence is not.
  const cluster = clusterSize(listing.sellerRef);
  let out = runPipeline(listing, vision, { econ, driveMinutes: opts.driveMinutes, clusterSize: cluster,recovery:evidenceId?readReceipt(evidenceId):null });
  emit("signals", { signals: out.signals.signals, category: out.signals.category,
    listingQuality: out.signals.listingQuality, sellerSophistication: out.signals.sellerSophistication });
  emit("valued", { match: out.match, verdict: out.verdict });

  // --- vision: refines the verdict -------------------------------------
  // Cache first. A listing analysed before is instant, and popular listings get
  // checked repeatedly by different people. Without this, every check re-pays
  // the full cost and the full wait for photos that haven't changed.
  // Paid work is opt-in at every caller. A missing option must never spend.
  const wantVision = opts.vision === true;

  /**
   * TIER 1 — same listing, same photos, no download.
   *
   * The listing-id cache alone was WRONG: a seller who swaps the photos keeps
   * being described by the analysis of pictures that are no longer there. The
   * URL set is a free staleness check, because Craigslist image ids change when
   * a photo changes.
   */
  if (vision) emit("vision", { vision, verdict: out.verdict, cached: "listing" });

  if (wantVision && listingId && !vision) {
    const workspace=createPhotoWorkspace(listingId);
    emit("vision_start", { photoCount: listing.photoUrls.length });
    // A text-only drain may still be hashing these URLs in memory. Let it finish
    // before this pass replaces the same rows with file-backed copies.
    await waitForPhotoHashes(listingId);
    try {
      await persistPhotos(listingId, listing.photoUrls, true,workspace);

      /**
       * TIER 2 — these exact PHOTOS have been analysed before, on any listing.
       *
       * Catches the two cases the listing-id key cannot: a seller reposting the
       * same item next week, and two different sellers using the same stock or
       * stolen photos. Both pay full price under the old key.
       */
      const fp = photoFingerprint(listingId);
      if (fp) {
        const hit = loadVisionByFingerprint(fp, VISION_MODEL, PROMPT_VERSION);
        if (hit) {
          vision = hit;
          // Record the reuse against THIS listing at zero cost, so the cache hit
          // is visible in the archive rather than looking like it never ran.
          db().query(
            `INSERT INTO vision_results (listing_id, model, payload, duration_ms, created_at, cost_micros, photo_fingerprint, prompt_version)
             VALUES ($lid,$model,$p,0,$now,0,$fp,$pv)`,
          ).run({ $lid: listingId, $model: VISION_MODEL, $p: JSON.stringify(hit), $now: now(), $fp: fp, $pv: PROMPT_VERSION });
          out = runPipeline(listing, vision, { econ, driveMinutes: opts.driveMinutes, clusterSize: cluster,recovery:evidenceId?readReceipt(evidenceId):null });
          emit("vision", { vision, verdict: out.verdict, cached: "photos" });
        }
      }

      if (!vision) {
        vision = await analyzePhotos(listingId,workspace.path);
        if (vision) {
          db().query(
            `INSERT INTO vision_results (listing_id, model, payload, duration_ms, created_at, cost_micros, photo_fingerprint, prompt_version, budget_reservation_id)
             VALUES ($lid,$model,$p,$ms,$now,$cost,$fp,$pv,$reservation)`,
          ).run({
            $lid: listingId, $model: vision.model ?? VISION_MODEL, $p: JSON.stringify(vision),
            $ms: vision.usage?.ms ?? since(), $now: now(),
            // Micros, integer. The daily spend guard sums these and float drift in
            // a money guard is how a cap stops matching reality.
            $cost: Math.round((vision.usage?.costUsd ?? 0) * 1e6),
            $fp: fp, $pv: PROMPT_VERSION,
            $reservation: vision.budgetReservationId ?? null,
          });
          out = runPipeline(listing, vision, { econ, driveMinutes: opts.driveMinutes, clusterSize: cluster,recovery:evidenceId?readReceipt(evidenceId):null });
          emit("vision", { vision, verdict: out.verdict, cached: false });
        }
      }
    } finally {
      // This runs on API errors, parser errors and database errors alike. The
      // daily prune is a crash backstop, not the normal retention policy.
      if (!KEEP_PHOTOS) {
        releasePhotos(listingId,workspace);
        db().run("UPDATE listing_photos SET local_path=NULL WHERE listing_id=? AND substr(local_path,1,length(?))=?",[listingId,workspace.path,workspace.path]);
      }
    }
  } else if (opts.persist && listingId && !wantVision) {
    // Photos are wanted for the phash index and any later vision run, but they
    // are NOT on the critical path when vision is off. Blocking on them added
    // ~1.1s to a response that was otherwise complete at 163ms.
    void queuePhotoHashes(listingId, listing.photoUrls).catch(() => {});
  }

  if (listingId) {
    // A personalized calculation may be returned to its requester, but never
    // replace the canonical decision shared by feed, scheduler and other accounts.
    const canonical=opts.econ || opts.driveMinutes!=null
      ? runPipeline(listing,vision,{clusterSize:clusterSize(listing.sellerRef)}):out;
    storeVerdict(listingId, ENGINE_VERSION, canonical.verdict);
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
              location, posted_at, updated_at, photo_count, seller_ref, raw_json
       FROM listings WHERE id = $id`,
    )
    .get({ $id: listingId }) as any;
  if (!r) throw new Error(`no listing ${listingId}`);

  const listing: RawListing = {
    source: r.source, sourceId: r.source_id, url: r.url, title: r.title ?? "",
    description: r.description ?? "", askingPriceCents: r.asking_price_cents,
    location: r.location, postedAt: r.posted_at, updatedAt: r.updated_at,
    photoUrls: (db().query("SELECT url FROM listing_photos WHERE listing_id=? ORDER BY position").all(listingId) as Array<{url:string}>).map(p=>p.url),
    attributes: storedAttributes(r.raw_json), raw: rawObject(r.raw_json), sellerRef:r.seller_ref,
  };

  const out = runPipeline(listing, loadCurrentVision(listingId,VISION_MODEL,PROMPT_VERSION), {
    econ: opts.econ, driveMinutes: opts.driveMinutes, clusterSize: clusterSize(r.seller_ref),recovery:readReceipt(listingId),
  });
  return { ...out, listing };
}

/**
 * BUMP THIS whenever matching, signals or valuation change behaviour.
 *
 * It is not decoration:  in the API scheduler compares it to
 *  and re-scores production on any mismatch. Without a
 * bump, an engine fix deploys and the live feed keeps serving the old verdicts
 * — which is exactly what happened when the Nintendo-Switch matcher bug was
 * fixed and two network switches stayed on the site anyway.
 *
 * 0.3.1 — single-character discriminators + variant gating in matchSku.
 * 0.3.2 — crypto payment rail, ships-on-local-market, Craigslist bare attrs.
 * 0.3.3 — title-first category, unknown=out-of-scope, Apple M5, feed paging.
 * 0.3.4 — archive import runs unconditionally so catalog rows reach prod.
 * 0.3.5 — laptop-before-prebuilt, bare i7 counts, monitors/bulk out of scope.
 * 0.3.6 — storage extraction no longer reads RAM as the drive capacity.
 * 0.3.7 — counterfeit detection: a clone is a blocker, not a discount.
 * 0.3.8 — bulk-listing pattern catches plural "laptops for sale".
 * 0.3.17 — refreshed facts preserve first capture and paid vision is opt-in.
 * 0.3.18 — every paid path uses one atomic daily-budget ledger.
 * 0.3.19 — unresolved category hard blockers always veto BUY.
 * 0.3.20 — category agreement, brand boundaries, printer purge, 256G storage.
 *
 * 0.3.32 — THE PARTS PASS. The engine could not price RAM, storage, PSUs,
 *           motherboards or cases at all: the `component` category was 56 CPUs
 *           and nothing else, so the comps crawler had never asked eBay about
 *           any of them. Five categories added, CPU gaps filled, and a
 *           `Gaming PC <GPU>` prebuilt SKU created per gaming GPU — 50 of 64
 *           GPUs had none, which is why a custom tower could not be valued.
 *           Comps 25,171 -> 28,546; SKUs 441 -> 559.
 *
 *           Three comp-discarding bugs fixed in the same pass, each of which
 *           was throwing away CORRECT rows: a unit suffix read as a variant
 *           ("6000MT/s" rejected 81 of 122 real Fury Beast sales), a whole
 *           machine with no head noun surviving the parts filter (one $680
 *           Omen 45L PC became the only comp for a ~$180 case), and a tech
 *           word glued to a furniture word read as the product ("computer
 *           desk" priced as a computer).
 *
 * 0.3.27 — the profit floor is $100 flat to a 20-minute drive. The hourly rate
 *           goes $125 -> $80, which puts the crossover exactly there; at $125
 *           the clock was the binding term at EVERY distance and the $100 floor
 *           was unreachable.
 * 0.3.26 — a spec screen is evidence FOR the seller. Vision signals carry
 *           their own polarity instead of being cast negative, `specScreens`
 *           emits a positive SPEC_SCREEN_PROOF, SCREENSHOT_ARTIFACTS drops to
 *           medium when the listing also shows a spec readout, and a positive
 *           signal no longer generates a question.
 *
 * 0.3.6 is also the reminder that this list is not a changelog. The storage
 * fix shipped WITHOUT a bump and production kept serving the old verdicts,
 * because reverdictStale found nothing stale — the stored rows already claimed
 * the current version. Exactly the failure this constant was made load-bearing
 * to prevent, two days after writing that down.
 */
// 0.3.33: preserve item/quantity/price pairs in placeholder inventory ads.
// Never compare the headline $1 with a median assembled from different items.
// 0.3.36: ambiguous MacBook families cannot pool Intel and Apple Silicon sales.
// 0.3.48: phone numbers spelled out in words are an off-platform redirect, and
// a below-market price only earns VERIFY when the deal would pay for the trip.
// 0.3.49: Yish's scope (2026-09-24): phones, tablets, wearables, accessories,
// office Windows machines and pre-2020 hardware are OUT_OF_SCOPE; laptops and
// whole PCs are no longer priced as their GPU; GPU sales prefer, not require,
// the board maker; minimum profit $75 (20-minute crossover) and local resale
// at 86.5% of eBay (eBay's ~13.5% cut).
export const ENGINE_VERSION = "0.3.49";
