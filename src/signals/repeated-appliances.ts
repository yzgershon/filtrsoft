/** Repetition AND a household appliance, never repetition alone. */
export function repeatedAppliances<T extends { title: string | null; source: string; asking_price_cents: number | null }>(rows: T[]): T[] {
  const appliance = /\b(ice (?:cube )?maker|washing machine|washer\/dryer|food processor|sewing machine|induction cooktop|cooking appliances|cordless vacuum|\d+\s*btu\b.*\bacs?\b|\bac\b.*\bbtu|tower fans?\b.*\bbox fan)\b/i;
  const device = /\b(pc|computer|laptop|macbook|iphone|ipad|gaming|gpu|rtx|gtx|ryzen|ssd|nvme)\b/i;
  const key = (row: T) => `${row.source}|${(row.title ?? "").trim().toLowerCase()}|${row.asking_price_cents}`;
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  // #648's RAM menu and ten real MacBook Airs must survive. A seller identity
  // is not inferred: all seller_ref fields were NULL at the September audit.
  return rows.filter((row) => row.source === "craigslist" && (counts.get(key(row)) ?? 0) >= 4
    && appliance.test(row.title ?? "") && !device.test(row.title ?? ""));
}
