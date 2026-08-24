import type { RawListing } from "../types.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const strip = (s: string) =>
  s.replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ").trim();

export async function fetchListing(url: string): Promise<RawListing> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`craigslist ${res.status} for ${url}`);
  const html = await res.text();

  const title =
    strip(html.match(/<span id="titletextonly">([\s\S]*?)<\/span>/)?.[1] ?? "") ||
    strip(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "").split(" - ")[0];

  const priceStr = html.match(/<span class="price">\$([\d,]+)<\/span>/)?.[1]
    ?? html.match(/\$([\d,]+)/)?.[1];
  const askingPriceCents = priceStr ? Number(priceStr.replace(/,/g, "")) * 100 : null;

  const description = strip(
    html.match(/<section id="postingbody">([\s\S]*?)<\/section>/)?.[1]
      ?.replace(/<div class="print-information[\s\S]*?<\/div>/g, "") ?? "",
  ).replace(/^QR Code Link to This Post\s*/i, "");

  // Craigslist emits two <time> elements: posted, then updated.
  const times = [...html.matchAll(/datetime="([^"]+)"/g)].map((m) => m[1]);

  // Dedupe by image hash, request the largest size Craigslist serves.
  const ids = [
    ...new Set(
      [...html.matchAll(/images\.craigslist\.org\/([\w]+)_\d+x\d+\.jpg/g)].map((m) => m[1]),
    ),
  ];
  const photoUrls = ids.map((id) => `https://images.craigslist.org/${id}_1200x900.jpg`);

  const attributes: Record<string, string> = {};
  for (const m of html.matchAll(
    /<div class="attr[^"]*">\s*<span class="labl">([^<]*?):?\s*<\/span>\s*<span class="valu">([\s\S]*?)<\/span>/g,
  )) {
    attributes[strip(m[1]).toLowerCase()] = strip(m[2]);
  }

  // Craigslist no longer renders the location on the detail page. Two sources:
  //   1. the URL slug — always present, gives the CL-assigned area
  //   2. the seller-typed string — only visible on SEARCH pages
  // The geographic-contradiction check (RISK-MODEL 3l) needs #2, so it only
  // fires on listings ingested via search. Detail-only ingestion gets #1.
  const slug = url.match(/\/view\/d\/([a-z]+)-/)?.[1] ?? null;
  const location = slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : null;

  return {
    source: "craigslist",
    sourceId: url.split("/").pop() ?? url,
    url,
    title,
    description,
    askingPriceCents,
    location,
    postedAt: times[0] ?? null,
    updatedAt: times[1] ?? times[0] ?? null,
    photoUrls,
    attributes,
    raw: { htmlBytes: html.length, times, attributes },
  };
}

/**
 * Search-result URLs for a Boston-area category.
 *
 * ⚠ THE `offset` PARAMETER DOES NOTHING. Measured 2026-08-24: this endpoint
 * serves a STATIC results page and `&s=120` returns the byte-identical 332
 * listings as `&s=0` — same first item, zero new ids. Anything looping pages
 * here multiplies requests for no extra coverage. Kept in the signature only
 * because the JS search UI does paginate; if that is ever wired up, this is
 * where it goes.
 */
export async function fetchSearchUrls(cat: string, offset = 0): Promise<string[]> {
  const url = `https://www.craigslist.org/search/area/boston?cat=${cat}${offset ? `&s=${offset}` : ""}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`craigslist search ${res.status}`);
  const html = await res.text();
  return [
    ...new Set(
      [...html.matchAll(/https:\/\/www\.craigslist\.org\/view\/d\/[\w-]+\/[\w]+/g)].map((m) => m[0]),
    ),
  ];
}

export interface SearchResult {
  url: string;
  sourceId: string;
  title: string;
  askingPriceCents: number | null;
  location: string | null;
}

/**
 * Search results WITH price, not just URLs.
 *
 * This is what makes price history affordable. One search fetch returns ~120
 * listings with their current asking price, so tracking every live listing costs
 * a handful of requests per sweep instead of one request per listing. Re-fetching
 * 341 listing pages to notice that two of them dropped $50 would be absurd.
 */
/** See fetchSearchUrls: `offset` is accepted and IGNORED by this endpoint. */
export async function fetchSearchResults(cat: string, offset = 0): Promise<SearchResult[]> {
  const url = `https://www.craigslist.org/search/area/boston?cat=${cat}${offset ? `&s=${offset}` : ""}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`craigslist search ${res.status}`);
  const html = await res.text();

  const out: SearchResult[] = [];
  for (const m of html.matchAll(
    /<li class="cl-static-search-result"[^>]*>([\s\S]*?)<\/li>/g,
  )) {
    const block = m[1];
    const href = block.match(/href="(https:\/\/www\.craigslist\.org\/view\/d\/[^"]+)"/)?.[1];
    if (!href) continue;
    const price = block.match(/<div class="price">\$([\d,]+)<\/div>/)?.[1];
    out.push({
      url: href,
      sourceId: href.split("/").pop() ?? href,
      title: strip(block.match(/<div class="title">([\s\S]*?)<\/div>/)?.[1] ?? ""),
      askingPriceCents: price ? Number(price.replace(/,/g, "")) * 100 : null,
      location: strip(block.match(/<div class="location">([\s\S]*?)<\/div>/)?.[1] ?? "") || null,
    });
  }
  return out;
}

/** Why a listing is no longer up. Craigslist distinguishes these and it matters. */
export type DelistReason = "deleted_by_author" | "expired" | "flagged" | "gone" | null;

/**
 * Is this listing still up, and if not, why not?
 *
 * Measured 2026-08-24 against live postings: a dead one returns **HTTP 410
 * Gone** — not 404 — with an explicit sentence in the body. The distinction is
 * the whole reason this is worth doing:
 *
 *   "deleted by its author"  the seller took it down. Sold, or gave up.
 *   "expired"                Craigslist aged it out. Says nothing about a sale.
 *   "flagged"                removed by users. Says nothing about a sale.
 *
 * Without that split, a vanished listing is ambiguous and the whole clearing
 * price signal is mush. With it, author-deletions are a usable population.
 */
export async function probeListing(url: string): Promise<{ alive: boolean; status: number; reason: DelistReason }> {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" } });
  const html = await res.text();

  if (/this posting has been deleted by its author/i.test(html)) {
    return { alive: false, status: res.status, reason: "deleted_by_author" };
  }
  if (/this posting has expired/i.test(html)) {
    return { alive: false, status: res.status, reason: "expired" };
  }
  if (/this posting has been flagged/i.test(html)) {
    return { alive: false, status: res.status, reason: "flagged" };
  }
  // 410 Gone with no sentence we recognise. Still dead, just unexplained.
  if (res.status === 410 || res.status === 404) {
    return { alive: false, status: res.status, reason: "gone" };
  }
  if (!res.ok) throw new Error(`craigslist ${res.status} for ${url}`);
  return { alive: true, status: res.status, reason: null };
}
