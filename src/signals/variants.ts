/**
 * Product VARIANTS — the words inside a model name that change the price.
 *
 * Lived in `sources/ebay.ts` until 2026-08-26. Moved here because
 * `catalog/match.ts` needs the same knowledge and the catalog must not depend
 * on a source: an RTX 5070 **Ti** was matching the plain RTX 5070 SKU at HIGH
 * confidence and being priced ~40% under, and an RTX 4070 **Super** matched the
 * base 4070 the same way. `compMatchesQuery` had guarded the COMPS against
 * exactly this for weeks; the matcher never learned it.
 */
/**
 * Which words are real product VARIANTS, per category.
 *
 * This cannot be one list. On a GPU, "Ti" and "Super" are different silicon
 * with different prices — but "Ultra" is EVGA's cooler name ("RTX 3080 XC3
 * Ultra") and "Pro"/"Max" are board-partner marketing. On a PHONE the opposite
 * holds: "Pro Max" is the product and there is no such thing as a Ti.
 *
 * A single combined list rejected a perfectly good RTX 3080 for saying "Ultra".
 */
export function variantPattern(category?: string | null): RegExp {
  switch (category) {
    case "gpu":
    case "component":
      return /\b(ti|super|xt|xtx)\b/gi;
    case "phone":
    case "tablet":
      return /\b(pro|max|plus|mini|ultra|se|fe)\b/gi;
    case "laptop":
      return /\b(pro|air)\b/gi;
    /**
     * Consoles. "Digital Edition" has no disc drive and sells for meaningfully
     * less; "Slim" and "Pro" are different hardware again. Found while building
     * the retail ceiling: a $599.99 PS5 Slim **Digital** came back as the new
     * price of a disc PS5, and since the ceiling takes the CHEAPEST offer, the
     * cheaper sibling wins every time unless it is named as a variant.
     */
    case "console":
      return /\b(digital|slim|pro|oled|lite)\b/gi;
    default:
      return /\b(ti|super|xt|xtx)\b/gi;
  }
}

/** Windows Pro describes the installed OS, never a MacBook/Legion Pro tier. */
export function productVariants(text:string,category?:string|null):Set<string> {
  const identity=category==='laptop'?text.replace(/\b(?:windows|win)\s*(?:7|8(?:\.1)?|10|11)\s*pro(?:fessional)?\b/gi,''):text;
  return new Set((identity.toLowerCase().match(variantPattern(category))??[]).map(v=>v.toLowerCase()));
}
