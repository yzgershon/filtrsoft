/**
 * eBay sold comps — the archive's real source.
 *
 * WHY THIS IS THE IMPORTANT FILE: every valuation in Assyze needs sold prices,
 * and until now there were none. 80 provisional rows, hand-typed, covering 10 of
 * 83 SKUs. The plan said "waiting on eBay keys", which was wrong twice over —
 * production keys grant the Browse API (ACTIVE listings), and the sold-history
 * API is Limited Release and closed to new users.
 *
 * Yish's observation is what unblocked it: the browser automation built for
 * Facebook can read eBay's own sold-listings page, which needs nothing but a
 * signed-in account. Same pattern, different site.
 *
 * PARSING LIVES HERE, IN BUN, and the worker is dumb on purpose. eBay's markup
 * has already churned once (`s-item` -> `s-card`); when it churns again the fix
 * should be a pure-function change with a test, not a browser session.
 */
import { join } from "node:path";
import { insertComp, db, now } from "../db/index.ts";
import { normalizeCondition, type Condition } from "../valuation/condition.ts";

const WORKER = join(import.meta.dir, "../browser/ebay-worker.mjs");

export const CHROME_PATH =
  process.env.ASSYZE_CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

export interface SoldComp {
  sourceItemId: string;
  url: string;
  title: string;
  soldPriceCents: number;
  shippingCents: number | null;
  soldAt: string | null;
  conditionRaw: string | null;
  conditionNorm: Condition | null;
}

/** "$1,234.56" -> 123456. Ranges ("$10.00 to $20.00") take the LOW end. */
export function parseMoney(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, "").match(/\$\s?(\d+(?:\.\d{1,2})?)/);
  return m ? Math.round(Number(m[1]) * 100) : null;
}

/**
 * Shipping, which MUST be separated from the item price.
 *
 * `sold_price_cents + shipping_cents` is the buyer's real total, and that total
 * is what a comp means. Free shipping is 0, not null — "the seller absorbed it"
 * and "we do not know" are different facts, and only one of them can be added.
 */
export function parseShipping(lines: string[]): number | null {
  const line = lines.find((l) => /shipping|delivery/i.test(l));
  if (!line) return null;
  if (/free/i.test(line)) return 0;
  return parseMoney(line);
}

/**
 * "Sold Mar 14, 2026" / "Sold  14 Mar 2026" -> ISO date.
 *
 * The date is what makes a comp decay correctly — `valueSku` filters to a 90-day
 * window, and a comp with no date is treated as always-current, which quietly
 * keeps stale prices alive forever.
 */
export function parseSoldDate(lines: string[], nowMs = Date.now()): string | null {
  const line = lines.find((l) => /^sold\b/i.test(l));
  if (!line) return null;
  const cleaned = line.replace(/^sold\s*/i, "").trim();

  /**
   * ONLY trust `Date.parse` when the string actually carries a year.
   *
   * `Date.parse("Aug 20")` does not fail — it returns **2001-08-20**, silently.
   * That comp then sits five thousand days outside `valueSku`'s 90-day window
   * and is dropped from every valuation, with nothing anywhere reporting a
   * problem. eBay omits the year for recent sales, which is most of them, so
   * this would have quietly discarded the freshest and most valuable comps.
   */
  if (/\b(19|20)\d{2}\b/.test(cleaned)) {
    const t = Date.parse(cleaned);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }

  // No year stated: it is within the last 12 months by construction.
  const md = cleaned.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})$/);
  if (md) {
    const year = new Date(nowMs).getUTCFullYear();
    const p = Date.parse(`${md[1]} ${md[2]}, ${year}`);
    if (!Number.isNaN(p)) {
      // A date in the future means eBay meant last year.
      const d = p > nowMs ? Date.parse(`${md[1]} ${md[2]}, ${year - 1}`) : p;
      return new Date(d).toISOString();
    }
  }
  return null;
}

const CONDITION_LINE =
  /^(brand new|new \(other\)|new with|new without|new|open box|certified refurbished|excellent - refurbished|very good - refurbished|good - refurbished|seller refurbished|refurbished|pre-owned|used|for parts or not working|parts only)/i;

/**
 * One search-result row to a comp.
 *
 * Returns null rather than guessing. A row without a price or an item id is not
 * a weak comp, it is not a comp — and per the archive rule these rows are kept
 * forever, so letting junk in poisons every future valuation of that SKU.
 */
export function parseSoldRow(
  row: { href: string; text: string[]; img: string | null },
  nowMs = Date.now(),
): SoldComp | null {
  const id = row.href.match(/\/itm\/(\d+)/)?.[1];
  if (!id) return null;

  // eBay's first result row is a "Shop on eBay" placeholder with no real price.
  if (row.text.some((l) => /^shop on ebay$/i.test(l))) return null;

  const priceLine = row.text.find((l) => /^\$[\d,]/.test(l));
  const price = parseMoney(priceLine);
  if (!price) return null;

  const conditionRaw = row.text.find((l) => CONDITION_LINE.test(l)) ?? null;
  // The title is the longest line that is not price, condition or metadata.
  const title = row.text
    .filter((l) =>
      l !== priceLine && l !== conditionRaw &&
      !/^sold\b|shipping|delivery|watchers?|bids?|best offer|sponsored|^\$/i.test(l))
    .sort((a, b) => b.length - a.length)[0] ?? "";

  return {
    sourceItemId: id,
    url: row.href,
    title,
    soldPriceCents: price,
    shippingCents: parseShipping(row.text),
    soldAt: parseSoldDate(row.text, nowMs),
    conditionRaw,
    conditionNorm: normalizeCondition(conditionRaw),
  };
}

export type EbayEvent =
  | { type: "log"; msg: string }
  | { type: "sold"; query: string; rows: Array<{ href: string; text: string[]; img: string | null }> }
  | { type: "error"; msg: string }
  | { type: "done"; stats: Record<string, unknown> };

export async function* runEbayWorker(
  command: "login" | "sold",
  opts: Record<string, unknown>,
): AsyncGenerator<EbayEvent> {
  const proc = Bun.spawn(
    ["node", WORKER, command, JSON.stringify({ chromePath: CHROME_PATH, ...opts })],
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
      try { yield JSON.parse(line) as EbayEvent; }
      catch { yield { type: "log", msg: `unparseable: ${line.slice(0, 120)}` }; }
    }
  }
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    yield { type: "error", msg: `worker exited ${code}${err ? `: ${err.slice(0, 300)}` : ""}` };
  }
}

/**
 * Persist comps. Idempotent on (source, source_item_id), so re-running a query
 * tops up rather than duplicating.
 *
 * `raw_json` carries the untouched row text. eBay exposes ~90 days and then the
 * listing is gone for good, so a field we did not think to parse today is only
 * recoverable if the raw text was kept.
 */
export function saveComps(comps: SoldComp[], query: string, skuId: number | null = null): number {
  let n = 0;
  for (const c of comps) {
    const r = insertComp({
      source: "ebay",
      source_item_id: c.sourceItemId,
      url: c.url,
      raw_title: c.title,
      sold_price_cents: c.soldPriceCents,
      shipping_cents: c.shippingCents ?? undefined,
      condition_raw: c.conditionRaw ?? undefined,
      condition_norm: c.conditionNorm ?? undefined,
      sold_at: c.soldAt ?? undefined,
      sku_id: skuId,
      query,
      raw: c,
    });
    if (r.changes) n++;
  }
  return n;
}

/**
 * Which SKUs most need comps, worst first.
 *
 * 73 of 83 SKUs have zero comps, so the order matters: pulling for a SKU that
 * already has fifteen sales adds nothing, while the empty ones are the reason
 * 332 listings read INSUFFICIENT_DATA.
 */
export function skusNeedingComps(limit = 20): Array<{ id: number; brand: string; model: string; category: string; comps: number }> {
  return db()
    .query(
      `SELECT s.id, s.brand, s.model, s.category, COUNT(c.id) comps
       FROM skus s LEFT JOIN comps c ON c.sku_id = s.id
       GROUP BY s.id ORDER BY comps ASC, s.category, s.model
       LIMIT $lim`,
    )
    .all({ $lim: limit }) as Array<{ id: number; brand: string; model: string; category: string; comps: number }>;
}

export const nowIso = now;
