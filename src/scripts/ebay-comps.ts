/**
 * bun run ebay:comps [--query "rtx 3080"] [--skus N] [--headless]
 *
 * With --query: pull sold comps for that one search.
 * With --skus N: pull for the N SKUs that most need comps (default).
 *
 * Requires `bun run ebay:login` once.
 */
import { runEbayWorker, parseSoldRow, saveComps, skusNeedingComps } from "../sources/ebay.ts";
import { db } from "../db/index.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (k: string) => process.argv.includes(`--${k}`);

const single = arg("query");
const targets = single
  ? [{ id: null as number | null, label: single, query: single }]
  : skusNeedingComps(Number(arg("skus")) || 8).map((s) => ({
      id: s.id, label: `${s.brand} ${s.model} (${s.comps} comps)`, query: `${s.brand} ${s.model}`,
    }));

console.log(`pulling sold comps for ${targets.length} target(s):`);
for (const t of targets) console.log(`  · ${t.label}`);
console.log();

const bySku = new Map(targets.map((t) => [t.query, t.id]));
let totalRows = 0, totalSaved = 0;

for await (const ev of runEbayWorker("sold", {
  queries: targets.map((t) => t.query), headless: has("headless"),
})) {
  if (ev.type === "log") console.log(`  ${ev.msg}`);
  else if (ev.type === "error") console.error(`\x1b[31m  ${ev.msg}\x1b[0m`);
  else if (ev.type === "sold") {
    const comps = ev.rows.map((r) => parseSoldRow(r)).filter((c): c is NonNullable<typeof c> => c !== null);
    const saved = saveComps(comps, ev.query, bySku.get(ev.query) ?? null);
    totalRows += ev.rows.length;
    totalSaved += saved;
    const withDate = comps.filter((c) => c.soldAt).length;
    const withCond = comps.filter((c) => c.conditionNorm).length;
    console.log(
      `  \x1b[1m${ev.query}\x1b[0m: ${ev.rows.length} rows -> ${comps.length} parsed -> ` +
      `\x1b[32m${saved} new\x1b[0m  (${withDate} dated, ${withCond} with condition)`,
    );
  }
}

const stats = db().query("SELECT COUNT(*) n, COUNT(sku_id) classified FROM comps WHERE source='ebay'").get() as any;
const covered = db().query(
  "SELECT COUNT(DISTINCT sku_id) n FROM comps WHERE sku_id IS NOT NULL").get() as any;
const skus = db().query("SELECT COUNT(*) n FROM skus").get() as any;

console.log(`\n${totalRows} rows seen · ${totalSaved} new comps stored`);
console.log(`ebay comps in archive: ${stats.n} · SKUs with any comps: ${covered.n}/${skus.n}`);
