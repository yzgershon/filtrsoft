/**
 * The generative matcher — parse a model out of the title instead of
 * enumerating every model in the catalog.
 *
 * **WHY THIS EXISTS, measured rather than assumed.** "Couldn't identify the
 * exact model" is the largest single reason a listing cannot be priced: 132 of
 * 267 on 2026-08-26. On 2026-08-26 I added 39 hand-written laptop SKUs for the
 * lines that recur most, pulled comps to 18,603, and the number went
 * **125 -> 132**. It did not move.
 *
 * That is what a long tail looks like. 44 unmatched laptops spanned ~17
 * distinct models, almost all appearing once or twice, so enumerating fixes the
 * seventeen you saw and never the seventeen you get next week. The catalog
 * cannot be written fast enough by hand; it has to grow from what walks past.
 *
 * ── WHY THIS IS NOT `catalog:derive --apply` ───────────────────────────────
 *
 * That script mines SKUs from COMPS, and its top suggestions are parts: "Dell
 * Inspiron 14 5420 LCD Display", cooling fans, motherboards. Applying it
 * creates SKUs priced off salvage, which is the trap RISK-MODEL already warns
 * about. This reads LISTINGS — the thing we are actually trying to price — and
 * refuses anything that does not look like a whole machine.
 *
 * ── THE SAFETY RULES, AND EACH ONE IS LOAD-BEARING ─────────────────────────
 *
 * Creating catalog rows from untrusted seller text is how a catalog fills with
 * garbage that then prices real listings wrongly. So this is deliberately
 * strict and refuses far more than it accepts:
 *
 *   1. **A known LINE token is required.** "Latitude", "ThinkPad", "EliteBook".
 *      No line, no SKU — a bare "Dell laptop" is a family, not a product.
 *   2. **A DIGIT-BEARING model token is required**, adjacent to the line. This
 *      is the same rule `matchSku` already enforces, and it is what makes an
 *      auto-created "Latitude 5480" safe against a 5490: every digit token must
 *      appear in a listing for it to match later.
 *   3. **Spec numbers are never model numbers.** "15.6", "16GB", "512GB",
 *      "i7-1165G7", "2020" are all digits next to a line name and none of them
 *      identify a product. Rejected explicitly rather than hoped against.
 *   4. **Reseller ads and multi-unit listings are refused**, because "Dell 5540
 *      Mobile Workstations, up to 64GB" is a shop's stock and would mint a SKU
 *      from an advert.
 *
 * The output is a SKU with NO comps, which changes the verdict from "couldn't
 * identify the exact model" to "no recent sold comps for this model". That is
 * a strictly more honest answer AND it puts the model in the queue the comps
 * puller already drains worst-first.
 */
import { db, now } from "../db/index.ts";

export interface DerivedSku {
  brand: string;
  line: string;
  model: string;
  category: string;
}

/**
 * Line names that carry a model number, by brand.
 *
 * Only families whose numbering is REGULAR enough to parse safely. HP's
 * consumer lines ("17-cn2775st") and Acer's are deliberately absent — their
 * model strings are long alphanumeric SKUs that are easy to mangle and rare
 * enough not to be worth the risk of minting wrong rows.
 */
const LINES: Array<{ brand: string; line: RegExp; model: RegExp; label: string }> = [
  // Dell business/consumer: a bare 4-digit model, optionally E-prefixed.
  { brand: "Dell", label: "Latitude", line: /\blatitude\b/i, model: /\b(e?\d{4})\b/i },
  { brand: "Dell", label: "Precision", line: /\bprecision\b/i, model: /\b(\d{4})\b/ },
  { brand: "Dell", label: "Vostro", line: /\bvostro\b/i, model: /\b(\d{4})\b/ },
  { brand: "Dell", label: "OptiPlex", line: /\boptiplex\b/i, model: /\b(\d{3,4})\b/ },
  { brand: "Dell", label: "Inspiron", line: /\binspiron\b/i, model: /\b(\d{4})\b/ },
  { brand: "Dell", label: "XPS", line: /\bxps\b/i, model: /\b(\d{4})\b/ },
  // HP business: "840 G7" — the generation suffix is part of the identity and
  // a 840 G5 is worth materially less than a G8, so both halves are required.
  { brand: "HP", label: "EliteBook", line: /\belitebook\b/i, model: /\b(\d{3,4}\s?g\d{1,2})\b/i },
  { brand: "HP", label: "ProBook", line: /\bprobook\b/i, model: /\b(\d{3,4}\s?g\d{1,2})\b/i },
  // Lenovo ThinkPad: letter-prefixed (T480, X1, P52, E14, L14, T14s).
  { brand: "Lenovo", label: "ThinkPad", line: /\bthinkpad\b/i, model: /\b([txpels]\d{1,3}[a-z]?)\b/i },
];

/**
 * Numbers that sit next to a line name and are NOT model numbers.
 *
 * Checked against the captured token itself, not the whole title, because the
 * title legitimately contains all of these alongside a real model.
 */
const NOT_A_MODEL = [
  /^(19|20)\d{2}$/,          // a year: "Latitude 2019"
  /^\d{1,2}(\.\d)?$/,        // a screen size: 14, 15.6
  /^\d{1,4}(gb|tb|mb)$/i,    // capacity
  /^g\d$/i,                  // a bare generation with no base number
];

/** Shop inventory, not a unit. Minting a SKU from an advert is worse than none. */
const NOT_A_UNIT =
  /\bup to \d+\s?(gb|tb)\b|\b(blowout|clearance|wholesale|liquidation|bulk)\b|\blot of \d|\b(laptops|desktops|workstations|computers)\b|\bstarting at\b/i;

/**
 * Parse a whole-machine model out of a listing title.
 *
 * Returns null far more often than not, and that is the intended behaviour: a
 * missed parse costs one unpriced listing, a wrong parse mints a catalog row
 * that misprices every future listing that matches it.
 */
/**
 * Graphics cards, which are far MORE regular than laptops and worth a
 * dedicated parser.
 *
 * Every consumer card in the last decade is `<family> <number> <variant?>`:
 * RTX 4070 Ti, GTX 1660 Super, RX 6750 XT, RX 9060 XT. That is a grammar, not
 * a list, so enumerating them was always the wrong shape — the catalog held 42
 * and the feed still had cards it had never heard of.
 *
 * **THE VARIANT IS PART OF THE IDENTITY, NEVER AN OPTIONAL SUFFIX.** A 4070 Ti
 * is hundreds of dollars from a 4070, and this file already documents an alias
 * bug where exactly that confusion priced a Ti as a base card and turned a good
 * listing into a PASS. Captured into the model so a derived SKU can never be
 * the wrong tier.
 *
 * Workstation cards (Quadro, Tesla, CMP) are deliberately EXCLUDED — they are
 * a different market with different buyers, and the catalog already marks the
 * compute ones dead on purpose.
 */
const GPU_MODEL =
  /\b(rtx|gtx|rx)\s?(\d{3,4})\s?(ti\s?super|ti|super|xt|xtx)?\b/i;

const GPU_BRAND: Record<string, string> = { rtx: "NVIDIA", gtx: "NVIDIA", rx: "AMD" };

function parseGpu(title: string): DerivedSku | null {
  // A laptop containing a 4090 is not a 4090. The category hint has already
  // decided this is a card; this only guards the obvious mislabels.
  if (/\b(laptop|notebook|quadro|tesla|\bcmp\b|mobile)\b/i.test(title)) return null;
  const m = GPU_MODEL.exec(title);
  if (!m) return null;
  const family = m[1].toUpperCase();
  const num = m[2];
  const variant = m[3] ? ` ${m[3].replace(/\s+/g, " ").toUpperCase()}` : "";
  return {
    brand: GPU_BRAND[m[1].toLowerCase()] ?? "NVIDIA",
    line: family,
    model: `${family} ${num}${variant}`,
    category: "gpu",
  };
}

export function parseModel(title: string, category: string | null): DerivedSku | null {
  if (NOT_A_UNIT.test(title)) return null;
  if (category === "gpu") return parseGpu(title);
  if (category !== "laptop" && category !== "prebuilt") return null;

  for (const spec of LINES) {
    const lineHit = spec.line.exec(title);
    if (!lineHit) continue;

    /**
     * Search only the text AFTER the line name.
     *
     * A model number precedes its line name essentially never, while spec
     * numbers precede it constantly — "15.6 inch Dell Latitude", "16GB Dell
     * Precision". Anchoring here removes a whole class of false parse before
     * `NOT_A_MODEL` has to catch it.
     */
    const after = title.slice(lineHit.index + lineHit[0].length);
    const modelHit = spec.model.exec(after);
    if (!modelHit) continue;

    const raw = modelHit[1].trim();
    if (NOT_A_MODEL.some((re) => re.test(raw))) continue;

    // Normalise "840g7" and "840 G7" to one spelling so two listings of the
    // same machine cannot mint two SKUs.
    const model = `${spec.label} ${raw.replace(/\s+/g, " ").toUpperCase()}`
      .replace(/\b([A-Z])(\d)/g, "$1$2");

    return { brand: spec.brand, line: spec.label, model, category };
  }
  return null;
}

/**
 * Find the SKU for a parsed model, creating it if it does not exist.
 *
 * Separator-insensitive on lookup for the same reason `valueByParts` is:
 * "840 G7" and "840G7" are one product, and minting both would split its comps
 * across two rows and halve every sample.
 */
export function findOrCreateSku(d: DerivedSku): { id: number; created: boolean } {
  const flat = d.model.toLowerCase().replace(/[\s-]/g, "");
  const existing = db().query(
    `SELECT id FROM skus
      WHERE category = $cat
        AND REPLACE(REPLACE(LOWER(model), ' ', ''), '-', '') = $flat
      LIMIT 1`,
  ).get({ $cat: d.category, $flat: flat }) as { id: number } | null;
  if (existing) return { id: existing.id, created: false };

  const r = db().run(
    `INSERT INTO skus (category, brand, model, attributes, liquidity, created_at, source)
     VALUES (?,?,?,'{}',NULL,?,'derived')`,
    [d.category, d.brand, d.model, now()],
  );
  return { id: Number(r.lastInsertRowid), created: true };
}

/** How many SKUs this mechanism has minted. Reported on /v1/health. */
export function derivedSkuCount(): number {
  try {
    return (db().query("SELECT COUNT(*) n FROM skus WHERE source='derived'").get() as { n: number }).n;
  } catch { return 0; }
}
