export type Category =
  | "phone" | "laptop" | "gpu" | "prebuilt" | "console" | "tablet" | "component"
  | "ram" | "storage" | "psu" | "motherboard" | "case" | "unknown";

export type Verdict =
  | "BUY" | "FAIR" | "PASS" | "VERIFY" | "RISK" | "INSUFFICIENT_DATA" | "OUT_OF_SCOPE";

export type Confidence = "high" | "medium" | "low";

export interface RawListing {
  source: string;
  sourceId: string;
  url: string;
  title: string;
  description: string;
  askingPriceCents: number | null;
  location: string | null;
  postedAt: string | null;
  updatedAt: string | null;
  photoUrls: string[];
  attributes: Record<string, string>;
  sellerRef?: string | null;
  raw: unknown;
}

export interface Signal {
  code: string;
  severity: "blocker" | "high" | "medium" | "low" | "info";
  /** Positive signals exist too — a refurbisher cluster is a BUY signal, not a risk. */
  polarity: "negative" | "positive" | "neutral";
  evidence: string;
}

export interface SignalReport {
  signals: Signal[];
  daysOnMarket: number | null;
  /** 0-1. Photos, description depth, spec completeness, volunteered defects. */
  listingQuality: number;
  /** 0-1. How much the seller demonstrably knows about their own item. */
  sellerSophistication: number;
  category: Category;
  missingValueFields: string[];
}
