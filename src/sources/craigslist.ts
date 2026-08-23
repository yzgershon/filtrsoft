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

/** Search-result URLs for a Boston-area category. */
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
