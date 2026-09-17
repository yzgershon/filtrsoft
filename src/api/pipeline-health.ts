import {usableCompSql,soldEvidenceSql} from "../db/comp-evidence.ts";
import {catalogCoverage,catalogCoverageAsync,type CatalogCoverage} from "../valuation/coverage.ts";
import {pricingSignature} from '../db/revisions.ts';
/**
 * Is the pipeline actually working? Two questions health could not answer.
 *
 * Yish, 2026-09-03: *"there hasnt been a verify first or buy it listing thats
 * come in in the past 3 days I just want to make sure everything is still
 * working ... i think all the listings that have come in passively have been
 * cant tells."*
 *
 * Diagnosing that took an hour of pulling the live feed apart, and the two
 * things that turned out to matter were both INVISIBLE from outside:
 *
 *   1. **Whether vision ever runs.** `spentTodayUsd: 0` is ambiguous — it means
 *      either "nothing needed a photo read" or "the pass is broken", and those
 *      have opposite fixes.
 *   2. **Whether the comps have gone stale.** `valueSku` only counts a sale
 *      inside a **90-day window**, and the comps arrive frozen in a shipped
 *      archive. So the priceable share of the catalog DECAYS on its own, with
 *      no error anywhere, and the symptom is exactly what he reported: fewer
 *      and fewer real verdicts until the feed is all "can't tell".
 *
 * ⚠ THE SECOND ONE IS A CLOCK, NOT A STATE. Nothing here refills comps — that
 * is `bun run ebay:comps` on a machine with his eBay login — so "fine today"
 * is not "fine". `daysOfRunway` is the number that matters, and it only ever
 * goes down.
 */
import { db } from "../db/index.ts";
import { isoAgo } from "../db/time.ts";

export interface CompsHealth {
  total: number;
  usable: number;
  /** Newest sale we hold. If this stops moving, nothing is refilling comps. */
  newestSoldAt: string | null;
  ageDays: number | null;
  skusTotal: number;
  skusPriceable: number;
  recentLinkedSkus: number;
  quarantined: number;
  coverageByCategory: Record<string,{ok:number;sparse:number;no_comps:number}>;
  collectionScope:'server-local-attempts';
  collection24h: {attempts:number;completed:number;fetched:number;parsed:number;accepted:number;saved:number;errors:number};
  insufficientReasons: Array<{reason:string;count:number}>;
  /** Roughly how long before the CURRENT stock ages out of the 90-day window. */
  daysOfRunway: number | null;
  warning: string | null;
  coverageCurrent?: boolean;
}

/** Must match `valueSku`'s window, or this reports on a population nothing uses. */
export const COMP_WINDOW_DAYS = 90;

/** Read at call time: the scheduler owns the default, and env can override it. */
const VISION_PER_RUN = () => Number(process.env.FILTRSOFT_CRAWL_VISION ?? 10);

export function compsHealth(coverage:CatalogCoverage[]=catalogCoverage()): CompsHealth {
  const d = db();
  const one = <T>(sql: string, ...a: unknown[]) => d.query(sql).get(...(a as [])) as T;

  const total = one<{ n: number }>("SELECT COUNT(*) n FROM comps").n;
  const usable = one<{ n: number }>(
    `SELECT COUNT(*) n FROM comps
      WHERE ${usableCompSql()}`).n;
  const newest = one<{ m: string | null }>(`SELECT MAX(sold_at) m FROM comps WHERE ${soldEvidenceSql()}`).m;
  const skusTotal=coverage.length;
  const recentLinkedSkus = one<{ n: number }>(
    `SELECT COUNT(DISTINCT sku_id) n FROM comps
      WHERE ${usableCompSql()}`).n;

  const skusPriceable=coverage.filter(s=>s.status==='ok').length;
  const coverageByCategory:CompsHealth['coverageByCategory']={};
  for(const s of coverage){const c=coverageByCategory[s.category]??={ok:0,sparse:0,no_comps:0};c[s.status as keyof typeof c]++;}
  const quarantined=one<{n:number}>('SELECT (SELECT COUNT(*) FROM comp_quarantine)+(SELECT COUNT(*) FROM quarantined_comp_history) n').n;
  const collection24h=one<CompsHealth['collection24h']>(`SELECT COUNT(*) attempts,COUNT(finished_at) completed,
    COALESCE(SUM(fetched),0) fetched,COALESCE(SUM(parsed),0) parsed,COALESCE(SUM(accepted),0) accepted,
    COALESCE(SUM(saved),0) saved,COUNT(error) errors FROM comp_collection_attempts WHERE started_at>=?`,isoAgo(86400000));
  const insufficientReasons=d.query(`SELECT COALESCE(json_extract(v.payload,'$.decidingUnknown'),'unspecified') reason,COUNT(*) count
    FROM listings l JOIN verdicts v ON v.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id)
    WHERE l.delisted_at IS NULL AND v.call='INSUFFICIENT_DATA' GROUP BY reason ORDER BY count DESC`).all() as CompsHealth['insufficientReasons'];

  const ageDays = newest
    ? Math.floor((Date.now() - Date.parse(newest)) / 86_400_000)
    : null;

  /**
   * ⚠ RUNWAY IS MEASURED FROM THE NEWEST COMP, NOT FROM TODAY. The window is
   * 90 days wide and the freshest thing in it is already `ageDays` old, so the
   * last comp falls out `90 - ageDays` days from now. Nothing tops it up in
   * between.
   */
  const daysOfRunway = ageDays == null ? null : Math.max(0, COMP_WINDOW_DAYS - ageDays);

  let warning: string | null = null;
  if (!total) {
    warning = "no comps at all — every verdict will be INSUFFICIENT_DATA";
  } else if (daysOfRunway != null && daysOfRunway <= 14) {
    warning = `comps run out in ~${daysOfRunway} days. Run \`bun run ebay:comps\` and \`bun run archive\`, then redeploy.`;
  } else if (skusTotal && skusPriceable / skusTotal < 0.75) {
    warning = `only ${skusPriceable} of ${skusTotal} models can be priced; the remainder lack at least three suitable used-condition comps inside ${COMP_WINDOW_DAYS} days.`;
  }

  return { total, usable, recentLinkedSkus,quarantined,coverageByCategory,collectionScope:'server-local-attempts',collection24h,insufficientReasons,newestSoldAt: newest, ageDays, skusTotal, skusPriceable, daysOfRunway, warning };
}

export async function compsHealthAsync():Promise<CompsHealth> {
  const snapshot=await catalogCoverageAsync();
  return {...compsHealth(snapshot.rows),coverageCurrent:snapshot.signature===pricingSignature(db())};
}

export interface VisionHealth {
  reads24h: number;
  reads7d: number;
  lastReadAt: string | null;
  /** Listings eligible for a paid photo read right now. */
  candidatePool: number;
  /**
   * Listings this process tried and could not fetch, and gave up on.
   *
   * ⚠ A RISING NUMBER HERE IS NOT AN ERROR, IT IS THE EXPECTED COST OF
   * production having no browser: a Facebook listing pushed from his machine
   * can never be re-fetched from the container. It matters because it is what
   * distinguishes "the pass is working and skipping what it cannot read" from
   * the deadlock that hid for three days.
   */
  unreadable: number;
  /**
   * The shortlist AFTER the JS filters, i.e. what a tick would actually try.
   *
   * ⚠ `candidatePool` AND THIS CAN DISAGREE, AND THE GAP IS DIAGNOSTIC.
   * Eligibility checks current photos and then drops anything
   * that is not `kind: "tech"` or that reads as an accessory. A big pool with
   * an empty shortlist means the pass returns 0 without attempting anything —
   * which records no read AND no failure, and is indistinguishable from a
   * broken pass in every other metric.
   */
  shortlist: number;
  warning: string | null;
}

/** Uses the scheduler's actual eligibility logic with an unlimited batch size. */
export function visionHealth(model: string, promptVersion: string): VisionHealth {
  const d = db();
  const one = <T>(sql: string, ...a: unknown[]) => d.query(sql).get(...(a as [])) as T;

  const reads24h = one<{ n: number }>(
    "SELECT COUNT(*) n FROM vision_results WHERE created_at >= ?",isoAgo(86_400_000)).n;
  const reads7d = one<{ n: number }>(
    "SELECT COUNT(*) n FROM vision_results WHERE created_at >= ?",isoAgo(7*86_400_000)).n;
  const lastReadAt = one<{ m: string | null }>("SELECT MAX(created_at) m FROM vision_results").m;

  // Count the exact current-photo eligibility population before the batch slice.
  let candidatePool=-1,shortlist=-1;
  try {
    const {visionCandidates}=require('../crawler/vision-pass.ts');
    candidatePool=visionCandidates(Number.MAX_SAFE_INTEGER).length;
    shortlist=Math.min(candidatePool,VISION_PER_RUN());
  } catch { /* -1 means unavailable, never an invented healthy zero */ }
  const unreadable=one<{n:number}>("SELECT COUNT(*) n FROM vision_misses WHERE tries>=3").n;

  const warning = candidatePool > 20 && reads24h === 0
    ? `${candidatePool} listings are waiting on a photo read and none has run in 24h`
    : null;

  return { reads24h, reads7d, lastReadAt, candidatePool, unreadable, shortlist, warning };
}

/** These are observed stages for one capture cohort, not invented conversion
 * rates. Unrecorded historical provenance/sync is null or counted separately.
 */
export function pipelineFunnel() {
  const d=db(),since=isoAgo(86400000);
  const rows=d.query(`SELECT l.id,l.description,l.delisted_at,l.posted_at,l.last_seen,l.captured_at,
    v.call,v.payload,(SELECT MIN(created_at) FROM verdicts WHERE listing_id=l.id) first_score,
    EXISTS(SELECT 1 FROM listing_photos WHERE listing_id=l.id) photos
    FROM listings l LEFT JOIN verdicts v ON v.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id)
    WHERE l.captured_at>=?`).all(since) as any[];
  const table=(name:string)=>Boolean(d.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  const sync=table('sync_versions')?new Set((d.query('SELECT DISTINCT listing_id FROM sync_versions').all() as any[]).map(r=>r.listing_id)):null;
  const sent=table('alert_sent')?new Set((d.query('SELECT DISTINCT listing_id FROM alert_sent').all() as any[]).map(r=>r.listing_id)):null;
  const counts={discovered:rows.length,detailed:0,photos:0,decisionProvenance:0,exactIdentity:0,usableEvidence:0,scored:0,feedEligible:0,
    synchronized:sync?0:null,alerted:sent?0:null};
  const latency:number[]=[];
  for(const r of rows){
    const v=r.payload?JSON.parse(r.payload):null,p=v?.provenance;
    if(r.description?.trim())counts.detailed++;if(r.photos)counts.photos++;
    if(p)counts.decisionProvenance++;
    if(p?.match?.skuId && p.match.confidence!=='low')counts.exactIdentity++;
    if(v?.valuation?.status==='ok')counts.usableEvidence++;
    if(r.call)counts.scored++;
    if(r.call && r.call!=='OUT_OF_SCOPE' && !r.delisted_at && (r.posted_at??r.last_seen??r.captured_at)>=isoAgo(28*86400000))counts.feedEligible++;
    if(sync?.has(r.id))counts.synchronized!++;if(sent?.has(r.id))counts.alerted!++;
    const seconds=(Date.parse(r.first_score)-Date.parse(r.captured_at))/1000;if(Number.isFinite(seconds)&&seconds>=0)latency.push(seconds);
  }
  latency.sort((a,b)=>a-b);
  const pending=d.query(`SELECT COUNT(*) count,MIN(l.captured_at) oldest FROM listings l WHERE l.delisted_at IS NULL AND NOT EXISTS(SELECT 1 FROM verdicts v WHERE v.listing_id=l.id)`).get();
  const stages=d.query(`SELECT stage,status,COUNT(*) count FROM crawl_job_stages WHERE started_at>=? GROUP BY stage,status`).all(since);
  return {cohort:{capturedSince:since},counts,firstScoreSeconds:{samples:latency.length,
    p50:latency.length?latency[Math.floor((latency.length-1)*0.5)]:null,p95:latency.length?latency[Math.floor((latency.length-1)*0.95)]:null},
    pendingFirstScore:pending,agentStages24h:stages,
    definitions:{feedEligible:'Base live 28-day feed population before account/discovery/Review filters',synchronized:'Versioned facts acknowledged in this receiver database',alerted:'At least one acknowledged push delivery',exactIdentity:'Recorded current decision resolves a SKU above low confidence',usableEvidence:'Current decision valuation status ok; risk and missing listing facts can still block an actionable call'}};
}
