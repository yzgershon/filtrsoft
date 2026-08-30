/**
 * OfferUp and Mercari — parsing and basis.
 *
 * **THE BASIS RULE IS THE POINT OF THIS FILE**, and it comes from Yish's
 * correction on 2026-08-25: these are USED markets like eBay, not local-pickup
 * markets like Craigslist.
 *
 *   · **Mercari** — national, shipped, ~10% seller fee. Prices are eBay-BASIS.
 *     Running them through the local-market discount would take ~15% off a
 *     number that already has eBay economics baked in, which is the exact
 *     double-discount that read the NZXT build at $890 against a real $1,375.
 *   · **OfferUp** — mostly local pickup, but it has shipped listings. Basis is
 *     decided PER LISTING from what the card says, not per source.
 *
 * Parsing lives here, in Bun, so a layout change is a pure-function fix with a
 * fixture rather than another browser session.
 */
import { join } from "node:path";
import type { RawListing } from "../types.ts";

const WORKER = join(import.meta.dir, "../browser/marketplace-worker.mjs");

export const CHROME_PATH =
  process.env.ASSYZE_CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

export const MARKETPLACES = ["offerup", "mercari"] as const;
export type Marketplace = (typeof MARKETPLACES)[number];

/** eBay-basis sources price like eBay: national reach, platform fees. */
export const BASIS: Record<Marketplace, "ebay" | "local"> = {
  mercari: "ebay",
  offerup: "local",
};

export interface MarketCard {
  source: Marketplace;
  sourceId: string;
  url: string;
  title: string;
  priceCents: number | null;
  location: string | null;
  /** Mercari is always shipped; OfferUp says so per listing. */
  shipped: boolean;
  /** The card thumbnail. Empty when the site lazy-loaded a placeholder. */
  photoUrl?: string;
}

const PRICE = /\$\s?([\d,]+(?:\.\d{2})?)/;

const BASE: Record<Marketplace, string> = {
  offerup: "https://offerup.com",
  mercari: "https://www.mercari.com",
};

/**
 * Parse the anchor list rather than the text lines.
 *
 * Both sites render a card as one `<a>` wrapping the title, the price and
 * sometimes the location, so the anchor already groups the fields that belong
 * together. Reading `innerText` and re-associating by position is what made the
 * Best Buy parser fragile, and there is no reason to repeat it where the DOM
 * hands us the grouping for free.
 *
 * The item id comes from the href and nothing else. Without it there is no
 * stable `source_id`, and every re-crawl would insert duplicates rather than
 * update prices — which is how a price-drop signal gets lost.
 */
export function parseCards(
  source: Marketplace,
  links: Array<{ href: string; text: string; photo?: string }>,
): MarketCard[] {
  const out: MarketCard[] = [];
  const seen = new Set<string>();

  for (const l of links) {
    /**
     * The id is the LAST path segment, not the first one after `/item/`.
     *
     * OfferUp's URLs are `/item/detail/<uuid>`, so a pattern of
     * `/(item|p)/([A-Za-z0-9_-]+)` captured the literal string "detail" for
     * every single card — they all shared one id, the dedupe set swallowed 54
     * of 55, and the crawler reported "70 links -> 1 card" as though the page
     * were empty. Mercari uses `/item/m<digits>`.
     */
    const id = l.href.match(/\/(?:item|p)\/(?:detail\/)?([A-Za-z0-9_-]{6,})/)?.[1];
    if (!id || id === "detail" || seen.has(id)) continue;

    /**
     * Cards are PIPE-separated, not newline-separated:
     * `White Custom Gaming PC Build | $1,400 | Salem, MA`. Splitting on
     * newlines alone left the whole card as one line, so the price was never
     * isolated and the "longest line" title rule returned the entire string.
     */
    const lines = l.text.split(/\n|\s\|\s/).map((s) => s.trim()).filter(Boolean);
    const priceLine = lines.find((s) => PRICE.test(s));
    const priceCents = priceLine
      ? Math.round(Number(priceLine.match(PRICE)![1].replace(/,/g, "")) * 100)
      : null;

    /**
     * The title is the longest line that is NOT the price and not a badge.
     * Both sites put the price on its own line and decorate cards with short
     * labels ("Shipping", "Free", "Local pickup", condition chips), none of
     * which are ever as long as a real product name.
     */
    const title = lines
      .filter((s) => s !== priceLine && s.length > 8 && !PRICE.test(s) &&
        !/^(shipping|free|local pickup|new|used|like new|good|fair|sponsored|save)$/i.test(s))
      .sort((a, b) => b.length - a.length)[0];
    if (!title) continue;

    seen.add(id);
    out.push({
      source, sourceId: id,
      url: l.href.startsWith("http") ? l.href : `${BASE[source]}${l.href}`,
      title, priceCents,
      location: lines.find((s) => /,\s?[A-Z]{2}$/.test(s)) ?? null,
      // Mercari is shipped by definition; OfferUp states it on the card.
      shipped: source === "mercari" || /\bshipping\b/i.test(l.text),
      photoUrl: l.photo || undefined,
    });
  }
  return out;
}

export function cardToListing(c: MarketCard): RawListing {
  return {
    source: c.source,
    sourceId: c.sourceId,
    url: c.url,
    title: c.title,
    description: "",
    askingPriceCents: c.priceCents,
    location: c.location,
    postedAt: null,
    updatedAt: null,
    /**
     * ⚠ THIS WAS HARDCODED `[]` and it made the engine lie.
     *
     * Every OfferUp and Mercari listing arrived with no photos, so ZERO_PHOTOS
     * fired on all 97 of them — a flag whose own text says it is "close to
     * dispositive on its own" — while the actual listing had pictures. Yish
     * found it on "RTX 3060 12GB Graphics Card - Tested and Working".
     *
     * The worker collects the card thumbnail now. A card with a genuinely
     * missing image still yields none, which is the honest empty case.
     *
     * ⚠ THESE ARE 250x250 THUMBNAILS AND CANNOT BE UPGRADED. OfferUp signs the
     * URL per size — `eXrG1Dbi9mDtyjGLyzFEVdj6V1U=/250x250/...` — so rewriting
     * the dimensions returns 400, not a bigger image. Measured: 250x250 -> 200
     * at 12 KB, 640/1024/1600 -> 400.
     *
     * Enough to show a card and to stop ZERO_PHOTOS lying. NOT enough for
     * vision to read a spec label off a screen. Full-resolution photos would
     * mean opening each detail page, which is a browser visit per listing —
     * worth it only if these listings start converting.
     */
    photoUrls: c.photoUrl ? [c.photoUrl] : [],
    attributes: c.shipped ? { shipping: "yes" } : {},
    raw: c,
  } as RawListing;
}

export type MarketEvent =
  | { type: "log"; msg: string }
  | { type: "cards"; source: Marketplace; query: string; lines: string[]; links: Array<{ href: string; text: string; photo?: string }> }
  | { type: "error"; msg: string }
  | { type: "done"; stats: Record<string, unknown> };

export async function* runMarketWorker(
  source: Marketplace,
  opts: Record<string, unknown>,
): AsyncGenerator<MarketEvent> {
  const proc = Bun.spawn(
    ["node", WORKER, source, JSON.stringify({ chromePath: CHROME_PATH, ...opts })],
    { stdout: "pipe", stderr: "pipe", stdin: "inherit" },
  );
  const reader = proc.stdout.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) {
      if (!line.trim()) continue;
      try { yield JSON.parse(line) as MarketEvent; }
      catch { yield { type: "log", msg: `unparseable: ${line.slice(0, 120)}` }; }
    }
  }
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    yield { type: "error", msg: `worker exited ${code}${err ? `: ${err.slice(0, 200)}` : ""}` };
  }
}
