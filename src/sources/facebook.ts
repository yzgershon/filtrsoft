/**
 * Facebook Marketplace source.
 *
 * WHY THIS MATTERS MORE THAN CRAIGSLIST: Yish's words — "facebook marketplace is
 * where the real money is at". It is also where the fee-free economics live
 * (`FACEBOOK_GROSS_RATIO`, still a guess), and the 69-listing eval set is 100%
 * Craigslist, so it cannot detect Facebook-specific failure modes at all.
 *
 * SPLIT ACROSS TWO RUNTIMES, and this is not a style choice. Playwright HANGS
 * under Bun on this machine (measured 2026-08-24: `chromium.launch()` never
 * resolves; identical code under Node 24 launches in ~3s). Bun cannot be dropped
 * because `bun:sqlite` is the database. So:
 *
 *   src/browser/fb-worker.mjs   NODE. Drives Chrome. Emits RAW text as NDJSON.
 *   this file                   BUN.  Spawns it, and does ALL the parsing.
 *
 * Every parser here is PURE and takes raw strings, so the tricky part — turning
 * Facebook's card soup into a listing — is testable without launching a browser.
 *
 * CREDENTIALS: there is no login code in this project. Yish signs in himself in
 * a real Chrome window and the session lives in a profile on his disk. Filtrsoft
 * never sees a password or a token. Do not add a login helper, ever.
 */
import { join } from "node:path";
import { homedir } from "node:os";
import type { RawListing } from "../types.ts";

export const PROFILE_DIR =
  process.env.FILTRSOFT_BROWSER_PROFILE ?? join(homedir(), ".filtrsoft", "browser-profile");

/**
 * Forward slashes on purpose. A backslashed Windows path in a JS string literal
 * is an escape-sequence minefield — `"C:\Program Files\..."` silently becomes
 * `C:Program FilesGoogleChromeApplicationchrome.exe`, which cost a debugging
 * round here. Node and Chrome both accept forward slashes on Windows.
 */
export const CHROME_PATH =
  process.env.FILTRSOFT_CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const WORKER = join(import.meta.dir, "../browser/fb-worker.mjs");
const BASE = "https://www.facebook.com";

// ------------------------------------------------------------------ parsing

/** Cents from Facebook price text. "Free" is 0, not null — it IS a price. */
export function parsePrice(text: string | null | undefined): number | null {
  if (!text) return null;
  if (/^\s*free\s*$/i.test(text)) return 0;
  const m = text.replace(/,/g, "").match(/\$\s?(\d+(?:\.\d{2})?)/);
  return m ? Math.round(Number(m[1]) * 100) : null;
}

/**
 * Facebook shows "listed 3 days ago", never a date. Days on market drives both
 * the freshness ranking and the delisting inference, so it has to become a real
 * timestamp or Facebook listings rank as though they were posted today, forever.
 */
export function parseListedAgeDays(line: string | null | undefined): number | null {
  if (!line) return null;
  const t = line.toLowerCase();
  if (/just now|minutes? ago|hours? ago|\ban? (minute|hour)\b/.test(t)) return 0;
  const UNIT: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };
  const n = t.match(/(\d+)\s*(day|week|month|year)/);
  if (n) return Number(n[1]) * UNIT[n[2]];
  const a = t.match(/\ban?\s+(day|week|month|year)\b/);
  return a ? UNIT[a[1]] : null;
}

export interface FbCard {
  sourceId: string;
  url: string;
  title: string;
  askingPriceCents: number | null;
  location: string | null;
  thumb: string | null;
}

/**
 * A card's innerText arrives as stacked lines, roughly: price, title, location.
 * "Roughly" is why this reads by SHAPE rather than by index — Facebook inserts
 * badges ("Just listed", "Free shipping") that shift every position.
 */
export function parseCard(raw: { href: string; text: string; img: string | null }): FbCard | null {
  const id = raw.href.match(/\/marketplace\/item\/(\d+)/)?.[1];
  if (!id) return null;

  const lines = raw.text.split("\n").map((l) => l.trim()).filter(Boolean);
  const priceLine = lines.find((l) => /^\$[\d,]/.test(l) || /^free$/i.test(l)) ?? null;
  const locLine = [...lines].reverse().find((l) => /,\s?[A-Z]{2}$/.test(l)) ?? null;
  const title = lines.find(
    (l) => l !== priceLine && l !== locLine && l.length > 3 && !/^(just listed|free shipping|sponsored)$/i.test(l),
  ) ?? "";

  return {
    sourceId: id,
    url: `${BASE}/marketplace/item/${id}/`,
    title,
    askingPriceCents: parsePrice(priceLine),
    location: locLine,
    thumb: raw.img,
  };
}

/**
 * Detail page to `RawListing` — the shape the engine already understands.
 *
 * Returning RawListing is what lets Facebook flow through the exact same
 * signals, matcher, vision and verdict path as Craigslist with no branching
 * downstream. Nothing after this point should ever learn which site a listing
 * came from; the moment something branches on `source`, the eval set stops
 * meaning anything.
 */
export function detailToListing(
  d: { url: string; title: string; bodyLines: string[]; photos: string[]; condition?: string | null },
  card?: FbCard,
): RawListing {
  const priceLine = d.bodyLines.find((l) => /^\$[\d,]/.test(l) || /^free$/i.test(l));
  const listedLine = d.bodyLines.find((l) => /listed\s/i.test(l));
  const ageDays = parseListedAgeDays(listedLine);

  /**
   * The location line reads "Listed a day ago in Roxbury Crossing, MA" — the
   * whole sentence was being stored as the location. Strip the prefix, and
   * prefer a bare "City, ST" line if the page has one.
   */
  const cityLine = (l: string) => /^[A-Z][\w .'-]+,\s?[A-Z]{2}$/.test(l) && !/^listed\b/i.test(l);
  const locLine =
    d.bodyLines.find(cityLine)
    ?? stripListedPrefix(d.bodyLines.find((l) => /,\s?[A-Z]{2}$/.test(l)));

  return {
    source: "facebook",
    sourceId: d.url.match(/\/marketplace\/item\/(\d+)/)?.[1] ?? d.url,
    url: d.url,
    title: d.title || card?.title || "",
    /**
     * The whole visible body, not a dedicated description node. Coarser than
     * Craigslist's `#postingbody`, but the signal layer is regex over free text
     * anyway: an extra line of page chrome costs nothing, and a missing spec
     * line costs a verdict.
     */
    description: d.bodyLines.join("\n"),
    askingPriceCents: parsePrice(priceLine) ?? card?.askingPriceCents ?? null,
    location: locLine ?? card?.location ?? null,
    postedAt: ageDays == null ? null : new Date(Date.now() - ageDays * 86_400_000).toISOString(),
    updatedAt: null,
    // A still-loading detail gallery must not discard this item's working
    // search-card photo. A different item after a redirect cannot supply it.
    photoUrls: d.photos.length ? d.photos : card?.thumb && card.sourceId === d.url.match(/\/marketplace\/item\/(\d+)/)?.[1] ? [card.thumb] : [],
    /**
     * Facebook's own Condition dropdown is a value the seller PICKED, not prose
     * we guessed at, so it feeds condition normalisation directly and beats any
     * regex over the description.
     */
    attributes: d.condition ? { condition: d.condition } : {},
    raw: { listedLine: listedLine ?? null, ageDays, condition: d.condition ?? null },
  };
}

/**
 * "Listed a day ago in Medford, MA" -> "Medford, MA".
 *
 * Facebook prefixes the location line several different ways depending on the
 * listing's delivery options — "Listed 3 days ago in", "Pick up in", "Located
 * in". All of them were being stored verbatim as the location, which makes a
 * city unusable for the drive-time calculation that decides BUY vs PASS.
 */
export function stripListedPrefix(line: string | null | undefined): string | null {
  if (!line) return null;
  return line
    .replace(/^(?:listed\b.*?|pick\s?up|pickup|located|ships?\s+from|available)\s+in\s+/i, "")
    .trim() || null;
}

export interface FbSearchOptions {
  location?: string;
  query?: string;
  category?: string;
  radiusMiles?: number;
  minPrice?: number;
  maxPrice?: number;
  scrolls?: number;
}

export function searchUrl(o: FbSearchOptions): string {
  const loc = o.location ?? "boston";
  const p = new URLSearchParams();
  if (o.query) p.set("query", o.query);
  if (o.radiusMiles) p.set("radius", String(o.radiusMiles));
  if (o.minPrice != null) p.set("minPrice", String(o.minPrice));
  if (o.maxPrice != null) p.set("maxPrice", String(o.maxPrice));
  p.set("sortBy", "creation_time_descend");   // newest first — deals go fast
  const path = o.query ? `/marketplace/${loc}/search` : `/marketplace/${loc}/${o.category ?? "electronics"}`;
  return `${BASE}${path}?${p.toString()}`;
}

// ------------------------------------------------------------------- bridge

export type WorkerEvent =
  | { type: "log"; msg: string }
  | { type: "cards"; cards: Array<{ href: string; text: string; img: string | null }> }
  | { type: "detail"; url: string; title: string; bodyLines: string[]; photos: string[] }
  | { type: "graphql"; body: string }
  | { type: "error"; msg: string }
  | { type: "done"; stats: Record<string, unknown> };

/**
 * Run the Node worker and yield its events as they arrive.
 *
 * Streaming rather than collect-then-return so a long crawl reports progress
 * live — and so a crash halfway through still leaves everything before it
 * already persisted, instead of losing the whole session.
 */
export async function* runWorker(
  command: "login" | "crawl",
  opts: Record<string, unknown>,
): AsyncGenerator<WorkerEvent> {
  const proc = Bun.spawn(
    ["node", WORKER, command, JSON.stringify({ profileDir: PROFILE_DIR, chromePath: CHROME_PATH, ...opts })],
    { stdout: "pipe", stderr: "pipe", stdin: "inherit" },
  );

  const reader = proc.stdout.getReader();
  const dec = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try { yield JSON.parse(line) as WorkerEvent; }
      // A malformed line is a worker bug, not a reason to abandon a browser
      // session that took a real login to establish.
      catch { yield { type: "log", msg: `unparseable worker output: ${line.slice(0, 120)}` }; }
    }
  }

  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    yield { type: "error", msg: `worker exited ${code}${err ? `: ${err.slice(0, 300)}` : ""}` };
  }
}
