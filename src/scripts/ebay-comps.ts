import {startCollection,finishCollection} from "../sources/comp-priority.ts";
/**
 * bun run ebay:comps [--query "rtx 3080"] [--skus N] [--headless]
 *
 * With --query: pull sold comps for that one search.
 * With --skus N: pull for the N SKUs that most need comps (default).
 *
 * Requires `bun run ebay:login` once.
 */
import { runEbayWorker, parseSoldRow, saveComps, skusNeedingComps, compMatchesQuery, queryForSku } from "../sources/ebay.ts";
import { db } from "../db/index.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (k: string) => process.argv.includes(`--${k}`);

/**
 * `--sku "RTX 5070"` targets a NAMED sku and links the comps to it.
 *
 * `--query` alone stores comps with `sku_id = NULL`, so they never reach a
 * valuation — fine for spot-checking a search, useless for filling a gap.
 */
const skuName = arg("sku");
const named = skuName
  ? db().query(
      `SELECT id, brand, model, category FROM skus WHERE LOWER(brand || ' ' || model) LIKE $q OR LOWER(model) LIKE $q LIMIT 1`,
    ).get({ $q: `%${skuName.toLowerCase()}%` }) as any
  : null;
if (skuName && !named) { console.error(`no SKU matching "${skuName}"`); process.exit(1); }

const single = arg("query");
const targets = named
  ? [{ id: named.id, label: `${named.brand} ${named.model}`, query: queryForSku(named), category: named.category }]
  : single
  ? [{ id: null as number | null, label: single, query: single }]
  : skusNeedingComps(Number(arg("skus")) || 8).map((s) => ({
      id: s.id, label: `${s.brand} ${s.model} (${s.comps} comps)`,
      query: s.demandQuery ?? queryForSku(s), category: s.category,
    }));

console.log(`pulling sold comps for ${targets.length} target(s):`);
for (const t of targets) console.log(`  · ${t.label}`);
console.log();

const bySku = new Map(targets.map((t) => [t.query, t.id]));
const catBy = new Map(targets.map((t) => [t.query, (t as { category?: string }).category ?? null]));
let totalRows = 0, totalSaved = 0;
const attempts=new Map(targets.map(t=>[t.query,startCollection(t.id,t.query)]));
const completed=new Set<string>();
let workerFailed=false;

for await (const ev of runEbayWorker("sold", {
  queries: targets.map((t) => t.query), headless: has("headless"),
})) {
  if (ev.type === "log") console.log(`  ${ev.msg}`);
  else if (ev.type === "error") {workerFailed=true;console.error(`\x1b[31m  ${ev.msg}\x1b[0m`);}
  else if (ev.type === "sold") {
    const parsed = ev.rows.map((r) => parseSoldRow(r)).filter((c): c is NonNullable<typeof c> => c !== null);

    // Reject before storing. Comps are kept FOREVER, so a wrong-product row
    // poisons every future valuation of this SKU rather than one run.
    const dropped: string[] = [];
    const rejections:Record<string,number>={};
    const comps = parsed.filter((c) => {
      const m = compMatchesQuery(c.title, ev.query, catBy.get(ev.query) ?? null);
      if (!m.ok){dropped.push(`$${(c.soldPriceCents / 100).toFixed(0)} ${c.title.slice(0, 46)} — ${m.why}`);rejections[m.why]=(rejections[m.why]??0)+1;}
      return m.ok;
    });
    for(const row of ev.rows) if(!parseSoldRow(row)) db().run(
      "INSERT OR IGNORE INTO comp_quarantine(source,query,captured_at,reason,raw_json) VALUES('ebay',?,?,?,?)",
      [ev.query,new Date().toISOString(),"No unambiguous sold price and valid sale date",JSON.stringify(row)]);
    const saved = saveComps(comps, ev.query, bySku.get(ev.query) ?? null);
    const attempt=attempts.get(ev.query);
    rejections['No unambiguous sold price and valid sale date']=ev.rows.length-parsed.length;
    if(attempt!=null)finishCollection(attempt,{fetched:ev.rows.length,parsed:parsed.length,accepted:comps.length,saved,rejections});
    completed.add(ev.query);
    if (dropped.length) {
      console.log(`  [90m${dropped.length} rejected as not this product:[0m`);
      for (const d of dropped.slice(0, 6)) console.log(`    [90m${d}[0m`);
      if (dropped.length > 6) console.log(`    [90m...and ${dropped.length - 6} more[0m`);
    }
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

for(const [query,id] of attempts)if(!completed.has(query))finishCollection(id,{fetched:0,parsed:0,accepted:0,saved:0,error:'Worker did not complete this query'});
const stats = db().query("SELECT COUNT(*) n, COUNT(sku_id) classified FROM comps WHERE source='ebay'").get() as any;
const covered = db().query(
  "SELECT COUNT(DISTINCT sku_id) n FROM comps WHERE sku_id IS NOT NULL").get() as any;
const skus = db().query("SELECT COUNT(*) n FROM skus").get() as any;

console.log(`\n${totalRows} rows seen · ${totalSaved} new comps stored`);
console.log(`ebay comps in archive: ${stats.n} · SKUs with any comps: ${covered.n}/${skus.n}`);
if(workerFailed||completed.size<targets.length)process.exitCode=1;
