/**
 * Catalog seed.
 *
 * Two jobs:
 *   1. Give comps something to classify against on arrival, so the archive isn't
 *      a pile of NULL sku_ids needing a backfill later.
 *   2. Carry the LIQUIDITY tier, which can veto a BUY regardless of margin.
 *
 * Liquidity comes from Yish's audit (CALIBRATION finding 3). His words:
 *   VR            — "gets boring after 2 weeks and people know that, very hard to resell"
 *   pre-2019 Macs — "the only apple laptops worth reselling are the m processor ones"
 *   datacenter GPU— "practically no market for this gpu"
 *
 * A good price on something that won't sell is not a deal.
 */
export type Liquidity = "hot" | "normal" | "slow" | "dead";

export interface SeedSku {
  category: string;
  brand: string;
  model: string;
  attributes?: Record<string, unknown>;
  liquidity: Liquidity;
  aliases?: string[];
}

const iphone = (n: number, variant: string, liq: Liquidity): SeedSku => ({
  category: "phone", brand: "Apple", model: `iPhone ${n}${variant ? " " + variant : ""}`,
  attributes: { gen: n, variant: variant || "base", connector: n >= 15 ? "usb-c" : "lightning" },
  liquidity: liq,
  aliases: [`iphone${n}${variant.toLowerCase().replace(/\s/g, "")}`],
});

export const CATALOG: SeedSku[] = [
  // ---- phones (hot: current gen; slow: 4+ gens back) ----
  ...[16, 15].flatMap((n) => ["", "Plus", "Pro", "Pro Max"].map((v) => iphone(n, v, "hot"))),
  ...[14, 13].flatMap((n) => ["", "Plus", "Pro", "Pro Max"].map((v) => iphone(n, v, "normal"))),
  ...[12, 11].flatMap((n) => ["", "Pro", "Pro Max"].map((v) => iphone(n, v, "slow"))),

  { category: "phone", brand: "Samsung", model: "Galaxy S24 Ultra", liquidity: "hot" },
  { category: "phone", brand: "Samsung", model: "Galaxy S23 Ultra", liquidity: "normal" },
  { category: "phone", brand: "Samsung", model: "Galaxy Z Flip 6", attributes: { foldable: true }, liquidity: "normal" },
  { category: "phone", brand: "Samsung", model: "Galaxy Z Flip 5", attributes: { foldable: true }, liquidity: "slow" },
  { category: "phone", brand: "Samsung", model: "Galaxy Z Fold 6", attributes: { foldable: true }, liquidity: "normal" },
  { category: "phone", brand: "Samsung", model: "Galaxy Z Fold 5", attributes: { foldable: true }, liquidity: "slow" },

  // ---- laptops. The 2019 cutoff is Yish's rule, not a spec boundary. ----
  /**
   * **KEEP THE CURRENT APPLE SILICON GENERATION IN HERE.** A live listing read
   * "Brand new APPLE MACBOOK AIR M5" and Assyze answered *"Couldn't identify
   * the exact model"* — with the model printed in the title, in capitals.
   *
   * The catalog stopped at M4 and the failure surfaced as an identification
   * problem rather than a coverage one, which reads as broken rather than new.
   * Apple ships one of these a year; being a year behind is the default state
   * unless someone adds the row.
   */
  { category: "laptop", brand: "Apple", model: "MacBook Air M5", attributes: { silicon: "M5", year: 2026 }, liquidity: "hot" },
  { category: "laptop", brand: "Apple", model: "MacBook Pro M5", attributes: { silicon: "M5", year: 2026 }, liquidity: "hot" },
  { category: "laptop", brand: "Apple", model: "MacBook Pro M4", attributes: { silicon: "M4", year: 2025 }, liquidity: "hot" },
  { category: "laptop", brand: "Apple", model: "MacBook Air M4", attributes: { silicon: "M4", year: 2025 }, liquidity: "hot" },
  { category: "laptop", brand: "Apple", model: "MacBook Air M3", attributes: { silicon: "M3", year: 2024 }, liquidity: "hot" },
  { category: "laptop", brand: "Apple", model: "MacBook Air M2", attributes: { silicon: "M2", year: 2022 }, liquidity: "hot" },
  { category: "laptop", brand: "Apple", model: "MacBook Air M1", attributes: { silicon: "M1", year: 2020 }, liquidity: "hot" },
  { category: "laptop", brand: "Apple", model: "MacBook Pro M3", attributes: { silicon: "M3", year: 2023 }, liquidity: "hot" },
  { category: "laptop", brand: "Apple", model: "MacBook Pro M1", attributes: { silicon: "M1", year: 2020 }, liquidity: "hot" },
  { category: "laptop", brand: "Apple", model: "MacBook Pro (Intel, pre-2019)", attributes: { silicon: "intel", preM: true }, liquidity: "dead",
    aliases: ["macbook pro 2014", "macbook pro 2015", "macbook pro 2016", "macbook pro 2017", "macbook pro 17"] },
  { category: "laptop", brand: "Apple", model: "MacBook Air (Intel, pre-2019)", attributes: { silicon: "intel", preM: true }, liquidity: "dead",
    aliases: ["macbook air 2013", "macbook air 2014", "macbook air 2015"] },

  { category: "laptop", brand: "Dell", model: "Latitude 7420", attributes: { cpu: "i7-1185G7", year: 2021 }, liquidity: "normal" },
  { category: "laptop", brand: "Dell", model: "Latitude 5520", attributes: { cpu: "i7-1185G7", year: 2021 }, liquidity: "normal" },
  { category: "laptop", brand: "Dell", model: "XPS 15 9520", liquidity: "normal" },
  { category: "laptop", brand: "Lenovo", model: "ThinkPad X1 Carbon", liquidity: "slow" },

  // ---- GPUs ----
  { category: "gpu", brand: "NVIDIA", model: "RTX 5090", attributes: { vram: 32 }, liquidity: "hot" },
  { category: "gpu", brand: "NVIDIA", model: "RTX 5080", attributes: { vram: 16 }, liquidity: "hot" },
  { category: "gpu", brand: "NVIDIA", model: "RTX 5070", attributes: { vram: 12 }, liquidity: "hot" },
  { category: "gpu", brand: "NVIDIA", model: "RTX 4090", attributes: { vram: 24 }, liquidity: "hot" },
  { category: "gpu", brand: "NVIDIA", model: "RTX 4070", attributes: { vram: 12 }, liquidity: "hot" },
  { category: "gpu", brand: "NVIDIA", model: "RTX 4060", attributes: { vram: 8 }, liquidity: "normal" },
  { category: "gpu", brand: "NVIDIA", model: "RTX 3080", attributes: { vram: 10, miningEra: true }, liquidity: "normal" },
  { category: "gpu", brand: "NVIDIA", model: "RTX 3060", attributes: { vram: 12, miningEra: true }, liquidity: "normal" },
  { category: "gpu", brand: "NVIDIA", model: "RTX 3050", attributes: { vram: 8 }, liquidity: "slow" },
  { category: "gpu", brand: "NVIDIA", model: "GTX 1080", attributes: { miningEra: true }, liquidity: "slow" },

  // Display-less compute cards. Not GPUs for any normal buyer.
  { category: "gpu", brand: "NVIDIA", model: "Tesla (datacenter)", attributes: { noDisplayOutput: true, passiveCooling: true }, liquidity: "dead",
    aliases: ["tesla p100", "tesla v100", "tesla k80", "tesla m40", "tesla p40"] },
  { category: "gpu", brand: "NVIDIA", model: "CMP (mining)", attributes: { noDisplayOutput: true }, liquidity: "dead",
    aliases: ["cmp 30hx", "cmp 40hx", "cmp 50hx", "cmp 90hx"] },

  // ---- consoles ----
  { category: "console", brand: "Sony", model: "PlayStation 5 Slim", liquidity: "hot" },
  { category: "console", brand: "Microsoft", model: "Xbox Series X", liquidity: "normal" },
  { category: "console", brand: "Microsoft", model: "Xbox Series S", liquidity: "normal" },
  { category: "console", brand: "Nintendo", model: "Switch 2", liquidity: "hot" },
  { category: "console", brand: "Nintendo", model: "Switch OLED", liquidity: "normal" },
  { category: "console", brand: "Microsoft", model: "Xbox One X", liquidity: "slow" },

  // ---- VR: dead by Yish's rule, not by price ----
  { category: "console", brand: "Sony", model: "PSVR2", attributes: { vr: true }, liquidity: "dead" },
  { category: "console", brand: "Meta", model: "Quest 3", attributes: { vr: true }, liquidity: "dead" },
  { category: "console", brand: "Meta", model: "Quest 3S", attributes: { vr: true }, liquidity: "dead" },
  { category: "console", brand: "Valve", model: "Index", attributes: { vr: true }, liquidity: "dead" },
];

/** Category-level fallback when no specific SKU matches. */
export const DEAD_PATTERNS: Array<[RegExp, string]> = [
  [/\b(psvr|quest [23]|vive|valve index|vr headset|oculus)\b/i, "VR — very hard to resell regardless of price"],
  [/\b(tesla [pvmk]\d+|cmp \d+hx|nvidia a(100|40|30)\b)/i, "datacenter/mining card — practically no resale market"],
  [/\bmacbook (pro|air).{0,20}\b20(0\d|1[0-8])\b/i, "pre-2019 Intel Mac — only M-series Apple laptops move"],
];
