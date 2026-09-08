/**
 * eBay as a SOURCE of listings to buy, not just a source of sold comps.
 *
 * Yish raised this on 2026-08-25: good deals exist on eBay if you are told the
 * moment they post. It was going to need another browser crawler; the
 * production keyset that went live on 2026-08-26 turns it into an API call.
 *
 * ── THIS IS THE BROWSE API, WHICH MEANS ASKING PRICES ──────────────────────
 *
 * Browse returns ACTIVE listings. It is not and cannot be a comps feed — sold
 * history lives behind Marketplace Insights, which returns 403 for us and is
 * closed to new applicants. Nothing here touches the comps archive.
 *
 * ── THE MARGIN MATH IS DIFFERENT AND THAT IS THE WHOLE TRAP ────────────────
 *
 * Craigslist arbitrage is buy local, sell on eBay: you pay a private seller
 * cash and eat fees once, on the way out. **eBay-to-eBay eats fees on BOTH
 * ends** — you pay the buyer's side going in and the seller's side coming out —
 * so the same spread that is a deal locally can be a loss here. Listings from
 * this source are marked `ebay` basis so the valuation layer prices them
 * against eBay economics rather than the local-market discount, the same
 * correction Yish made for Mercari.
 *
 * ── SEARCH IS AS DIRTY AS ANY SCRAPED TITLE ────────────────────────────────
 *
 * Measured on 2026-08-26: a filtered `q=rtx 4090` search returned 1,114
 * results including laptops CONTAINING a 4090, an external GPU dock, two
 * 4080s, and a $29.99 1:1 scale REPLICA. An API is not a guarantee of
 * relevance. Everything here goes through the same `matchSku` and counterfeit
 * signals as every other source, and `looksLikeJunk` kills the obvious
 * non-products before they cost a match attempt.
 */
import type { RawListing } from "../types.ts";

const HOST = "https://api.ebay.com";

export const ebayConfigured = () =>
  Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);

let token: { value: string; expires: number } | null = null;

/**
 * Client-credentials token, cached until shortly before it expires.
 *
 * eBay issues these for 7200s and rate-limits the token endpoint separately
 * from the API. Fetching one per search would burn that budget for no reason.
 * The 60s safety margin exists so a token cannot expire mid-request.
 */
export async function ebayToken(): Promise<string> {
  if (token && Date.now() < token.expires) return token.value;
  const id = process.env.EBAY_CLIENT_ID!.trim();
  const secret = process.env.EBAY_CLIENT_SECRET!.trim();
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");

  const r = await fetch(`${HOST}/identity/v1/oauth2/token`, {
    signal:AbortSignal.timeout(20_000),
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });
  const j = await r.json() as { access_token?: string; expires_in?: number; error_description?: string };
  if (!j.access_token) {
    /**
     * `invalid_client` here usually is NOT bad credentials. A production
     * keyset with no marketplace-deletion endpoint is DISABLED and reports
     * exactly this. Run `bun run ebay:auth` before touching the keys.
     */
    throw new Error(`eBay auth failed: ${j.error_description ?? "no token"} — try \`bun run ebay:auth\``);
  }
  token = { value: j.access_token, expires: Date.now() + (j.expires_in ?? 7200) * 1000 - 60_000 };
  return token.value;
}

/**
 * Things that match the words but are not the product.
 *
 * Deliberately narrow. A broad junk filter silently deletes real inventory,
 * and the SKU matcher is the real defence — this only removes the categories
 * that are provably never the thing: scale models, empty boxes, printed
 * material, and "compatible with" accessories.
 */
export function looksLikeJunk(title: string): boolean {
  const t = title.toLowerCase();
  return /\b(replica|1:1 scale|scale model|dummy|non[- ]?functional|for parts only display)\b/.test(t)
    || /\b(empty )?box only\b/.test(t)
    || /\b(poster|sticker|decal|keychain|manual|brochure)\b/.test(t)
    || /\b(compatible with|fits|for use with|replacement for)\b/.test(t)
    || /\b(cable|adapter|bracket|riser|stand|mount|cover|skin|sleeve)\b for /.test(t);
}

export interface EbaySearchOpts {
  query: string;
  maxPriceCents?: number;
  minPriceCents?: number;
  limit?: number;
  /** Used-only by default: new eBay inventory is retail, not arbitrage. */
  conditions?: string[];
}

interface Summary {
  itemId: string; title: string; itemWebUrl: string;
  price?: { value?: string; currency?: string };
  condition?: string;
  itemLocation?: { city?: string; stateOrProvince?: string };
  buyingOptions?: string[];
  image?: { imageUrl?: string };
  thumbnailImages?: Array<{ imageUrl?: string }>;
}

/**
 * Search active eBay listings and return them in this project's shape.
 *
 * FIXED_PRICE only. An auction's current bid is not a price you can buy at —
 * treating it as one makes every auction look like the deal of the century
 * three days before it closes at market.
 */
export async function searchEbay(opts: EbaySearchOpts): Promise<RawListing[]> {
  const t = await ebayToken();
  /**
   * `conditionIds`, NOT `conditions` — and this is a silent-failure trap.
   *
   * The `conditions` filter takes a fixed enum (USED_EXCELLENT,
   * USED_VERY_GOOD, …). Passing anything else — including the obvious-looking
   * "USED" — is IGNORED rather than rejected, so the request succeeds and
   * returns unfiltered results. A live search for "rtx 4090" with
   * `conditions:{USED|VERY_GOOD|GOOD|ACCEPTABLE}` came back with a $1,453 NEW
   * card and a $465 open-box one, which is retail inventory in an arbitrage
   * feed: exactly the listings that cannot be flipped.
   *
   *   3000 Used · 4000 Very Good · 5000 Good · 6000 Acceptable
   *
   * 1000 (New) and 1500 (Open box) are deliberately absent.
   */
  const filters = [
    `buyingOptions:{FIXED_PRICE}`,
    `conditionIds:{${(opts.conditions ?? ["3000", "4000", "5000", "6000"]).join("|")}}`,
  ];
  if (opts.maxPriceCents != null || opts.minPriceCents != null) {
    const lo = ((opts.minPriceCents ?? 0) / 100).toFixed(0);
    const hi = opts.maxPriceCents != null ? (opts.maxPriceCents / 100).toFixed(0) : "";
    filters.push(`price:[${lo}..${hi}]`, "priceCurrency:USD");
  }

  const url = `${HOST}/buy/browse/v1/item_summary/search`
    + `?q=${encodeURIComponent(opts.query)}`
    + `&limit=${Math.min(opts.limit ?? 50, 200)}`
    + `&filter=${encodeURIComponent(filters.join(","))}`
    + `&sort=newlyListed`;

  const r = await fetch(url, {
    signal:AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${t}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  });
  const d = await r.json() as { itemSummaries?: Summary[]; errors?: Array<{ message?: string }> };
  if (!r.ok) throw new Error(`eBay search failed (${r.status}): ${d.errors?.[0]?.message ?? "unknown"}`);

  const out: RawListing[] = [];
  for (const s of d.itemSummaries ?? []) {
    if (!s.itemId || !s.title) continue;
    if (looksLikeJunk(s.title)) continue;

    // A missing or unparseable price is NOT zero. Zero is how an unpriced
    // listing becomes free money — the trap this repo has already hit twice.
    const v = Number(s.price?.value);
    const priceCents = Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
    if (priceCents === null) continue;
    if (s.price?.currency && s.price.currency !== "USD") continue;

    const photo = s.image?.imageUrl ?? s.thumbnailImages?.[0]?.imageUrl;
    out.push({
      source: "ebay",
      sourceId: s.itemId,
      url: s.itemWebUrl,
      title: s.title,
      description: "",
      askingPriceCents: priceCents,
      location: [s.itemLocation?.city, s.itemLocation?.stateOrProvince].filter(Boolean).join(", ") || null,
      postedAt: null,
      updatedAt: null,
      photoUrls: photo ? [photo] : [],
      attributes: { condition: s.condition ?? "", basis: "ebay" },
      raw: s,
    });
  }
  return out;
}
