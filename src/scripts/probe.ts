/**
 * bun run probe [--source offerup|mercari] [--limit 40] [--dry]
 *
 * Is it still up? The delisting pass for the sources a plain fetch cannot see.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Yish, 2026-08-28: *"a lot of the listings that are shown are sold... make
 * sure every listing that's been sold or deleted or removed isn't on Assyze."*
 * The MacBook Pro 14" M1 Pro at $630 had sold and was still sitting in the
 * feed as a VERIFY.
 *
 * `bun run sweep` handles Craigslist by diffing search results — one request
 * returns 300+ ids, so absence from that set is real evidence. **That does not
 * transfer.** Facebook and OfferUp need a logged-in browser and their search
 * pages never enumerate our whole inventory, so a listing missing from a query
 * proves nothing about whether it exists.
 *
 * So each listing is visited. Expensive, therefore bounded and ordered by how
 * stale our information is.
 *
 * ── THE BIAS IS DELIBERATE ─────────────────────────────────────────────────
 *
 * `probeVerdict` returns `null` for anything ambiguous — a timeout, a login
 * wall, a bot challenge, an empty body — and this script leaves those rows
 * alone. A false "gone" deletes a real deal permanently and silently; a false
 * "still up" costs one wasted tap. Those are not symmetric.
 */
import { runMarketWorker, probeVerdict, type Marketplace } from "../sources/marketplace.ts";
import { PROFILE_DIR as FB_PROFILE, CHROME_PATH } from "../sources/facebook.ts";
import { db, now } from "../db/index.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (k: string) => process.argv.includes(`--${k}`);

const DRY = has("dry");
const LIMIT = Number(arg("limit")) || 40;
const ONLY = arg("source");

/**
 * Oldest information first. `last_seen` is null for a listing never checked, so
 * `COALESCE` sorts those to the front — they are the ones we know least about.
 *
 * Facebook is probed through the marketplace worker's profile only for OfferUp
 * and Mercari; Facebook has its own logged-in profile and is handled by the
 * same worker pointed at it, because the probe only needs a page visit.
 */
function due(source: string, limit: number) {
  return db().query(
    `SELECT id, url FROM listings
      WHERE source = ? AND delisted_at IS NULL AND url IS NOT NULL
      ORDER BY COALESCE(last_seen, captured_at) ASC
      LIMIT ?`,
  ).all(source, limit) as Array<{ id: number; url: string }>;
}

/**
 * Facebook FIRST when probing everything: it is the largest browser-backed
 * source (144 listings vs 107 and 10) and the one Yish found a sold listing in.
 */
const SOURCES = (ONLY ? [ONLY] : ["facebook", "offerup", "mercari"]) as Marketplace[];
let checked = 0, gone = 0, unsure = 0;

for (const source of SOURCES) {
  const rows = due(source, LIMIT);
  if (!rows.length) { console.log(`${source}: nothing due`); continue; }
  console.log(`${source}: probing ${rows.length}`);
  if (DRY) { rows.forEach((r) => console.log(`  would probe ${r.id} ${r.url.slice(0, 70)}`)); continue; }

  const markGone = db().prepare(
    "UPDATE listings SET delisted_at=$t, delist_reason=$r WHERE id=$id AND delisted_at IS NULL",
  );
  const touch = db().prepare("UPDATE listings SET last_seen=$t WHERE id=$id");

  for await (const ev of runMarketWorker(source, {
    chromePath: CHROME_PATH,
    probe: rows.map((r) => ({ id: r.id, url: r.url })),
    queries: [],
  })) {
    if (ev.type === "log") { console.log(`  ${(ev as { msg: string }).msg}`); continue; }
    if (ev.type === "error") { console.error(`  worker: ${(ev as { msg: string }).msg}`); continue; }
    if ((ev as { type: string }).type !== "probe") continue;

    const p = ev as unknown as { id: number; url: string; finalUrl: string; text: string; error?: string };
    checked++;
    const v = probeVerdict(p);
    if (v === null) {
      unsure++;
      console.log(`  ? ${p.id} no opinion${p.error ? ` (${p.error.slice(0, 40)})` : ""}`);
      continue;
    }
    if (v.gone) {
      gone++;
      markGone.run({ $t: now(), $r: "gone", $id: p.id });
      console.log(`  \x1b[33mGONE\x1b[0m ${p.id} — ${v.reason}`);
    } else {
      // Still up: record that we looked, so the next run starts elsewhere.
      touch.run({ $t: now(), $id: p.id });
    }
  }
}

console.log(`\n\x1b[1mprobe\x1b[0m  ${checked} checked · ${gone} delisted · ${unsure} left alone`);
if (unsure) console.log("  \x1b[90m'left alone' means the page proved nothing — a login wall, a timeout, or an empty body.\x1b[0m");
