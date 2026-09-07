import { db, now } from "./index.ts";
import { repeatedAppliances } from "../signals/repeated-appliances.ts";

export function retireRepeatedAppliances(dry = false) {
  const d = db();
  const rows = d.query("SELECT id,title,source,asking_price_cents FROM listings WHERE delisted_at IS NULL").all() as Array<{
    id: number; title: string; source: string; asking_price_cents: number | null;
  }>;
  const candidates = repeatedAppliances(rows);
  if (!dry) {
    const at = now();
    const update = d.prepare("UPDATE listings SET delisted_at=?,delist_reason='repeated_appliance' WHERE id=? AND delisted_at IS NULL");
    d.transaction(() => { for (const row of candidates) update.run(at, row.id); })();
  }
  return candidates;
}
