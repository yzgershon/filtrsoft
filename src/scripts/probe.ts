import {dueProbes,recordProbe} from "../db/probes.ts";
/**
 * bun run probe [--source offerup|mercari] [--limit 40] [--dry]
 *
 * Is it still up? The delisting pass for the sources a plain fetch cannot see.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Yish, 2026-08-28: *"a lot of the listings that are shown are sold... make
 * sure every listing that's been sold or deleted or removed isn't on Filtrsoft."*
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
 * ⚠ WHAT HE CAN SEE IS PROBED FIRST. STALENESS ONLY BREAKS THE TIE.
 *
 * This was ordered purely by `COALESCE(last_seen, captured_at)` — oldest
 * information first — which is a defensible rule and the wrong one. It spends
 * a bounded, expensive budget on whichever rows happen to be dustiest, and
 * measured on 2026-09-04 the result was that **all seven Facebook VERIFY
 * listings had gone unchecked for over two days** while unpriceable monitors
 * nobody will ever open were probed instead.
 *
 * The cost of a stale row is not uniform. A dead listing at the bottom of
 * "can't tell" costs nothing; a sold BUY at the top of the feed is the one
 * Yish drives to. So: BUY, then VERIFY, then everything else, and only within
 * a tier does the oldest information win.
 *
 * Facebook is probed through the marketplace worker's profile only for OfferUp
 * and Mercari; Facebook has its own logged-in profile and is handled by the
 * same worker pointed at it, because the probe only needs a page visit.
 */
const due=dueProbes;

/**
 * Facebook FIRST when probing everything: it is the largest browser-backed
 * source (144 listings vs 107 and 10) and the one Yish found a sold listing in.
 */
const SOURCES = (ONLY ? [ONLY] : ["facebook", "offerup", "mercari"]) as Marketplace[];
let checked = 0, gone = 0, unsure = 0, failedWrites = 0, workerErrors = 0;

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
    if (ev.type === "error") { workerErrors++; console.error(`  worker: ${(ev as { msg: string }).msg}`); continue; }
    if ((ev as { type: string }).type !== "probe") continue;

    const p = ev as unknown as { id: number; url: string; finalUrl: string; text: string; error?: string };
    checked++;
    const v = probeVerdict(p);
    recordProbe(p.id,v?(v.gone?"gone":"alive"):"unknown");
    if (v === null) {
      unsure++;
      console.log(`  ? ${p.id} no opinion${p.error ? ` (${p.error.slice(0, 40)})` : ""}`);
      continue;
    }
    /**
     * ⚠ ONE FAILED WRITE MUST NOT END THE RUN.
     *
     * A 120-listing pass died at about forty on 2026-09-04 with
     * `SQLITE_BUSY: database is locked` — a comps backfill was writing at the
     * same moment — and threw away the remaining eighty after having already
     * retired thirteen sold listings. `busy_timeout` (see `db/index.ts`) makes
     * that collision wait rather than throw, but a probe is minutes of browser
     * work per run and should not be one unlucky write away from losing all of
     * it. Same rule as the eBay worker's navigation retry.
     */
    try {
      if (v.gone) {
        gone++;
        markGone.run({ $t: now(), $r: "gone", $id: p.id });
        console.log(`  \x1b[33mGONE\x1b[0m ${p.id} — ${v.reason}`);
      } else {
        // Still up: record that we looked, so the next run starts elsewhere.
        touch.run({ $t: now(), $id: p.id });
      }
    } catch (e) {
      failedWrites++;
      console.error(`  \x1b[31mwrite failed\x1b[0m ${p.id} — ${(e as Error).message.slice(0, 60)}`);
    }
  }
}

console.log(`
[1mprobe[0m  ${checked} checked · ${gone} delisted · ${unsure} left alone${failedWrites ? ` · [31m${failedWrites} writes failed[0m` : ""}`);
if (unsure) console.log("  \x1b[90m'left alone' means the page proved nothing — a login wall, a timeout, or an empty body.\x1b[0m");

if(workerErrors || failedWrites || (checked>0 && unsure===checked)) process.exitCode=1;
