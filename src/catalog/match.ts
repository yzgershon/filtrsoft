/**
 * Catalog matching — messy listing title to canonical SKU.
 *
 * This is the unglamorous part that makes comps usable. "MacBook pro 15in like
 * new" and "Gaming Desktop PC – Intel i7-6700K / NVIDIA RTX 3050 8GB" have to
 * resolve to something you can look up prices for.
 *
 * Every successful resolution writes an ALIAS back, so the catalog learns. A
 * title that took fuzzy matching this time is an exact hit next time.
 */
import { db, now } from "../db/index.ts";
import { DEAD_PATTERNS } from "../reference/catalog.ts";

export interface Match {
  skuId: number | null;
  brand: string | null;
  model: string | null;
  category: string | null;
  liquidity: string | null;
  confidence: "high" | "medium" | "low";
  method: "alias" | "token" | "none";
  deadReason?: string;
  /** Extracted regardless of whether a SKU matched — these drive valuation. */
  attributes: Record<string, string | number>;
}

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Attributes that change value materially, pulled straight from text. */
export function extractAttributes(text: string): Record<string, string | number> {
  const a: Record<string, string | number> = {};
  const t = text.toLowerCase();

  // RAM and VRAM first, so their GB figures can't be mistaken for storage.
  // Before this, "RTX 3050 8GB" read as 8GB of storage and "32GB 512GB" read
  // the RAM as the drive.
  // "ram: 16.0 GB (15.6 GB usable)" — vision emits labelled, parenthesised text,
  // so match the LABEL first before falling back to proximity heuristics.
  const ramLabelled = t.match(/\bram\s*[:=]\s*(\d{1,3})(?:\.\d)?\s?gb\b/);
  const ram = ramLabelled
    ?? t.match(/\b(\d{1,3})\s?gb\b(?=[^.]{0,18}\b(?:ram|ddr[45]|memory)\b)/)
    ?? t.match(/\b(\d{1,3})\s?gb\s*(?:of\s*)?(?:ddr[45]\s*)?ram\b/);
  if (ram) a.ram_gb = Number(ram[1]);

  // "(12 GB)" trailing a card name is VRAM, not system memory.
  const vramMatch =
    t.match(/\b(?:rtx|gtx|rx)\s?\d{3,4}\s?(?:ti|super|xt)?\s*\(?\s*(\d{1,2})\s?gb\b/)
    ?? t.match(/\bvram\s*[:=]\s*(\d{1,2})\s?gb\b/);
  if (vramMatch) a.vram_gb = Number(vramMatch[1]);

  // Storage: prefer an explicit drive mention; otherwise take the largest GB
  // figure that isn't already claimed by RAM or VRAM.
  const explicit = t.match(/\bstorage\s*[:=]\s*(\d{1,4})\s?(gb|tb)\b/)
    ?? t.match(/\b(\d{1,4})\s?(gb|tb)\b(?=[^.]{0,14}\b(?:ssd|hdd|nvme|storage|drive|flash)\b)/);
  if (explicit) {
    a.storage_gb = explicit[2] === "tb" ? Number(explicit[1]) * 1024 : Number(explicit[1]);
  } else {
    const claimed = new Set([a.ram_gb, a.vram_gb].filter(Boolean));
    const all = [...t.matchAll(/\b(\d{1,4})\s?(gb|tb)\b/g)]
      .map((m) => (m[2] === "tb" ? Number(m[1]) * 1024 : Number(m[1])))
      .filter((n) => !claimed.has(n));
    if (all.length) a.storage_gb = Math.max(...all);
  }

  const cpu = t.match(/\b(i[3579][- ]\d{4,5}[a-z0-9]*|ryzen \d \d{4}[a-z0-9]*|m[1234](?:\s(?:pro|max|ultra))?)\b/);
  if (cpu) a.cpu = cpu[1].trim();

  const gpu = t.match(/\b((?:rtx|gtx|rx)\s?\d{3,4}\s?(?:ti|super|xt)?)\b/);
  if (gpu) a.gpu = gpu[1].replace(/\s+/g, " ").trim();

  // Model year only. Exclude dates the seller mentions in passing ("reset on
  // 8/12/2026", "installed 7/8/2026") and anything at or past the current year.
  const thisYear = new Date().getFullYear();
  const years = [...t.matchAll(/\b(20[0-2]\d)\b/g)]
    .filter((m) => !/[/-]\s*$/.test(t.slice(Math.max(0, m.index! - 2), m.index!)))
    .map((m) => Number(m[1]))
    .filter((y) => y < thisYear);
  if (years.length) a.year = Math.max(...years);

  // Carrier is a phone concept. It was landing on laptops via "unlocked".
  const isPhone = /\b(iphone|galaxy|pixel|phone)\b/.test(t);
  if (isPhone) {
    if (/\bunlocked\b/.test(t)) a.carrier = "unlocked";
    else {
      const car = t.match(/\b(t[- ]?mobile|verizon|at&t|att|sprint)\b/);
      if (car) a.carrier = car[1];
    }
  }

  const cond = t.match(/\b(for parts|parts only|not working|refurbished|refurb|open box|brand new|sealed|like new|mint|used)\b/);
  if (cond) a.condition = cond[1];

  return a;
}

/**
 * `categoryHint` comes from the signal layer. Without it a "Gaming Desktop PC /
 * RTX 3050" resolves to the GPU inside it, which prices the part instead of the
 * machine. A whole machine must never match a component SKU.
 */
export function matchSku(title: string, description = "", categoryHint?: string): Match {
  const text = `${title} ${description}`;
  const attributes = extractAttributes(text);
  const d = db();

  // Dead-category patterns fire regardless of whether a SKU resolves.
  let deadReason: string | undefined;
  for (const [re, why] of DEAD_PATTERNS) if (re.test(text)) { deadReason = why; break; }

  const base = {
    attributes,
    ...(deadReason ? { deadReason } : {}),
  };

  // --- 1. Exact alias hit. Fastest path, and the one the catalog grows into.
  const n = norm(title);
  let aliasRows = d
    .query(
      `SELECT a.alias, s.id, s.brand, s.model, s.category, s.liquidity
       FROM sku_aliases a JOIN skus s ON s.id = a.sku_id`,
    )
    .all() as Array<{ alias: string; id: number; brand: string; model: string; category: string; liquidity: string }>;

  // A whole machine is not the sum of a component SKU. Filter parts out.
  const WHOLE = new Set(["prebuilt", "laptop", "phone", "tablet", "console"]);
  if (categoryHint && WHOLE.has(categoryHint)) {
    const same = aliasRows.filter((r) => r.category === categoryHint);
    aliasRows = same.length ? same : aliasRows.filter((r) => WHOLE.has(r.category));
  }

  // Longest alias wins — "iphone 15 pro max" must beat "iphone 15".
  const hits = aliasRows
    .filter((r) => n.includes(r.alias))
    .sort((a, b) => b.alias.length - a.alias.length);

  if (hits.length) {
    const h = hits[0];
    return {
      ...base, skuId: h.id, brand: h.brand, model: h.model, category: h.category,
      liquidity: h.liquidity, confidence: "high", method: "alias",
    };
  }

  // --- 2. Token overlap against model names.
  const tokens = new Set(n.split(" ").filter((w) => w.length > 1));
  let best: { r: (typeof aliasRows)[number]; score: number } | null = null;
  for (const r of aliasRows) {
    const mt = norm(r.model).split(" ").filter((w) => w.length > 1);
    if (!mt.length) continue;
    const overlap = mt.filter((w) => tokens.has(w)).length / mt.length;
    if (overlap >= 0.6 && (!best || overlap > best.score)) best = { r, score: overlap };
  }
  if (best) {
    return {
      ...base, skuId: best.r.id, brand: best.r.brand, model: best.r.model,
      category: best.r.category, liquidity: best.r.liquidity,
      confidence: best.score >= 0.85 ? "medium" : "low", method: "token",
    };
  }

  return { ...base, skuId: null, brand: null, model: null, category: null, liquidity: null, confidence: "low", method: "none" };
}

/** Teach the catalog. Called after a confirmed resolution so next time is exact. */
export function learnAlias(skuId: number, title: string, confidence: Match["confidence"]) {
  db().query(
    `INSERT INTO sku_aliases (sku_id, alias, source, confidence, created_at)
     VALUES ($sku,$alias,'learned',$conf,$now) ON CONFLICT(alias) DO NOTHING`,
  ).run({ $sku: skuId, $alias: norm(title), $conf: confidence, $now: now() });
}
