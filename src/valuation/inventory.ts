import { db } from "../db/index.ts";
import { valueSku, type Valuation } from "./index.ts";
import type { ListingOffer, ListingInventory } from "../signals/listing-offers.ts";

export interface PricedOffer extends ListingOffer {
  valuation: Valuation | null;
  valuationNote: string;
}

const tokens = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * Only a fully named memory SKU at the SAME total capacity may use its comps.
 * #648's server RDIMMs must never inherit a desktop DDR4 kit's value. No
 * proportional price multiplication: eight single sticks are not one kit.
 */
export function valueInventory(inventory: ListingInventory): PricedOffer[] {
  const skus = db().query("SELECT id,brand,model FROM skus WHERE category='ram'").all() as Array<{ id: number; brand: string; model: string }>;
  return inventory.offers.map((offer) => {
    const unknown = (valuationNote: string): PricedOffer => ({ ...offer, valuation: null, valuationNote });
    if (/\b(?:rdimms?|registered|ecc)\b/i.test(`${inventory.sellerContext} ${offer.item}`)) {
      return unknown("Seller lists ECC/registered memory. Desktop-memory comps cannot price it.");
    }
    if (!offer.capacityPerStickGb || !offer.memoryGeneration || !offer.memorySpeed) {
      return unknown("No matching sold comps for this item and quantity.");
    }
    if (offer.priceBasis !== "bundle" || offer.askingPriceCents == null) {
      return unknown("Choose a quantity and confirm its total price before comparing sold kits.");
    }
    const capacity = offer.quantity * offer.capacityPerStickGb;
    const stated = new Set(tokens(offer.item));
    const matches = skus.filter((sku) => {
      const cap = sku.model.match(/\b(\d+)\s*gb\b/i);
      const ddr = sku.model.match(/\b(ddr[345])[- ](\d+)\b/i);
      const kit = sku.model.match(/\b(\d+)\s*[x×]\s*(\d+)\s*gb\b/i);
      // The catalog currently names total capacity but not kit layout. That
      // cannot prove 1x32GB vs 2x16GB. Wait for a SKU that states both rather
      // than scaling one stick or quietly treating loose memory as a kit.
      if (Number(kit?.[1]) !== offer.quantity || Number(kit?.[2]) !== offer.capacityPerStickGb) return false;
      if (Number(cap?.[1]) !== capacity || ddr?.[1]?.toUpperCase() !== offer.memoryGeneration || Number(ddr?.[2]) !== offer.memorySpeed) return false;
      // Capacity is checked above, not against the per-stick figure in text.
      const name = `${sku.brand} ${sku.model.replace(/\b\d+\s*[x×]\s*\d+\s*gb\b/i, "").replace(/\b\d+\s*gb\b/i, "")}`;
      for (const variant of ["rgb", "pro", "neo", "expo", "ecc", "registered"]) {
        if (stated.has(variant) !== tokens(name).includes(variant)) return false;
      }
      return tokens(name).every((token) => stated.has(token));
    });
    if (matches.length !== 1) return unknown("No matching sold comps for this memory configuration.");
    const valuation = valueSku(matches[0]!.id, { category: "ram", condition: "used" });
    if (valuation.medianCents == null) return unknown("No usable recent sold comps for this exact configuration.");
    return { ...offer, valuation, valuationNote: `Sold comps for ${matches[0]!.brand} ${matches[0]!.model}; compare with the entire ${offer.quantity}-stick offer.` };
  });
}
