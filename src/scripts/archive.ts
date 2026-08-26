/**
 * bun run archive          export the comps archive to data/archive.json.gz
 * bun run archive --import merge a shipped archive into THIS database
 * bun run archive --check  show what the committed archive holds
 *
 * The export is COMMITTED. That is how the archive reaches the production
 * volume — see `src/db/archive.ts` for why a committed file beats every route
 * that needs a credential.
 */
import { statSync } from "node:fs";
import {
  exportArchive, writeArchive, readArchive, importArchive,
  ARCHIVE_PATH,
} from "../db/archive.ts";
import { db } from "../db/index.ts";

const has = (k: string) => process.argv.includes(`--${k}`);

if (has("check")) {
  const a = readArchive();
  if (!a) { console.log("no archive committed at data/archive.json.gz"); process.exit(0); }
  const size = statSync(ARCHIVE_PATH).size;
  console.log(`archive v${a.version} exported ${a.exportedAt.slice(0, 19)}`);
  console.log(`  ${a.skus.length} skus · ${a.skus.reduce((n, s) => n + s.aliases.length, 0)} aliases`);
  console.log(`  ${a.comps.length} comps · ${a.retail.length} retail quotes`);
  console.log(`  ${(size / 1024 / 1024).toFixed(2)} MB on disk`);
  const unlinked = a.comps.filter((c) => !c.sku_key).length;
  console.log(`  ${a.comps.length - unlinked} comps linked to a SKU, ${unlinked} unlinked`);
  process.exit(0);
}

if (has("import")) {
  const a = readArchive();
  if (!a) { console.error("no archive at data/archive.json.gz"); process.exit(1); }
  const before = (db().query("SELECT COUNT(*) n FROM comps").get() as { n: number }).n;
  const r = importArchive(a);
  const after = (db().query("SELECT COUNT(*) n FROM comps").get() as { n: number }).n;
  console.log(`imported: +${r.skus} skus · +${r.aliases} aliases · +${r.comps} comps · +${r.retail} retail`);
  if (r.skipped) console.log(`  ${r.skipped} comps skipped (their SKU was not in the archive)`);
  console.log(`comps ${before} -> ${after}`);
  process.exit(0);
}

const a = exportArchive();
const bytes = writeArchive(a);
console.log(`exported ${a.comps.length} comps · ${a.skus.length} skus · ${a.retail.length} retail quotes`);
console.log(`  -> data/archive.json.gz  (${(bytes / 1024 / 1024).toFixed(2)} MB gzipped)`);
console.log(`\nCommit it. That is how it reaches the production volume.`);
