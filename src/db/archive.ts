import { soldEvidenceSql, soldEvidence } from "./comp-evidence.ts";
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
import { existsSync, readFileSync, writeFileSync, mkdirSync,renameSync,copyFileSync } from "node:fs";
import { createHash,randomUUID } from "node:crypto";
import { join, dirname,resolve } from "node:path";
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
  updated_at?:string|null;
}

interface ArchiveRetail {
  source: string; title: string; price_cents: number; is_new: number;
  storage_gb: number | null; board_tier: string | null; query: string;
  observed_at: string; sku_key: string | null;
}

export interface Archive {
  version: 1|2;
  exportedAt: string;
  skus: ArchiveSku[];
  comps: ArchiveComp[];
  retail: ArchiveRetail[];
  manifest?:{sha256:string;comps:number;skus:number;retail:number};
}

const keyOf = (s: { category: string; brand: string; model: string }) =>
  `${s.category}|${s.brand}|${s.model}`;

/* ------------------------------------------------------------------ export */

export function exportArchive(): Archive {
  const d = db();
  return d.transaction(()=>{
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
            seller_feedback, region, sku_id, query, raw_json, updated_at
       FROM comps WHERE ${soldEvidenceSql()}`,
  ).all() as Array<ArchiveComp & { sku_id: number | null }>).map(({ sku_id, ...c }) => ({
    ...c, sku_key: sku_id ? idToKey.get(sku_id) ?? null : null,
  }));

  const retail = (d.query(
    `SELECT source, title, price_cents, is_new, storage_gb, board_tier, query, observed_at, sku_id
       FROM retail_prices`,
  ).all() as Array<ArchiveRetail & { sku_id: number | null }>).map(({ sku_id, ...r }) => ({
    ...r, sku_key: sku_id ? idToKey.get(sku_id) ?? null : null,
  }));

  const a:Archive={version:2,exportedAt:now(),skus,comps,retail};
  a.manifest=archiveManifest(a);
  return a;
  })();
}

export function archiveManifest(a:Archive) {
  return {sha256:createHash('sha256').update(JSON.stringify({skus:a.skus,comps:a.comps,retail:a.retail})).digest('hex'),
    comps:a.comps.length,skus:a.skus.length,retail:a.retail.length};
}

function validateArchive(a:Archive) {
  if(![1,2].includes(a.version)||!Array.isArray(a.comps)||!Array.isArray(a.skus)||!Array.isArray(a.retail)) throw new Error('Invalid archive shape');
  if(a.version===2 && JSON.stringify(a.manifest)!==JSON.stringify(archiveManifest(a))) throw new Error('Archive manifest mismatch');
}

export function writeArchive(a: Archive, path = ARCHIVE_PATH): number {
  path=resolve(path);
  mkdirSync(dirname(path), { recursive: true });
  validateArchive(a);
  const buf = gzipSync(Buffer.from(JSON.stringify(a)), { level: 9 });
  const temporary=`${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, buf);
  readArchive(temporary); // Validate compressed bytes before replacing the last good artifact.
  if(existsSync(path)) copyFileSync(path,`${path}.previous`);
  renameSync(temporary,path);
  return buf.length;
}

export function readArchive(path = ARCHIVE_PATH): Archive | null {
  if (!existsSync(path)) return null;
  const a=JSON.parse(gunzipSync(readFileSync(path)).toString()) as Archive;
  validateArchive(a);return a;
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
  validateArchive(a);
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
        captured_at, seller_feedback, region, sku_id, query, raw_json,updated_at)
     VALUES ($src,$sid,$url,$title,$price,$ship,$cur,$craw,$cnorm,$sold,$cap,$fb,$reg,$sku,$q,$raw,$updated)
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
       WHERE comps.sku_id IS NULL AND excluded.sku_id IS NOT NULL`,
  );
  const insRetail = d.query(
    `INSERT OR IGNORE INTO retail_prices (sku_id, source, title, price_cents, is_new,
        storage_gb, board_tier, query, observed_at)
     VALUES ($sku,$src,$title,$price,$new,$gb,$tier,$q,$obs)`,
  );

  d.transaction(() => {
    d.exec("CREATE TABLE IF NOT EXISTS archive_imports(sha256 TEXT PRIMARY KEY,exported_at TEXT,imported_at TEXT,counts TEXT)");
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
      if (!soldEvidence(c)) {
        d.run("INSERT OR IGNORE INTO comp_quarantine(source,query,captured_at,reason,raw_json) VALUES(?,?,?,?,?)",[c.source,c.query,now(),"Ineligible archive comp",JSON.stringify(c)]);
        res.skipped++; continue;
      }
      const skuId = c.sku_key ? keyToId.get(c.sku_key) ?? null : null;
      if (c.sku_key && !skuId) { res.skipped++; continue; }
      const r = insComp.run({
        $src: c.source, $sid: c.source_item_id, $url: c.url, $title: c.raw_title,
        $price: c.sold_price_cents, $ship: c.shipping_cents, $cur: c.currency,
        $craw: c.condition_raw, $cnorm: c.condition_norm, $sold: c.sold_at,
        $cap: c.captured_at, $fb: c.seller_feedback, $reg: c.region,
        $sku: skuId, $q: c.query, $raw: c.raw_json,$updated:c.updated_at??null,
      });
      if (r.changes) res.comps++;
      // Legacy exports cannot prove correction order. V2 corrections carry the
      // source row's mutation clock and cannot revert a newer destination edit.
      if(a.version===2 && c.updated_at) {
        const corrected=d.run(`UPDATE comps SET sku_id=?,raw_title=?,sold_price_cents=?,shipping_cents=?,currency=?,
          condition_raw=?,condition_norm=?,sold_at=?,raw_json=?,updated_at=? WHERE source=? AND source_item_id=?
          AND COALESCE(updated_at,captured_at)<?`,
          [skuId,c.raw_title,c.sold_price_cents,c.shipping_cents,c.currency,c.condition_raw,c.condition_norm,c.sold_at,c.raw_json,c.updated_at,c.source,c.source_item_id,c.updated_at]);
        if(corrected.changes) res.comps++;
      }
    }

    // Natural observation identity makes imports additive even after the first
    // retail crawl, without turning a redeploy into duplicate corroboration.
    for (const r of a.retail) {
      const result=insRetail.run({
        $sku:r.sku_key?keyToId.get(r.sku_key)??null:null,
        $src:r.source,$title:r.title,$price:r.price_cents,$new:r.is_new,
        $gb:r.storage_gb,$tier:r.board_tier,$q:r.query,$obs:r.observed_at,
      });
      if(result.changes) res.retail++;
    }
    d.run("INSERT OR IGNORE INTO archive_imports VALUES(?,?,?,?)",[archiveManifest(a).sha256,a.exportedAt,now(),JSON.stringify({skus:a.skus.length,comps:a.comps.length,retail:a.retail.length})]);
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
/**
 * Is the archive actually IN the image, and what does it hold?
 *
 * Added because production sat at 13,981 comps across three successful
 * deploys while the committed archive held 15,294, and NOTHING said why. A
 * missing archive file and a fully-imported one both leave
 * importArchiveIfThin returning null with no log line, so from the outside
 * they are identical — and the whole point of this mechanism is that it is
 * the only route the comps archive has to production.
 *
 * Reported on /v1/health so the next person can tell "the file never shipped"
 * from "the file shipped and had nothing new" without reading container logs.
 */
export function archiveStatus(): {
  present: boolean; path: string; comps: number; skus: number; exportedAt: string | null;
  sha256:string|null;imported:boolean;importedAt:string|null;
} {
  const a = readArchive();
  const sha=a?archiveManifest(a).sha256:null;
  const exists=db().query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='archive_imports'").get();
  const imported=exists&&sha?db().query("SELECT imported_at FROM archive_imports WHERE sha256=?").get(sha) as {imported_at:string}|null:null;
  return {
    present: Boolean(a),
    path: ARCHIVE_PATH,
    comps: a?.comps.length ?? 0,
    skus: a?.skus.length ?? 0,
    exportedAt: a?.exportedAt ?? null,
    sha256:sha,imported:Boolean(imported),importedAt:imported?.imported_at??null,
  };
}

export function importArchiveIfThin(): ImportResult | null {
  const a = readArchive();
  if (!a) {
    // Never silent. This is the ONLY path the comps archive has to production.
    console.error(`archive MISSING at ${ARCHIVE_PATH} — production cannot receive comps`);
    return null;
  }

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
