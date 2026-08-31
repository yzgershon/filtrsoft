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

/* ─────────────────────────────────────── OfferUp photos, all of them, full size
 *
 * Yish, 2026-08-31: *"OfferUp listings only show 1 photo in worse resolution
 * than the original, when the original listing has like 4 photos it will only
 * show me the hero photo."*
 *
 * He is describing the search CARD, which is all we ever read. The card carries
 * one signed 250x250 and the signature is per size, so `250x250` -> `1080x1080`
 * in the string returns 400 rather than a bigger image — that was measured, and
 * it is why the old comment here said full resolution "would mean opening each
 * detail page". It does. So we open it.
 *
 * The detail page hands over every slide at full size. Measured on a real
 * listing: 9 `<img>` tags carrying 4 DISTINCT photos, the largest 1442x1922,
 * each with its own valid signature.
 *
 * ── THE IDENTITY IS THE FILENAME, NOT THE URL ──────────────────────────────
 *
 *     https://images.offerup.com/<sig>/1080x1080/888b/888bff85…798.jpg
 *                                 ^^^^^ ^^^^^^^^^      ^^^^^^^^^^^^^^
 *                                 per-size signature   the photo itself
 *
 * The same photo appears three or four times per page at different sizes, all
 * with different signatures. Dedupe on the URL and you get 9 "photos" that are
 * really 4; dedupe on the filename and you get the 4, and can then keep the
 * biggest signed url for each.
 */
const OU_ID = /\/([0-9a-f]{16,})\.(jpg|jpeg|png|webp)(\?|$)/i;
const OU_SIZE = /\/(\d{2,5})x(\d{2,5})\//;

/** The photo's own identity, independent of size and signature. */
export const photoIdentity = (url: string): string | null => url.match(OU_ID)?.[1] ?? null;

/** Pixels, from the size segment. 0 when the url does not carry one. */
export function photoArea(url: string): number {
  const m = url.match(OU_SIZE);
  return m ? Number(m[1]) * Number(m[2]) : 0;
}

/**
 * ⚠ THE MINIMUM IS A CONTAMINATION GUARD, NOT A QUALITY PREFERENCE.
 *
 * An OfferUp detail page also renders "similar items" and seller cards, and
 * those are `<img>` tags on `images.offerup.com` exactly like the gallery. If
 * they got through, a listing would show ANOTHER listing's photos — and vision
 * would then read specs off the wrong machine, which is a wrong verdict with
 * confident evidence behind it. The worst possible failure here.
 *
 * The separation is clean and measured: gallery slides are served at 1080 or
 * larger on the long edge, every card thumbnail at 250. 640 sits between them
 * with room on both sides.
 */
export const OU_MIN_EDGE = 640;

/**
 * The best url for each distinct photo, in the order they first appear.
 *
 * Order is first-appearance because the gallery renders in gallery order, and
 * photo 1 is the hero on the card and in the feed. Sorting by size would put a
 * portrait shot of the serial number first.
 */
export function bestPhotos(urls: string[], max = 20): string[] {
  const best = new Map<string, { url: string; area: number }>();
  const order: string[] = [];

  for (const url of urls) {
    const id = photoIdentity(url);
    if (!id) continue;
    const m = url.match(OU_SIZE);
    if (!m) continue;
    if (Math.max(Number(m[1]), Number(m[2])) < OU_MIN_EDGE) continue;

    const area = photoArea(url);
    const prev = best.get(id);
    if (!prev) { best.set(id, { url, area }); order.push(id); }
    else if (area > prev.area) best.set(id, { url, area });
  }

  return order.slice(0, max).map((id) => best.get(id)!.url);
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
     * ⚠ THIS IS ONE 250x250 THUMBNAIL AND IT IS A PLACEHOLDER, NOT THE ANSWER.
     * OfferUp signs the url per size, so rewriting the dimensions returns 400.
     * `bun run ou:photos` visits the detail page and replaces this with every
     * slide at full resolution — see `bestPhotos` above. Until it runs, the
     * card has something to show and ZERO_PHOTOS does not lie.
     */
    photoUrls: c.photoUrl ? [c.photoUrl] : [],
    attributes: c.shipped ? { shipping: "yes" } : {},
    raw: c,
  } as RawListing;
}

export type MarketEvent =
  | { type: "log"; msg: string }
  | { type: "cards"; source: Marketplace; query: string; lines: string[]; links: Array<{ href: string; text: string; photo?: string }> }
  | { type: "photos"; id: number; url: string; finalUrl: string; title: string; urls: string[]; error?: string }
  | { type: "probe"; id: number; url: string; finalUrl: string; text: string; title?: string; error?: string }
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

/**
 * Is this listing gone?
 *
 * **The worker sends page text; this decides.** Same split as every other
 * parser here, so a wording change on either site is a one-line fix with a
 * fixture rather than a browser session.
 *
 * ⚠ THE DEFAULT IS "STILL UP", AND THAT DIRECTION IS DELIBERATE. A false
 * "gone" deletes a real deal from the feed permanently and silently; a false
 * "still up" costs one wasted tap. Anything ambiguous — a timeout, a login
 * wall, an empty body, a bot challenge — returns `null` for "no opinion", and
 * the caller leaves the row alone.
 */
export type ProbeVerdict = { gone: boolean; reason: string } | null;

const GONE_TEXT = [
  // Facebook
  /this (listing|item|content) isn'?t available/i,
  /listing (is )?(no longer|not) available/i,
  /this page isn'?t available/i,
  /content not found/i,
  // OfferUp
  /item (is )?(no longer available|not found|has been removed)/i,
  /we can'?t find (that|this) item/i,
  /this item is unavailable/i,
  // Mercari
  /(item|page) (was|has been) (deleted|removed)/i,
  /sold out/i,
  /404/,
];

/**
 * A page that proves nothing: we are logged out, blocked, or it never loaded.
 *
 * ⚠ THESE MUST NOT MATCH THE SITE'S OWN NAVIGATION. The first version tested
 * `/log in|sign up/` against the whole page, and EVERY OfferUp listing has
 * "Log in" and "Sign up" in its header — so six live listings came back "no
 * opinion" and the probe could never conclude anything. The pages were fine.
 *
 * A real login wall says so at the TOP and usually in the url. Both are checked
 * against the first 200 characters or the final url, never the whole body.
 */
const NO_OPINION_HEAD = /^[\s\S]{0,200}?\b(log in to (continue|see)|sign up to (continue|see)|you must log in|please log in|confirm you'?re (a )?human|security check|unusual activity|access denied)\b/i;
const NO_OPINION_URL = /\/(login|signin|sign-in|checkpoint|challenge)\b/i;

export function probeVerdict(p: { text: string; finalUrl: string; error?: string }): ProbeVerdict {
  if (p.error) return null;
  const text = (p.text ?? "").trim();
  // An empty body is a page that did not render, not a deleted listing.
  if (text.length < 40) return null;
  if (NO_OPINION_URL.test(p.finalUrl)) return null;
  if (NO_OPINION_HEAD.test(text)) return null;

  for (const r of GONE_TEXT) {
    const m = text.match(r);
    if (m) return { gone: true, reason: m[0].slice(0, 60).toLowerCase() };
  }
  /**
   * A redirect to the site's home or search page is how OfferUp answers a dead
   * item — it does not 404, it bounces you. Checked AFTER the text patterns so
   * a page that says why keeps its own words.
   */
  if (/^https?:\/\/[^/]+\/?$/.test(p.finalUrl) || /\/(search|home)\/?(\?|$)/.test(p.finalUrl)) {
    return { gone: true, reason: "redirected away from the listing" };
  }

  /**
   * ⚠ "STILL UP" NEEDS POSITIVE EVIDENCE. Returning it as the fallback is what
   * made this dangerous.
   *
   * Facebook's marketplace item page is a SPA: probing a listing Yish had
   * confirmed SOLD returned only chrome — "Number of unread notifications 20+
   * Marketplace Edit Marketplace Settings Browse all… Categories Vehicles
   * Property Rentals" — with no title, no price and no removal notice. The
   * classifier read "nothing says it is gone" and reported it live, which is
   * the exact wrong answer to give confidently.
   *
   * A live listing page shows a PRICE, or says "for Sale in". If neither is
   * there we did not see the listing, and the honest answer is that we do not
   * know — the caller then leaves the row alone rather than acting on a page it
   * never actually read.
   */
  const looksLikeAListing = /\$\s?\d/.test(text) || /\bfor sale in\b/i.test(text);
  if (!looksLikeAListing) return null;

  return { gone: false, reason: "still up" };
}
