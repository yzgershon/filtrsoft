/**
 * A $1 inventory ad has several prices, not one extraordinarily cheap item.
 * Craigslist flattens newlines, so quantity markers delimit offers even in a
 * single paragraph. Keep the seller's exact text beside every extracted fact.
 */
export interface ListingOffer {
  evidence: string;
  item: string;
  quantity: number;
  askingPriceCents: number | null;
  priceBasis: "bundle" | "each" | "ambiguous";
  capacityPerStickGb?: number;
  memoryGeneration?: string;
  memorySpeed?: number;
}

export interface ListingInventory {
  offers: ListingOffer[];
  sellerContext: string;
}

export function listingInventory(title: string, description: string, ask: number | null): ListingInventory | null {
  // Only the placeholder population. A normal PC's parts list is not a menu
  // of things sold separately, even when the seller lists their retail costs.
  if (ask == null || !Number.isFinite(ask) || ask > 100 || ask < 0) return null;
  if (!/\b(ram|memory|components|parts)\b/i.test(title)) return null;
  const starts = [...description.matchAll(/\b(\d{1,3})\s*[x×]\s*(?=\d{1,3}\s*gb\b|[a-z])/gi)];
  if (!starts.length || starts.length > 100) return null;
  const offers: ListingOffer[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!;
    if (Number(start[1]) < 1) continue;
    const evidence = description.slice(start.index, starts[i + 1]?.index ?? description.length).trim();
    const prices = [...evidence.matchAll(/\$(\d+(?:,\d{3})*(?:\.\d{1,2})?)(?![\d.])/g)];
    if (!prices.length) continue;
    const first = prices[0]!;
    const item = evidence.slice(start[0].length, first.index).replace(/[\s:–-]+$/, "").trim();
    if (!item) continue;
    const afterPrice = evidence.slice(first.index! + first[0].length);
    // Multiple amounts, discounts, a price range, or an old purchase price
    // cannot silently turn into the cheapest available offer. #651 contains
    // "$15 per stick, $10 per stick if you buy 10+"; preserve that entire tier.
    const ambiguous = prices.length !== 1 || /\b(paid|cost|retail|originally|from|starting|discount|if you|buy \d)\b/i.test(evidence)
      || /^\s*[-–]\s*\$?\d/.test(afterPrice);
    const each = /^\s*(?:ea\b|each\b|per\s+(?:stick|unit|module)\b)/i.test(afterPrice);
    const memory = item.match(/^(\d{1,3})\s*gb\b.*?\b(ddr[345])\s*[- ]\s*(\d{3,5})\b/i);
    const amount = Math.round(Number(first[1]!.replace(/,/g, "")) * 100);
    offers.push({
      evidence, item, quantity: Number(start[1]),
      askingPriceCents: ambiguous || !Number.isSafeInteger(amount) ? null : amount,
      priceBasis: ambiguous ? "ambiguous" : each ? "each" : "bundle",
      ...(memory ? { capacityPerStickGb: Number(memory[1]), memoryGeneration: memory[2]!.toUpperCase(), memorySpeed: Number(memory[3]) } : {}),
    });
  }
  if (!offers.length) return null;
  return { offers, sellerContext: description.slice(0, starts[0]!.index).trim() };
}
