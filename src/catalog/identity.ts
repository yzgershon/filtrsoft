/** Interpret legacy SSD rows without rewriting the active crawl's database. */
export function catalogCategory(category: string, model: string): string {
  return category === "ram" && /\b(?:ssd|hdd|nvme|hard drive|solid state drive)\b/i.test(model)
    ? "storage" : category;
}
export const EXACT_PARTS = new Set(["ram", "storage", "psu", "motherboard", "case"]);
const normalized = (s: string) => s.toLowerCase()
  .replace(/\b(\d+)\s*[x×]\s*(\d+)\s*gb\b/g, "$1x$2gb")
  .replace(/western\s+digital/g, "wd").replace(/g[.\s-]*skill/g, "gskill")
  .replace(/\bnon[- ]?ecc\b/g, "")
  .replace(/(\d)\s*(?:mt\/s|mts|mhz)\b/g, "$1")
  .replace(/(\d)\s+(gb|tb|w)\b/g, "$1$2")
  .replace(/[^a-z0-9]+/g, " ").trim();
const NOUNS = new Set(["desktop", "memory", "ram", "kit", "pc", "case", "computer", "chassis", "motherboard", "mobo", "power", "supply", "psu", "ssd", "nvme", "hdd", "drive", "solid", "state"]);
export function memoryLayout(s: string): string | null {
  const m = s.match(/\b(\d+)\s*[x×]\s*(\d+)\s*gb\b/i);
  return m ? `${Number(m[1])}x${Number(m[2])}` : null;
}
/** Numeric-only guards admitted another brand and ECC sticks as desktop kits.
 * Missing layout stays uncertain, even when that means no memory valuation.
 */
export function exactPartIdentity(title: string, identity: string, category: string): boolean {
  if (!EXACT_PARTS.has(category)) return true;
  const wanted = normalized(identity).split(" ").filter(t => t && !NOUNS.has(t));
  const got = new Set(normalized(title).split(" "));
  if (!wanted.length || !wanted.every(t => got.has(t))) return false;
  const variants = category === "ram" ? ["rgb", "pro", "neo", "expo", "ecc", "registered", "rdimm", "sodimm"]
    : category === "storage" ? ["pro", "plus", "heatsink"] : [];
  const q = new Set(normalized(identity).split(" "));
  if (variants.some(v => got.has(v) !== q.has(v))) return false;
  if (category === "ram") {
    const layout = memoryLayout(identity);
    if (!layout || layout !== memoryLayout(title)) return false;
    if (!/\bddr[345][ -]?\d{3,5}\b/i.test(identity)) return false;
  }
  return true;
}
