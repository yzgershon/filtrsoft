/**
 * The vision pass — read photos for listings whose specs are in the pictures.
 *
 * **WHY IT IS ITS OWN PASS NOW.** Vision used to run inside the crawl, on
 * listings analysed in that same run. That coupled two things with completely
 * different economics: text analysis is free and should happen the moment a
 * listing appears, while a photo read costs money and can happen whenever. It
 * also meant a listing analysed yesterday could NEVER get its photos read, no
 * matter how obviously it needed them, because the crawl only ever looked at
 * what it had just discovered.
 *
 * That left a standing backlog. Measured 2026-08-27: **62 listings sat at
 * "Can't be valued — cpu not stated" and similar**, which is precisely the case
 * a photo can resolve, and none of them were ever revisited.
 *
 * Splitting it also protects alert latency. The text verdict is what fires an
 * alert; making somebody wait on a photo read to be told about a 4090 spends
 * the very latency the split-loop redesign exists to recover. Vision runs LAST
 * in a tick, after alerts have already gone out.
 *
 * ── WHAT DESERVES A PAID READ ──────────────────────────────────────────────
 *
 * **INSUFFICIENT_DATA is two different problems and only one is a photo
 * problem.** This is the rule that keeps the budget from evaporating:
 *
 *     "Can't be valued — cpu not stated"      the spec may be IN a photo. Yes.
 *     "No recent sold comps for this model"   a photo cannot conjure a comp.
 *     "Couldn't identify the exact model"     no amount of looking will help.
 *
 * Measured previously: a Dell 7310 with no comps cost $0.0095 and 15.6 seconds
 * to read six photos and came back INSUFFICIENT_DATA for exactly the reason it
 * went in. So the selector below matches the "not stated" headline specifically
 * rather than the call.
 *
 * Actionable calls (BUY / VERIFY / RISK) also qualify — those are listings
 * somebody may act on, where a photo either confirms the case or kills it.
 */
import { db } from "../db/index.ts";
import { checkListing } from "../engine/index.ts";
import { budgetAvailable, visionKilled } from "../api/guard.ts";
import { resolveProductType } from "../signals/product-type.ts";
import { PROMPT_VERSION, VISION_MODEL } from "../vision/index.ts";

interface Candidate { id: number; url: string; title: string; call: string; headline: string }

/**
 * ⚠ AN ACCESSORY *FOR* A DEVICE READS AS THE DEVICE.
 *
 * `resolveProductType` picks a head noun, and in "HP XL 17" Laptop
 * **Bag**-Handles+Adj.Padded Shoulder Strap" the winning noun is "laptop"; in
 * "Logitech Rugged **Folio** with Keyboard - iPad 7th, 8th & 9th Gen" it is
 * "ipad". Both came back `kind: "tech"` and both reached the vision shortlist,
 * where they would have cost real money to photograph a bag.
 *
 * The general classifier is used in a dozen places and changing its head-noun
 * rules is a wide, risky edit. **The money-spending path gets its own stricter
 * filter instead** — refusing here costs one skipped read, while being wrong
 * costs cash on every pass, forever.
 *
 * Anchored on the accessory word being present at all, because these titles
 * always name the thing being sold even when the classifier prefers the device
 * it attaches to.
 */
const ACCESSORY_FOR =
  /\b(bag|case|folio|sleeve|backpack|briefcase|strap|shoulder pad|cover|skin|screen protector|stand|mount|dock|docking station|charger|power cord|cable|adapter|carrying)\b/i;

export function isAccessoryFor(title: string): boolean {
  return ACCESSORY_FOR.test(title);
}

/**
 * Listings worth spending on, best first.
 *
 * Driven entirely by SQL against stored verdicts — no re-scoring — because
 * re-running the engine over every listing just to build a shortlist costs more
 * than the pass itself.
 *
 * A current model+prompt result is the no-double-spend guarantee. Results from
 * an older prompt do not suppress a revisit forever; otherwise bumping the
 * prompt version fixes new listings while every old listing stays stale.
 */
export function visionCandidates(limit: number): Candidate[] {
  const rows = db().query(`
    SELECT l.id, l.url, l.title, v.call, json_extract(v.payload, '$.headline') AS headline
    FROM listings l
    JOIN verdicts v ON v.id = (SELECT MAX(id) FROM verdicts WHERE listing_id = l.id)
    WHERE l.delisted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM vision_results r
         WHERE r.listing_id = l.id AND r.model = $model AND r.prompt_version = $prompt
      )
      AND (
        v.call IN ('BUY','VERIFY','RISK')
        OR (v.call = 'INSUFFICIENT_DATA' AND json_extract(v.payload, '$.headline') LIKE '%not stated%')
      )
    ORDER BY
      CASE v.call WHEN 'BUY' THEN 0 WHEN 'VERIFY' THEN 1 WHEN 'RISK' THEN 2 ELSE 3 END,
      l.id DESC
    LIMIT $lim
  `).all({ $lim: limit * 3, $model: VISION_MODEL, $prompt: PROMPT_VERSION }) as Candidate[];

  /**
   * Never pay to look at furniture. A "computers" category crawl surfaces
   * desks, chairs and bags, and an unpriceable desk looks exactly like an
   * unpriceable laptop to the SQL above.
   */
  return rows
    .filter((r) => resolveProductType(r.title ?? "").kind === "tech")
    .filter((r) => !isAccessoryFor(r.title ?? ""))
    .slice(0, limit);
}

/**
 * Run vision over the shortlist. Returns how many were actually read.
 *
 * **The budget is checked before EVERY listing, not once at the top.** A pass
 * that checks once and then reads eight photos can overshoot by seven, and a
 * money guard that can be exceeded is not a guard. This is the same rule the
 * crawler already follows.
 */
export async function visionPass(
  limit: number,
  onProgress: (m: string) => void = () => {},
): Promise<number> {
  if (visionKilled()) return 0;
  if (!budgetAvailable()) { onProgress("daily budget reached, skipping"); return 0; }

  const cands = visionCandidates(limit);
  if (!cands.length) return 0;

  let read = 0, changed = 0;
  for (const c of cands) {
    if (!budgetAvailable()) { onProgress("daily budget reached mid-pass"); break; }
    try {
      const r = await checkListing(c.url, { persist: true, vision: true });
      read++;
      if (r.verdict.call !== c.call) {
        changed++;
        onProgress(`${c.call} -> ${r.verdict.call}  ${c.title.slice(0, 44)}`);
      }
    } catch {
      /**
       * A dead listing must not stop the pass, and must not be retried
       * forever either — the sweep will mark it delisted, which removes it
       * from `visionCandidates` permanently.
       */
    }
  }
  if (read) onProgress(`read ${read}, ${changed} changed call`);
  return read;
}
