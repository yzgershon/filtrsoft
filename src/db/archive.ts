/**
 * Shipping the comps archive to production.
 *
 * **THE PROBLEM THIS SOLVES.** The deployed app reported `comps: 0, skus: 62`
 * against 6,247 and 221 locally, so **every verdict in production was
 * INSUFFICIENT_DATA by construction.** The engine was live, healthy, serving
 * the frontend, and structurally unable to price anything. The boot seed only
 * fires when `skus == 0` and only plants the hardcoded catalog — it never
 * carried a single sold comp, and nothing anywhere said so.
 *
 * **WHY A COMMITTED FILE RATHER THAN A DATA SYNC.** The comps archive is the
 * one asset here that compounds and cannot be rebuilt — eBay exposes ~90 days,
 * so anything not captured is gone permanently. Every other route to the
 * production volume needs a credential: a CLI login, an SSH session, an
 * authenticated upload endpoint with a shared secret. This route needs none.
 * It travels the path that is already authorised and already works — commit,
 * push, Railway builds, the container imports on boot.
 *
 * **IT MUST BE IDEMPOTENT AND IT IS.** `comps` carries `UNIQUE(source,
 * source_item_id)` and `sku_aliases.alias` is unique, so every insert here is
 * `ON CONFLICT DO NOTHING`. Re-importing the same archive on every redeploy is
 * a no-op, and a NEWER archive merges into a volume that already has rows
 * rather than replacing it. Nothing is ever deleted by an import — a
 * production row we did not ship is still a row somebody paid for.
 *
 * **SKU IDS ARE REMAPPED, NOT TRUSTED.** Local `skus.id` and production
 * `skus.id` are independent autoincrements seeded in different orders, so
 * carrying `comps.sku_id` across verbatim would file 6,000 comps against the
 * wrong products — silently, and with confident wrong medians as the only
 * symptom. Comps reference their SKU by `(category, brand, model)` in the
 * export and are re-resolved against the destination on import.
 */
import { gunzipSync, gzipSync } from "node:zlib";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { db, now } from "./index.ts";

export const ARCHIVE_PATH = join(import.meta.dir, "../../data/archive.json.gz");

interface ArchiveSku {
  category: string; brand: string; model: string;
  attributes: string; liquidity: string | null;
  aliases: Array<{ alias: string; source: string | null; confidence: string | null }>;
}

interface ArchiveComp {
  source: string; source_item_id: string; url: string | null; raw_title: string;
  sold_price_cents: number; shipping_cents: number | null; currency: string;
  condition_raw: string | null; condition_norm: string | null;
  sold_at: string | null; captured_at: string; seller_feedback: number | null;
  region: string | null; query: string | null; raw_json: string;
  /** `category|brand|model` of the SKU, or null. NEVER a raw id — see above. */
  sku_key: string | null;
}

interface ArchiveRetail {
  source: string; title: string; price_cents: number; is_new: number;
  storage_gb: number | null; board_tier: string | null; query: string;
  observed_at: string; sku_key: string | null;
}

export interface Archive {
  version: 1;
  exportedAt: string;
  skus: ArchiveSku[];
  comps: ArchiveComp[];
  retail: ArchiveRetail[];
}

const keyOf = (s: { category: string; brand: string; model: string }) =>
  `${s.category}|${s.brand}|${s.model}`;

/* ------------------------------------------------------------------ export */

export function exportArchive(): Archive {
  const d = db();
  const skuRows = d.query(
    `SELECT id, category, brand, model, attributes, liquidity FROM skus`,
  ).all() as Array<{ id: number; category: string; brand: string; model: string; attributes: string; liquidity: string | null }>;

  const aliases = d.query(
    `SELECT sku_id, alias, source, confidence FROM sku_aliases`,
  ).all() as Array<{ sku_id: number; alias: string; source: string | null; confidence: string | null }>;
  const aliasBySku = new Map<number, ArchiveSku["aliases"]>();
  for (const a of aliases) {
    if (!aliasBySku.has(a.sku_id)) aliasBySku.set(a.sku_id, []);
    aliasBySku.get(a.sku_id)!.push({ alias: a.alias, source: a.source, confidence: a.confidence });
  }

  const idToKey = new Map<number, string>();
  const skus: ArchiveSku[] = skuRows.map((s) => {
    idToKey.set(s.id, keyOf(s));
    return {
      category: s.category, brand: s.brand, model: s.model,
      attributes: s.attributes, liquidity: s.liquidity,
      aliases: aliasBySku.get(s.id) ?? [],
    };
  });

  const comps = (d.query(
    `SELECT source, source_item_id, url, raw_title, sold_price_cents, shipping_cents,
            currency, condition_raw, condition_norm, sold_at, captured_at,
            seller_feedback, region, sku_id, query, raw_json
       FROM comps`,
  ).all() as Array<ArchiveComp & { sku_id: number | null }>).map(({ sku_id, ...c }) => ({
    ...c, sku_key: sku_id ? idToKey.get(sku_id) ?? null : null,
  }));

  const retail = (d.query(
    `SELECT source, title, price_cents, is_new, storage_gb, board_tier, query, observed_at, sku_id
       FROM retail_prices`,
  ).all() as Array<ArchiveRetail & { sku_id: number | null }>).map(({ sku_id, ...r }) => ({
    ...r, sku_key: sku_id ? idToKey.get(sku_id) ?? null : null,
  }));

  return { version: 1, exportedAt: now(), skus, comps, retail };
}

export function writeArchive(a: Archive, path = ARCHIVE_PATH): number {
  mkdirSync(dirname(path), { recursive: true });
  const buf = gzipSync(Buffer.from(JSON.stringify(a)), { level: 9 });
  writeFileSync(path, buf);
  return buf.length;
}

export function readArchive(path = ARCHIVE_PATH): Archive | null {
  if (!existsSync(path)) return null;
  return JSON.parse(gunzipSync(readFileSync(path)).toString()) as Archive;
}

/* ------------------------------------------------------------------ import */

export interface ImportResult {
  skus: number; aliases: number; comps: number; retail: number; skipped: number;
}

/**
 * Merge an archive into the current database. Never deletes, never overwrites.
 *
 * Wrapped in ONE transaction: 6,000 individual inserts against a network-backed
 * volume take minutes unbatched, and a half-finished import on a container that
 * gets restarted mid-boot would leave the archive in an unknown state.
 */
export function importArchive(a: Archive): ImportResult {
  const d = db();
  const res: ImportResult = { skus: 0, aliases: 0, comps: 0, retail: 0, skipped: 0 };

  const insSku = d.query(
    `INSERT INTO skus (category, brand, model, attributes, liquidity, created_at)
     VALUES ($cat,$brand,$model,$attrs,$liq,$now)`,
  );
  const findSku = d.query(
    `SELECT id FROM skus WHERE category=$cat AND brand=$brand AND model=$model`,
  );
  const insAlias = d.query(
    `INSERT INTO sku_aliases (sku_id, alias, source, confidence, created_at)
     VALUES ($sku,$alias,$src,$conf,$now) ON CONFLICT(alias) DO NOTHING`,
  );
  const insComp = d.query(
    `INSERT INTO comps (source, source_item_id, url, raw_title, sold_price_cents,
        shipping_cents, currency, condition_raw, condition_norm, sold_at,
        captured_at, seller_feedback, region, sku_id, query, raw_json)
     VALUES ($src,$sid,$url,$title,$price,$ship,$cur,$craw,$cnorm,$sold,$cap,$fb,$reg,$sku,$q,$raw)
     /*
      * Same adoption rule as insertComp, for the same reason.
      *
      * DO NOTHING meant an archive import could never REPAIR a comp that had
      * landed on production with a null sku_id — the row already exists, so
      * the corrected attribution in the archive was discarded every time.
      * Only ever fills a null; an attached comp keeps its SKU, so an import
      * can never re-file a sold price onto a different product.
      */
     ON CONFLICT(source, source_item_id) DO UPDATE SET
       sku_id = excluded.sku_id
       WHERE comps.sku_id IS NULL`,
  );
  const insRetail = d.query(
    `INSERT INTO retail_prices (sku_id, source, title, price_cents, is_new,
        storage_gb, board_tier, query, observed_at)
     VALUES ($sku,$src,$title,$price,$new,$gb,$tier,$q,$obs)`,
  );

  d.transaction(() => {
    // 1. SKUs first — comps resolve against them by key, not by id.
    const keyToId = new Map<string, number>();
    for (const s of a.skus) {
      const p = { $cat: s.category, $brand: s.brand, $model: s.model };
      let row = findSku.get(p) as { id: number } | null;
      if (!row) {
        insSku.run({ ...p, $attrs: s.attributes, $liq: s.liquidity, $now: now() });
        row = findSku.get(p) as { id: number };
        res.skus++;
      }
      keyToId.set(keyOf(s), row.id);
      for (const al of s.aliases) {
        const r = insAlias.run({
          $sku: row.id, $alias: al.alias, $src: al.source, $conf: al.confidence, $now: now(),
        });
        if (r.changes) res.aliases++;
      }
    }

    for (const c of a.comps) {
      const skuId = c.sku_key ? keyToId.get(c.sku_key) ?? null : null;
      if (c.sku_key && !skuId) { res.skipped++; continue; }
      const r = insComp.run({
        $src: c.source, $sid: c.source_item_id, $url: c.url, $title: c.raw_title,
        $price: c.sold_price_cents, $ship: c.shipping_cents, $cur: c.currency,
        $craw: c.condition_raw, $cnorm: c.condition_norm, $sold: c.sold_at,
        $cap: c.captured_at, $fb: c.seller_feedback, $reg: c.region,
        $sku: skuId, $q: c.query, $raw: c.raw_json,
      });
      if (r.changes) res.comps++;
    }

    /**
     * Retail has no natural key, so it is imported ONLY into an empty table.
     *
     * Unlike comps, these are cheap to re-pull and go stale in weeks, so
     * duplicating them on every redeploy would grow the table without adding
     * information — and `latestRetail` reads the newest row per source, which
     * duplicates would keep churning for no reason.
     */
    const have = (d.query("SELECT COUNT(*) n FROM retail_prices").get() as { n: number }).n;
    if (have === 0) {
      for (const r of a.retail) {
        insRetail.run({
          $sku: r.sku_key ? keyToId.get(r.sku_key) ?? null : null,
          $src: r.source, $title: r.title, $price: r.price_cents, $new: r.is_new,
          $gb: r.storage_gb, $tier: r.board_tier, $q: r.query, $obs: r.observed_at,
        });
        res.retail++;
      }
    }
  })();

  return res;
}

/**
 * Boot hook: import the shipped archive when this database is missing comps.
 *
 * The trigger is the COMP COUNT, not "is the database empty". Production had
 * 62 SKUs from the catalog seed and zero comps, so an empty-database check
 * passed happily while the engine could not price a single listing. The thing
 * worth checking is the thing that was missing.
 */
export function importArchiveIfThin(): ImportResult | null {
  const a = readArchive();
  if (!a) return null;

  /**
   * ALWAYS import. The old gate was `comps >= archive.comps * 0.9`, and it
   * silently blocked everything that was not a comp.
   *
   * `MacBook Air M5` was added to the catalog, exported, deployed — and
   * production kept answering *"Couldn't identify the exact model"*, because
   * its comp count already matched the archive so the import never ran. SKUs,
   * aliases and retail quotes all rode on a comp-count check that had nothing
   * to do with them.
   *
   * Running unconditionally is safe and cheap: every insert is `ON CONFLICT DO
   * NOTHING` inside one transaction, a full 6,247-comp import measured 107ms
   * on a cold database, and a re-import adds 0 rows. Gating an idempotent
   * operation bought nothing and cost a wrong answer on the live site.
   */
  const r = importArchive(a);
  const changed = r.skus + r.aliases + r.comps + r.retail > 0;
  return changed ? r : null;
}
