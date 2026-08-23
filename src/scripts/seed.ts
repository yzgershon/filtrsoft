/**
 * Seeds the database with what we already know:
 *   1. Yish's economics profile (CALIBRATION-2026-08-23.md, finding 1)
 *   2. His 69 audit judgments — the eval set the engine gets scored against
 *
 * Idempotent. Safe to re-run.
 */
import { db, now } from "../db/index.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const d = db();

// --- 1. Yish's economics -----------------------------------------------
// Two stated points ($100 local, $150 at 30min) resolve to one parameter:
// an effective hourly floor of roughly $120-135.
d.query(
  `INSERT INTO user_economics (label, home_location, min_absolute_profit_cents,
     effective_hourly_floor_cents, max_drive_minutes, transaction_minutes,
     relist_minutes, prefers_channel, updated_at)
   VALUES ('yish', 'Newton, MA', 10000, 12500, NULL, 15, 20, 'facebook', $now)
   ON CONFLICT(label) DO UPDATE SET
     min_absolute_profit_cents = excluded.min_absolute_profit_cents,
     effective_hourly_floor_cents = excluded.effective_hourly_floor_cents,
     prefers_channel = excluded.prefers_channel,
     updated_at = excluded.updated_at`,
).run({ $now: now() });

// --- 2. The audit as the eval set ---------------------------------------
const auditPath = join(
  import.meta.dir,
  "../../docs/testset/audit-results-2026-08-23.json",
);
const audit = JSON.parse(readFileSync(auditPath, "utf8")) as {
  results: Array<{
    id: string;
    item: string;
    claude: string;
    judgment: string;
    yish_verdict: string;
    notes: string;
  }>;
};

const ins = d.query(
  `INSERT INTO judgments (external_ref, engine_call, human_call, agreement, notes, judged_by, created_at)
   VALUES ($ref, $engine, $human, $agree, $notes, 'yish', $now)`,
);

d.query("DELETE FROM judgments WHERE judged_by = 'yish' AND listing_id IS NULL").run();

const tx = d.transaction(() => {
  for (const r of audit.results) {
    ins.run({
      $ref: r.id,
      $engine: r.claude,
      // agree means the human endorsed the engine's call
      $human: r.yish_verdict || r.claude,
      $agree: r.judgment,
      $notes: r.notes || null,
      $now: now(),
    });
  }
});
tx();

const n = d.query("SELECT COUNT(*) n FROM judgments").get() as { n: number };
const agreement = d
  .query(
    `SELECT agreement, COUNT(*) n FROM judgments GROUP BY agreement ORDER BY n DESC`,
  )
  .all() as Array<{ agreement: string; n: number }>;

console.log(`seeded user_economics: yish`);
console.log(`seeded judgments: ${n.n}`);
for (const a of agreement) console.log(`  ${a.agreement}: ${a.n}`);
