/**
 * The delisting tracker — a comps source that needs nobody's approval.
 *
 * WHY THIS EXISTS: the comps archive is the core asset of this product, and as
 * of 2026-08-24 it is gated entirely behind an eBay developer application that
 * has already been rejected once. Depending on one company's approval queue for
 * the one thing the engine cannot work without is the biggest structural risk
 * in the plan, and it has nothing to do with whether the code is any good.
 *
 * We already crawl Craigslist. Nothing recorded whether a listing was still up.
 * Re-crawl and diff, and every disappearance carries information:
 *
 *   vanished day 3, never dropped price      sold at or near ask
 *   sat 26 days, two price cuts, vanished    sold low, or gave up
 *   vanished at day 30 untouched             aged out, says nothing
 *
 * What eBay CANNOT give: Boston clearing prices, on the channel Yish actually
 * buys and sells on, including the fee-free Facebook-style economics. eBay comps
 * are national, post-shipping and post-13%-fee. Both matter. Only one of them
 * can be taken away.
 *
 * It also compounds: every day this does not run is history nobody can refetch,
 * the same property that makes the eBay 90-day window so unforgiving.
 */
import { fetchSearchResults, probeListing, type DelistReason } from "../sources/craigslist.ts";
import { CATEGORIES } from "../crawler/index.ts";
import { distance } from "../photos/index.ts";
import { db, now } from "../db/index.ts";

export interface SweepStats {
  liveBefore: number;
  discovered: number;
  stillUp: number;
  probed: number;
  delisted: number;
  priceMoves: number;
  byReason: Record<string, number>;
}

interface LiveRow {
  id: number;
  source_id: string;
  url: string;
  asking_price_cents: number | null;
  last_price_cents: number | null;
}

/**
 * One pass: find what is still up, record price moves, confirm what is gone.
 *
 * The expensive part is bounded on purpose. Discovery is a handful of search
 * fetches covering ~120 listings each; only listings MISSING from those results
 * get an individual request, because a missing listing is not the same as a dead
 * one — it may simply be deeper in the pagination than we crawled. Probing is
 * what turns "I did not see it" into "it is gone, and here is why".
 */
export async function sweep(opts: {
  categories?: string[];
  pages?: number;
  concurrency?: number;
  /** Cap probes per run. Unset means probe every listing we did not see. */
  probeLimit?: number;
  onProgress?: (msg: string) => void;
} = {}): Promise<SweepStats> {
  const cats = opts.categories ?? CATEGORIES.map((c) => c.cat);
  // 1, not more: the static search endpoint ignores its offset parameter, so a
  // second page is the same bytes again. See fetchSearchUrls.
  const pages = opts.pages ?? 1;
  const conc = opts.concurrency ?? 4;
  const log = opts.onProgress ?? (() => {});
  const t = now();

  /**
   * ⚠ CRAIGSLIST ONLY. This sweep diffs against CRAIGSLIST search results, so
   * every Facebook, OfferUp and Mercari listing it loaded was guaranteed to be
   * "missing" and went into the individual-probe queue — where `probeListing`,
   * a Craigslist fetcher, was asked to read a facebook.com url.
   *
   * Nothing was corrupted, and only because two guards happened to hold: a
   * failed probe is treated as "keep it live" rather than "it is gone", and
   * `fetchListing` now refuses a non-Craigslist host outright. But the work was
   * pointless and one relaxed guard away from mass-delisting three sources.
   *
   * The browser-backed sources get their own delisting pass — see
   * `bun run probe`. They cannot be checked from a plain fetch, which is the
   * same reason they cannot be crawled from the container.
   */
  const live = db()
    .query(
      `SELECT id, source_id, url, asking_price_cents, last_price_cents
       FROM listings WHERE delisted_at IS NULL AND source = 'craigslist'`,
    )
    .all() as LiveRow[];

  const st: SweepStats = {
    liveBefore: live.length, discovered: 0, stillUp: 0,
    probed: 0, delisted: 0, priceMoves: 0, byReason: {},
  };

  /**
   * SEED THE BASELINE, or `listing_prices` is not a history and "was $1,800"
   * is wrong.
   *
   * The move-recording branch below only writes a row when the price CHANGES,
   * and the original branch only fires when the listing had no price at all.
   * So a listing captured at $1,800 that later drops to $1,500 ends up with
   * exactly ONE row in this table — holding $1,500. Anything reading
   * `MIN(observed_at)` as "the first price we saw" then gets the CURRENT price
   * back and computes a drop of zero, which is how the feed showed no price
   * moves on the same day a sweep reported four.
   *
   * `asking_price_cents` at `captured_at` is a real observation — it is what
   * the listing said when we first fetched it — so writing it here records
   * history rather than inventing it. Guarded on there being no row at or
   * before capture, which makes it idempotent AND backfills listings that
   * already have a change row but no origin.
   *
   * It has to live in the sweep rather than the crawler because the rows that
   * need fixing already exist.
   */
  const seeded = db().run(
    `INSERT INTO listing_prices (listing_id, price_cents, observed_at)
     SELECT l.id, l.asking_price_cents, l.captured_at
     FROM listings l
     WHERE l.asking_price_cents > 0
       AND NOT EXISTS (
         SELECT 1 FROM listing_prices p
         WHERE p.listing_id = l.id AND p.observed_at <= l.captured_at
       )`,
  );
  if (seeded.changes) log(`  seeded ${seeded.changes} baseline price rows`);

  // ---- 1. discover what is currently up, WITH prices -------------------
  const current = new Map<string, number | null>();
  for (const cat of cats) {
    for (let p = 0; p < pages; p++) {
      try {
        const found = await fetchSearchResults(cat, p * 120);
        for (const r of found) current.set(r.sourceId, r.askingPriceCents);
        log(`  ${cat} p${p + 1}: ${found.length}`);
      } catch (e) {
        // A failed page is a COVERAGE HOLE, not a set of dead listings. Say so
        // loudly: silently treating it as "nothing found" would mark every
        // listing on that page delisted, poisoning the archive permanently.
        log(`  ${cat} p${p + 1}: FAILED ${(e as Error).message} — listings on this page will be probed individually`);
      }
    }
  }
  st.discovered = current.size;
  log(`\n${st.discovered} listings currently up · ${live.length} we thought were live`);

  // ---- 2. still up: touch last_seen, record any price move -------------
  const missing: LiveRow[] = [];
  const touch = db().prepare(`UPDATE listings SET last_seen=$t, last_price_cents=$p WHERE id=$id`);
  const addPrice = db().prepare(
    `INSERT INTO listing_prices (listing_id, price_cents, observed_at) VALUES ($id,$p,$t)`,
  );

  for (const l of live) {
    if (!current.has(l.source_id)) { missing.push(l); continue; }
    st.stillUp++;
    const seen = current.get(l.source_id) ?? null;
    const known = l.last_price_cents ?? l.asking_price_cents;

    /**
     * ZERO IS "NO PRICE SHOWN", NEVER "FREE" — and recording it as a price is
     * how a $145 laptop acquires a $145 price DROP.
     *
     * A search card whose price fails to parse yields 0, and the branch below
     * only tests for `null`. Two listings in the local database had a real
     * `$145 -> $0` history from exactly this, which the feed would have ranked
     * as the biggest bargain on the site. Same family as the "missing asking
     * price became zero" trap already in HANDOFF.
     *
     * Treated as NOT OBSERVED: the listing keeps its last known price rather
     * than acquiring a fake one.
     */
    const price = seen !== null && seen > 0 ? seen : null;

    // Seed the baseline on first sight, then only write on an actual change.
    // A row per sweep per listing would be 341 rows a day of pure noise.
    if (price !== null && known === null) {
      addPrice.run({ $id: l.id, $p: price, $t: t });
    } else if (price !== null && known !== null && price !== known) {
      addPrice.run({ $id: l.id, $p: price, $t: t });
      st.priceMoves++;
    }
    touch.run({ $t: t, $p: price ?? known, $id: l.id });
  }
  log(`${st.stillUp} still up · ${st.priceMoves} price changes · ${missing.length} not seen`);

  // ---- 3. probe the missing ones individually --------------------------
  /**
   * ⚠ SORTED BEFORE SLICING, FOR THE SAME REASON `probe.ts` IS.
   *
   * `missing.slice(0, 150)` took whatever came out of the table first, so the
   * probe budget was spent in row order — and with 3,593 live Craigslist rows
   * against a cap of 150 a day, a given listing is looked at about once a
   * month. Two of the four live Craigslist BUYs had not been checked in two
   * days when this was measured. Rank by what he would act on.
   */
  const rank = new Map<number, number>();
  for (const r of db().query(
    `SELECT v.listing_id id, v.call FROM verdicts v
      WHERE v.id = (SELECT MAX(id) FROM verdicts WHERE listing_id = v.listing_id)`,
  ).all() as Array<{ id: number; call: string }>) {
    rank.set(r.id, { BUY: 0, VERIFY: 1, FAIR: 2 }[r.call] ?? 3);
  }
  missing.sort((a, b) => (rank.get(a.id) ?? 3) - (rank.get(b.id) ?? 3));

  const toProbe = opts.probeLimit ? missing.slice(0, opts.probeLimit) : missing;
  if (opts.probeLimit && missing.length > toProbe.length) {
    log(`  probing ${toProbe.length} of ${missing.length} (probeLimit) — the rest stay live until next sweep`);
  }

  const kill = db().prepare(
    `UPDATE listings SET delisted_at=$t, delist_reason=$r WHERE id=$id`,
  );

  for (let i = 0; i < toProbe.length; i += conc) {
    const batch = toProbe.slice(i, i + conc);
    await Promise.all(batch.map(async (l) => {
      try {
        const r = await probeListing(l.url);
        st.probed++;
        if (r.alive) {
          // Deeper in pagination than we crawled. Not dead.
          touch.run({ $t: t, $p: l.last_price_cents ?? l.asking_price_cents, $id: l.id });
          st.stillUp++;
          return;
        }
        kill.run({ $t: t, $r: r.reason, $id: l.id });
        st.delisted++;
        st.byReason[r.reason ?? "gone"] = (st.byReason[r.reason ?? "gone"] ?? 0) + 1;
      } catch {
        // A network failure is NOT a delisting. Leave it live and try next time.
        st.byReason.probe_failed = (st.byReason.probe_failed ?? 0) + 1;
      }
    }));
    if (toProbe.length > conc) log(`  probed ${Math.min(i + conc, toProbe.length)}/${toProbe.length}`);
  }

  db().query(
    `INSERT INTO sweeps (started_at, live_before, seen, probed, delisted, price_moves, created_at)
     VALUES ($s,$lb,$seen,$pr,$d,$pm,$n)`,
  ).run({
    $s: t, $lb: st.liveBefore, $seen: st.stillUp, $pr: st.probed,
    $d: st.delisted, $pm: st.priceMoves, $n: now(),
  });

  return st;
}

// --------------------------------------------------------------- inference

export type SaleSignal = "likely_sold" | "possibly_sold" | "no_signal" | "repost";

export interface Outcome {
  listingId: number;
  title: string;
  signal: SaleSignal;
  confidence: "high" | "medium" | "low";
  daysOnMarket: number | null;
  /** Last observed asking price — the best estimate of what it cleared for. */
  clearingPriceCents: number | null;
  /** Did the seller cut the price before it went? */
  priceDropCents: number | null;
  reason: string;
}

/**
 * Craigslist for-sale postings age out on their own. A deletion at day 3 and a
 * disappearance at day 30 are completely different events, and the boundary is
 * the only thing separating signal from noise here.
 *
 * This is deliberately a measured constant rather than a guess: once there are
 * enough `expired` rows, the real distribution is a SQL query away, and this
 * should be replaced by it. Until then 30 is the documented Craigslist default.
 */
const CL_EXPIRY_DAYS = 30;

const plural = (d: number) => `${d.toFixed(0)} ${Math.round(d) === 1 ? "day" : "days"}`;

const days = (a: string | null, b: string | null): number | null =>
  a && b ? (Date.parse(b) - Date.parse(a)) / 86_400_000 : null;

/**
 * Did this listing sell, and for how much?
 *
 * THE CONFOUND THAT MATTERS: sellers delete and repost to get back to the top of
 * the search results. That looks identical to a sale — the posting goes away —
 * and if it is counted as one, the archive fills with phantom sales at asking
 * price, which is the single most dangerous way this can be wrong. It would bias
 * every clearing price UPWARD, which turns into "this is a great deal" on things
 * that never sold. So a near-identical listing appearing shortly afterwards
 * outranks every other signal.
 */
export function inferOutcome(row: {
  id: number; title: string; posted_at: string | null; captured_at: string;
  delisted_at: string | null; delist_reason: DelistReason;
  asking_price_cents: number | null; last_price_cents: number | null;
}): Outcome {
  const clearing = row.last_price_cents ?? row.asking_price_cents;
  const drop =
    row.asking_price_cents !== null && row.last_price_cents !== null
      ? row.asking_price_cents - row.last_price_cents
      : null;
  const dom = days(row.posted_at ?? row.captured_at, row.delisted_at);

  const base = {
    listingId: row.id, title: row.title, daysOnMarket: dom,
    clearingPriceCents: clearing, priceDropCents: drop && drop > 0 ? drop : null,
  };

  if (!row.delisted_at) {
    return { ...base, signal: "no_signal", confidence: "high", reason: "still listed" };
  }

  // Repost check first — it overrides everything else.
  if (looksLikeRepost(row.id, row.title, clearing, row.delisted_at)) {
    return { ...base, signal: "repost", confidence: "medium",
      reason: "a near-identical listing appeared right after this one went — refresh, not a sale" };
  }

  if (row.delist_reason === "expired") {
    return { ...base, signal: "no_signal", confidence: "high",
      reason: "expired on its own — says nothing about a sale" };
  }
  if (row.delist_reason === "flagged") {
    return { ...base, signal: "no_signal", confidence: "high",
      reason: "removed by flagging — says nothing about a sale" };
  }

  if (row.delist_reason === "deleted_by_author") {
    // The seller took it down themselves. Early is a strong sale signal; near
    // the expiry boundary it blurs into housekeeping before an auto-expiry.
    if (dom !== null && dom <= 14) {
      return { ...base, signal: "likely_sold", confidence: "high",
        reason: `seller removed it after ${plural(dom)}${drop && drop > 0 ? ", following a price cut" : " at full asking price"}` };
    }
    if (dom !== null && dom < CL_EXPIRY_DAYS - 4) {
      return { ...base, signal: "likely_sold", confidence: "medium",
        reason: `seller removed it after ${plural(dom)}` };
    }
    return { ...base, signal: "possibly_sold", confidence: "low",
      reason: `removed near the ${CL_EXPIRY_DAYS}-day expiry, so this may be housekeeping rather than a sale` };
  }

  // 410 with no sentence we recognise.
  return { ...base, signal: "possibly_sold", confidence: "low",
    reason: "gone, with no stated reason" };
}

/**
 * A near-identical listing posted within a week AFTER this one disappeared.
 *
 * TWO TESTS, photos first. A seller who edits the title while reusing the
 * photos slips straight past title matching, and that is the common case —
 * people repost with "PRICE DROP" or "STILL AVAILABLE" bolted on. Perceptual
 * hashes do not care about the title, the price, or a recompression pass.
 *
 * Hamming distance <= 10 on a 64-bit dhash is the same near-duplicate threshold
 * `distance()` documents for cross-platform photo theft. The mechanism catches
 * both: a seller reposting their own item, and someone stealing the pictures.
 */
function looksLikeRepost(id: number, title: string, priceCents: number | null, delistedAt: string): boolean {
  const window = new Date(Date.parse(delistedAt) + 7 * 86_400_000).toISOString();

  const mine = (db()
    .query(`SELECT phash FROM listing_photos WHERE listing_id=$id AND phash IS NOT NULL`)
    .all({ $id: id }) as Array<{ phash: string }>).map((r) => r.phash);

  if (mine.length) {
    const others = db()
      .query(
        `SELECT p.phash, p.listing_id FROM listing_photos p
         JOIN listings l ON l.id = p.listing_id
         WHERE p.listing_id != $id AND p.phash IS NOT NULL
           AND l.captured_at >= $from AND l.captured_at <= $to`,
      )
      .all({ $id: id, $from: delistedAt, $to: window }) as Array<{ phash: string; listing_id: number }>;

    // Count how many of MY photos reappear, not how many pairs are close. One
    // stock photo of a retail box matching is coincidence; several matching is
    // the same listing.
    const matchedByListing = new Map<number, Set<string>>();
    for (const o of others) {
      for (const m of mine) {
        if (distance(m, o.phash) <= 10) {
          if (!matchedByListing.has(o.listing_id)) matchedByListing.set(o.listing_id, new Set());
          matchedByListing.get(o.listing_id)!.add(m);
        }
      }
    }
    for (const [, matched] of matchedByListing) {
      if (matched.size >= Math.min(2, mine.length)) return true;
    }
  }

  // Fallback for listings whose photos were never downloaded.
  if (!title) return false;
  const r = db()
    .query(
      `SELECT COUNT(*) n FROM listings
       WHERE id != $id
         AND title = $title
         AND ($p IS NULL OR asking_price_cents = $p)
         AND captured_at >= $from AND captured_at <= $to`,
    )
    .get({ $id: id, $title: title, $p: priceCents, $from: delistedAt, $to: window }) as { n: number };
  return r.n > 0;
}

/** Every listing we have an opinion about, newest disappearance first. */
export function outcomes(opts: { onlySold?: boolean } = {}): Outcome[] {
  const rows = db()
    .query(
      `SELECT id, title, posted_at, captured_at, delisted_at, delist_reason,
              asking_price_cents, last_price_cents
       FROM listings WHERE delisted_at IS NOT NULL
       ORDER BY delisted_at DESC`,
    )
    .all() as any[];
  const out = rows.map(inferOutcome);
  return opts.onlySold ? out.filter((o) => o.signal === "likely_sold") : out;
}
