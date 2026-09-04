/**
 * Snapshot the archive.
 *
 * WHY THIS IS NOT `copy filtrsoft.db`:
 *
 * SQLite in WAL mode keeps recent writes in a SEPARATE `-wal` file until a
 * checkpoint folds them in. On 2026-08-24 the database was 1.3 MB and the WAL
 * was 4.1 MB — so copying only the .db would have silently lost most of the
 * archive, and the copy would have opened fine and looked healthy.
 *
 * `VACUUM INTO` builds a new, fully self-contained database from a consistent
 * read of the live one. It folds the WAL in, compacts free pages, and is safe
 * to run while the API is serving. One file, no companions, nothing missing.
 *
 * WHAT IS ACTUALLY AT RISK: eBay only exposes ~90 days of sold listings. A comp
 * that falls out of that window is gone permanently — not re-fetchable at any
 * price. The archive is the one asset here that cannot be rebuilt from source
 * code, and `.gitignore` deliberately keeps it out of the repo.
 */
import { Database } from "bun:sqlite";
import { mkdirSync, existsSync, rmSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { db, DB_PATH, stats } from "../db/index.ts";

const KEEP = Number(process.env.FILTRSOFT_BACKUP_KEEP) || 14;
const LOCAL = process.env.FILTRSOFT_BACKUP_DIR ?? join(import.meta.dir, "../../backups");

/**
 * The second copy. A backup on the same disk as the original protects against
 * a bad migration, not against the disk. OneDrive syncs off the machine for
 * free and is already running, so it is the cheapest real offsite there is.
 */
const CLOUD = process.env.FILTRSOFT_BACKUP_CLOUD ?? join(homedir(), "OneDrive", "filtrsoft-backups");

const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

function rotate(dir: string) {
  const files = readdirSync(dir)
    .filter((f) => /^filtrsoft-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) {
    rmSync(join(dir, f));
    console.log(`  pruned ${f}`);
  }
}

const day = new Date().toISOString().slice(0, 10);
const name = `filtrsoft-${day}.db`;

mkdirSync(LOCAL, { recursive: true });
const out = join(LOCAL, name);
// VACUUM INTO refuses to overwrite. Re-running the same day replaces the day.
if (existsSync(out)) rmSync(out);

const before = stats();
console.log(`source  ${DB_PATH}`);
console.log(`        ${before.comps} comps · ${before.listings} listings · ${before.judgments} judgments`);

// Reuse the app's own handle rather than opening a second one. VACUUM INTO
// needs a writable connection, and two writers on one SQLite file is the
// class of mistake that produces a corrupt snapshot.
db().exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);

/**
 * Verify by OPENING it. A backup nobody has read is a guess about a file, and
 * the whole point is to find out it is broken now rather than on the day it is
 * the only copy left.
 */
const check = new Database(out, { readonly: true });
const n = (sql: string) => (check.query(sql).get() as { n: number }).n;
const after = { comps: n("SELECT COUNT(*) n FROM comps"), listings: n("SELECT COUNT(*) n FROM listings"), judgments: n("SELECT COUNT(*) n FROM judgments") };
check.close();

const ok =
  after.comps === before.comps &&
  after.listings === before.listings &&
  after.judgments === before.judgments;

if (!ok) {
  console.error("FAILED — snapshot does not match the source:");
  console.error(`  source ${JSON.stringify({ comps: before.comps, listings: before.listings, judgments: before.judgments })}`);
  console.error(`  copy   ${JSON.stringify(after)}`);
  process.exit(1);
}

console.log(`\nlocal   ${out}  ${mb(statSync(out).size)}  verified`);
rotate(LOCAL);

try {
  mkdirSync(CLOUD, { recursive: true });
  copyFileSync(out, join(CLOUD, name));
  console.log(`cloud   ${join(CLOUD, name)}`);
  rotate(CLOUD);
} catch (e) {
  // Never fail the backup because the second copy failed. The first one is
  // already on disk and verified, which is the part that matters.
  console.error(`cloud   SKIPPED (${(e as Error).message})`);
}

console.log(`\nkeeping the last ${KEEP} daily snapshots in each location.`);
