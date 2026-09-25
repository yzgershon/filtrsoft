/**
 * Seeds the database with what we already know:
 *   1. Yish's economics profile (CALIBRATION-2026-08-23.md, finding 1)
 *   2. His 69 audit judgments — the eval set the engine gets scored against
 *
 * Idempotent. Safe to re-run.
 */
import { db, now } from "../db/index.ts";
import { CATALOG } from "../reference/catalog.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function seed() {
const d = db();

// --- 0. Catalog ---------------------------------------------------------
const insSku = d.query(
  `INSERT INTO skus (category, brand, model, attributes, liquidity, created_at)
   VALUES ($cat,$brand,$model,$attrs,$liq,$now) RETURNING id`,
);
const insAlias = d.query(
  `INSERT INTO sku_aliases (sku_id, alias, source, confidence, created_at)
   VALUES ($sku,$alias,'seed','high',$now) ON CONFLICT(alias) DO NOTHING`,
);
const existing = d.query("SELECT id FROM skus WHERE brand=$b AND model=$m");

let added = 0;
d.transaction(() => {
  for (const s of CATALOG) {
    if (existing.get({ $b: s.brand, $m: s.model })) continue;
    // bun:sqlite types named parameters as a positional union; the object form
    // is supported at runtime and is what every other query here uses.
    const row = insSku.get({
      $cat: s.category, $brand: s.brand, $model: s.model,
      $attrs: JSON.stringify(s.attributes ?? {}), $liq: s.liquidity ?? null, $now: now(),
    } as never) as { id: number };
    added++;
    for (const a of [s.model.toLowerCase(), ...(s.aliases ?? [])]) {
      insAlias.run({ $sku: row.id, $alias: a.toLowerCase(), $now: now() });
    }
  }
})();
const dead = d.query("SELECT COUNT(*) n FROM skus WHERE liquidity='dead'").get() as { n: number };
console.log(`seeded skus: +${added} (${dead.n} marked dead)`);

// --- 1. Yish's economics -----------------------------------------------
//
// ⚠ RESTATED 2026-09-24: "$75" (was "$100 profit with a 20 min drive", 2026-08-31).
// Same 20-minute crossover: $75 flat, then $60/hr.
//
// The old pair ($100 local, $150 at 30 min) resolved to ~$125/hr, and with 15
// minutes of meeting and 20 of relisting that made the CLOCK the binding term
// at every distance — the $100 floor was never reachable. A 15-minute drive
// asked for $135.42 and a 20-minute one asked for MORE, $156.25, which is the
// opposite of what he wanted when he asked for a longer drive and a lower bar.
//
// $80/hr puts the crossover exactly at 20 minutes: $100 flat up to there, and
// the clock only adds beyond it. It is also his revealed preference — he drove
// 20 minutes to Boston for $74 on an i9-12900K the engine had called FAIR.
d.query(
  `INSERT INTO user_economics (label, home_location, min_absolute_profit_cents,
     effective_hourly_floor_cents, max_drive_minutes, transaction_minutes,
     relist_minutes, prefers_channel, updated_at)
   VALUES ('yish', 'Newton, MA', 7500, 6000, NULL, 15, 20, 'facebook', $now)
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
}

// Run when invoked directly: `bun run seed`
if (import.meta.main) seed();
