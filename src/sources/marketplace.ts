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
  process.env.FILTRSOFT_CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

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

/* ───────────────────────────── OfferUp detail text: the description and specs
 *
 * ⚠ **OFFERUP AND MERCARI HAD 0% DESCRIPTION COVERAGE — 161 LIVE LISTINGS WITH
 * NOTHING BUT A TITLE.** Measured 2026-08-31 against 1% for Craigslist and 0%
 * for Facebook. `cardToListing` sets `description: ""` because a SEARCH CARD
 * has no description, and nothing ever opened the item page for text.
 *
 * That is a third of everything the engine cannot price. "Can't be valued: gpu
 * and cpu not stated" is true of a title, and false of the listing — the specs
 * were sitting on a page we were already visiting for photos.
 *
 * The page reads:
 *
 *     Description
 *     <the seller's text>
 *     Details
 *     Condition      Used (normal wear)
 *     RAM Size       1-19 GB
 *     Model          macbook air
 *     ...
 *
 * so BOTH halves are worth taking. The Details block is structured spec data of
 * exactly the kind `missingValueFields` complains about.
 */
const OU_DETAIL_END = /^(Skip Advertisement|Item location map|Related searches|Similar items|Additional details)$/i;

export interface OfferUpDetail {
  description: string;
  /** The Details table, lowercased keys, verbatim values. */
  details: Record<string, string>;
}

/**
 * Pull the description and the Details table out of an OfferUp item page.
 *
 * ⚠ PURE, AND PARSED FROM `innerText` RATHER THAN THE DOM. OfferUp's class
 * names are hashed and change without notice; the visible text does not. Same
 * split as every other parser here — the worker stays dumb, a layout change is
 * a fixture fix rather than another browser session.
 */
export function parseOfferUpDetail(text: string): OfferUpDetail {
  const lines = (text ?? "").split(/\r?\n/).map((l) => l.trim());
  const out: OfferUpDetail = { description: "", details: {} };

  const dStart = lines.findIndex((l) => /^description$/i.test(l));
  if (dStart >= 0) {
    const body: string[] = [];
    for (let i = dStart + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^details$/i.test(l) || OU_DETAIL_END.test(l)) break;
      if (l) body.push(l);
    }
    out.description = body.join(" ").trim();
  }

  /**
   * The table is rendered as alternating label / value lines with blanks
   * between, so pairs are taken from the NON-EMPTY lines. A label with no value
   * after it is dropped rather than paired with the next label.
   */
  const tStart = lines.findIndex((l) => /^details$/i.test(l));
  if (tStart >= 0) {
    const rows = lines.slice(tStart + 1).filter(Boolean);
    for (let i = 0; i + 1 < rows.length; i += 2) {
      if (OU_DETAIL_END.test(rows[i])) break;
      const k = rows[i].toLowerCase();
      const v = rows[i + 1];
      // A "key" longer than a label is prose that ran into the table.
      if (k.length > 32 || OU_DETAIL_END.test(v)) break;
      out.details[k] = v;
    }
  }
  return out;
}

/**
 * The description we should STORE for an OfferUp listing.
 *
 * The Details table is appended in plain "Key: value" form because that is what
 * `extractAttributes` and the signal layer already read — they parse free text,
 * so structured data has to be flattened into text to reach them at all.
 */
export function offerUpDescription(d: OfferUpDetail): string {
  const specs = Object.entries(d.details)
    .filter(([k]) => !/^(condition)$/.test(k))
    .map(([k, v]) => `${k}: ${v}`);
  return [d.description, ...specs].filter(Boolean).join("\n").trim();
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
  | { type: "photos"; id: number; url: string; finalUrl: string; title: string; urls: string[]; text?: string; error?: string }
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

// ───────────────────────────────────────────────── Mercari's detail page
//
// Yish, 2026-09-04: *"build the thing we need to analyze the descriptions for
// mercari."*
//
// The reason it matters is measured, not assumed. A Mercari SEARCH CARD carries
// a title and a price and nothing else, so the 99 listings the first working
// crawl brought in scored **90 INSUFFICIENT_DATA** — the engine asking for a
// storage size or a GPU that the card could never have told it. OfferUp had the
// identical problem and `ou:photos` fixed it there; this is the same fix, for
// the same reason, on a differently-shaped page.
//
// The block looks like this, and the shape is what the parser is written
// against rather than guessed at:
//
//     Details
//     Condition
//     Good
//     Category
//     Electronics
//     Video games & consoles      <- Category is MULTI-LINE. Nothing else is.
//     Games
//     Posted
//     09/03/26
//     Description
//     The Call of Duty: Modern Warfare 3 ...
//     Delivery

/** Labels Mercari uses in its Details block. A line equal to one starts a field. */
const MC_LABELS = new Set([
  "condition", "category", "brand", "size", "color", "colour", "posted",
  "model", "material", "style", "item id",
]);

/** Where the description stops. `Delivery` is the reliable one; the rest are fallbacks. */
const MC_DESC_END =
  /^(delivery|shipping|payment|from|similar items|have a similar item\?|buyer protection|seller|about this seller|reviews?)$/i;

export interface MercariDetail {
  description: string;
  details: Record<string, string>;
}

/**
 * Pull the description and the Details block out of a Mercari item page.
 *
 * ⚠ PURE, AND PARSED FROM `innerText`, for the same reason `parseOfferUpDetail`
 * is: Mercari's class names are hashed build output and the visible text is
 * not. A layout change becomes a fixture edit rather than another browser
 * session.
 *
 * ⚠ AND IT READS THE PAGE BACKWARDS FROM `Description`, NOT FORWARDS FROM THE
 * TOP. The item's own text sits about 300 lines down, underneath checkout
 * copy, a protection-plan advert and a "Similar items" carousel that repeats
 * dozens of OTHER listings' titles and prices. Scanning from the top and
 * stopping at the first plausible paragraph gets a competitor's listing.
 */
export function parseMercariDetail(text: string): MercariDetail {
  const lines = (text ?? "").split(/\r?\n/).map((l) => l.trim());
  const out: MercariDetail = { description: "", details: {} };

  /**
   * The LAST `Description` heading, not the first. The similar-items carousel
   * can carry one of its own, and the item's block is always below it.
   */
  let dStart = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^description$/i.test(lines[i])) { dStart = i; break; }
  }
  if (dStart >= 0) {
    const body: string[] = [];
    for (let i = dStart + 1; i < lines.length; i++) {
      const l = lines[i];
      if (MC_DESC_END.test(l)) break;
      if (l) body.push(l);
    }
    out.description = body.join(" ").trim();
  }

  const tStart = lines.findIndex((l) => /^details$/i.test(l));
  if (tStart >= 0) {
    let key: string | null = null;
    const buf: string[] = [];
    const flush = () => {
      if (key && buf.length) out.details[key] = buf.join(", ");
      buf.length = 0;
    };
    for (let i = tStart + 1; i < lines.length; i++) {
      const l = lines[i];
      if (!l) continue;
      if (/^description$/i.test(l) || MC_DESC_END.test(l)) { flush(); break; }
      if (MC_LABELS.has(l.toLowerCase())) { flush(); key = l.toLowerCase(); continue; }
      /**
       * A value line. Multi-line values are joined rather than overwritten —
       * Category arrives as three lines and keeping only the last one throws
       * away the two that say what the thing actually is.
       */
      if (key) buf.push(l);
    }
    flush();
  }
  return out;
}

/**
 * The description we should STORE for a Mercari listing.
 *
 * Flattened to `Key: value` text for exactly the reason the OfferUp version is:
 * `extractAttributes` and the signal layer parse free text, so structured data
 * has to become text to reach them at all.
 */
export function mercariDescription(d: MercariDetail): string {
  const specs = Object.entries(d.details)
    .filter(([k]) => k !== "posted" && k !== "condition")
    .map(([k, v]) => `${k}: ${v}`);
  return [d.description, ...specs].filter(Boolean).join("\n").trim();
}
