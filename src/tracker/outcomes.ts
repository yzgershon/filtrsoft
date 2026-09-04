/**
 * The outcome loop — the only thing that can tell Filtrsoft whether it is RIGHT.
 *
 * Until now `outcomes` was empty, which meant nothing anywhere fed a verdict
 * back against reality. The engine's accuracy was whatever Yish said it was
 * after hand-auditing 69 listings, and that does not scale past 69.
 *
 * TWO KINDS OF OUTCOME, and they are not equally trustworthy:
 *
 *   OBSERVED   the delisting tracker saw a listing vanish. Free, automatic, and
 *              accumulates every day the sweep runs. It says the market cleared
 *              at a price — never that YOU made money.
 *   REPORTED   Yish bought or passed and says what happened. Rare, slow, and
 *              the only source of true realised margin.
 *
 * Observed outcomes are recorded with `action='dead_listing'` and a clearing
 * price; reported ones use `bought`/`passed`. **They are kept distinguishable on
 * purpose** — mixing an inferred clearing price into realised-profit stats would
 * quietly turn "what the market paid" into "what Yish earned", which are
 * different numbers and only one of them pays for petrol.
 *
 * WHAT IT MEASURES:
 *   calibration   we said market was $400; it cleared at $320. Are we HIGH?
 *   liquidity     did BUY-rated items actually move fast?
 *   the fatal one is a scam we called BUY, which the gate now prevents
 */
import { db, now } from "../db/index.ts";
import { outcomes as inferOutcomes, type Outcome } from "./index.ts";

export interface RecordStats {
  considered: number;
  recorded: number;
  skipped: number;
}

/**
 * Turn tracker inferences into outcome rows.
 *
 * Only `likely_sold` is recorded. `possibly_sold` and `no_signal` are noise —
 * an expired listing says nothing about a sale, and writing it as an outcome
 * would drag every measured clearing price toward whatever unsold junk sits
 * longest. Reposts are excluded by construction; they are the phantom-sale case
 * that would bias clearing prices upward.
 */
export function recordObservedOutcomes(): RecordStats {
  const st: RecordStats = { considered: 0, recorded: 0, skipped: 0 };
  const all: Outcome[] = inferOutcomes();

  const exists = db().prepare(
    `SELECT id FROM outcomes WHERE listing_id=$id AND action='dead_listing'`,
  );
  const ins = db().prepare(
    `INSERT INTO outcomes (listing_id, sku_id, action, sold_price_cents, sold_at,
       days_to_sell, notes, created_at)
     VALUES ($lid,$sku,'dead_listing',$price,$sold,$days,$notes,$now)`,
  );
  const skuOf = db().prepare(
    `SELECT v.payload FROM verdicts v WHERE v.listing_id=$id ORDER BY v.id DESC LIMIT 1`,
  );

  for (const o of all) {
    st.considered++;
    if (o.signal !== "likely_sold") { st.skipped++; continue; }
    if (exists.get({ $id: o.listingId })) { st.skipped++; continue; }

    // The SKU comes from the stored verdict, so a clearing price is attributable
    // to a model rather than floating free.
    let skuId: number | null = null;
    try {
      const row = skuOf.get({ $id: o.listingId }) as { payload: string } | null;
      if (row) skuId = JSON.parse(row.payload)?.match?.skuId ?? null;
    } catch { /* an unparseable verdict must not stop the loop */ }

    ins.run({
      $lid: o.listingId, $sku: skuId, $price: o.clearingPriceCents,
      $sold: null, $days: o.daysOnMarket === null ? null : Math.round(o.daysOnMarket),
      $notes: o.reason, $now: now(),
    });
    st.recorded++;
  }
  return st;
}

export interface Calibration {
  call: string;
  n: number;
  /** Median days on market for listings we gave this call. */
  medianDays: number | null;
  /** How our predicted market value compared to what it actually cleared at. */
  medianErrorPct: number | null;
}

/**
 * Was the engine right?
 *
 * The headline number is **valuation error**: our predicted median against the
 * price the item actually cleared at. Systematically high means every BUY is
 * overstated and the floor is not really being cleared — the failure mode that
 * loses money quietly, because each individual verdict still looks reasonable.
 *
 * Days-on-market by call is the liquidity check. A BUY that sits for 40 days is
 * not the deal we said it was, whatever the arithmetic said.
 */
export function calibration(): Calibration[] {
  const rows = db()
    .query(
      `SELECT v.call, o.sold_price_cents, o.days_to_sell, v.payload
       FROM outcomes o
       JOIN verdicts v ON v.id = (SELECT MAX(id) FROM verdicts WHERE listing_id = o.listing_id)
       WHERE o.action = 'dead_listing' AND o.sold_price_cents IS NOT NULL`,
    )
    .all() as Array<{ call: string; sold_price_cents: number; days_to_sell: number | null; payload: string }>;

  const byCall = new Map<string, { days: number[]; errs: number[] }>();
  for (const r of rows) {
    const b = byCall.get(r.call) ?? { days: [], errs: [] };
    if (r.days_to_sell !== null) b.days.push(r.days_to_sell);
    try {
      const predicted = JSON.parse(r.payload)?.valuation?.medianCents;
      // Only listings we actually PRICED can score a valuation error.
      if (predicted && r.sold_price_cents) {
        b.errs.push(((predicted - r.sold_price_cents) / r.sold_price_cents) * 100);
      }
    } catch { /* ignore */ }
    byCall.set(r.call, b);
  }

  const med = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };

  return [...byCall.entries()]
    .map(([call, b]) => ({
      call, n: b.days.length || b.errs.length,
      medianDays: med(b.days),
      medianErrorPct: med(b.errs) === null ? null : Math.round(med(b.errs)! * 10) / 10,
    }))
    .sort((a, b) => b.n - a.n);
}

/**
 * Record a real buy/pass. This is the high-value, low-volume half.
 *
 * `purchase_price_cents` plus a later `sold_price_cents` is the ONLY path to
 * measured realised margin, and it is what eventually replaces the guessed
 * `FACEBOOK_GROSS_RATIO` with a number that came from somewhere.
 */
export function recordReportedOutcome(o: {
  listingId: number;
  action: "bought" | "passed" | "no_reply" | "was_scam";
  purchasePriceCents?: number;
  soldChannel?: string;
  soldPriceCents?: number;
  feesCents?: number;
  shippingCents?: number;
  daysToSell?: number;
  notes?: string;
}): number {
  const r = db()
    .query(
      `INSERT INTO outcomes (listing_id, action, purchase_price_cents, sold_channel,
         sold_price_cents, fees_cents, shipping_cents, days_to_sell, notes, created_at)
       VALUES ($lid,$act,$buy,$chan,$sell,$fees,$ship,$days,$notes,$now) RETURNING id`,
    )
    .get({
      $lid: o.listingId, $act: o.action, $buy: o.purchasePriceCents ?? null,
      $chan: o.soldChannel ?? null, $sell: o.soldPriceCents ?? null,
      $fees: o.feesCents ?? null, $ship: o.shippingCents ?? null,
      $days: o.daysToSell ?? null, $notes: o.notes ?? null, $now: now(),
    }) as { id: number };
  return r.id;
}

/** Realised margin on things actually bought and resold. The number that counts. */
export function realisedMargin(): Array<{
  listingId: number; buyCents: number; sellCents: number; netCents: number; days: number | null;
}> {
  return (db()
    .query(
      `SELECT listing_id, purchase_price_cents, sold_price_cents,
              COALESCE(fees_cents,0) f, COALESCE(shipping_cents,0) s, days_to_sell
       FROM outcomes
       WHERE action='bought' AND purchase_price_cents IS NOT NULL AND sold_price_cents IS NOT NULL`,
    )
    .all() as any[]).map((r) => ({
      listingId: r.listing_id,
      buyCents: r.purchase_price_cents,
      sellCents: r.sold_price_cents,
      netCents: r.sold_price_cents - r.purchase_price_cents - r.f - r.s,
      days: r.days_to_sell,
    }));
}
