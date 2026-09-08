import type {Database} from "bun:sqlite";

/** SQL triggers cover scripts, imports and in-place corrections equally. MAX(id)
 * missed relinks, deletions and price fixes. No-op upserts must not churn runs.
 */
export function installPricingRevisions(d:Database) {
  d.exec(`CREATE TABLE IF NOT EXISTS pricing_revision(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO pricing_revision VALUES(1,0);
    CREATE TABLE IF NOT EXISTS scoring_state(listing_id INTEGER PRIMARY KEY,signature TEXT,engine TEXT,
      attempt_signature TEXT,attempts INTEGER NOT NULL DEFAULT 0,retry_at TEXT,last_error TEXT,last_attempt TEXT);`);
  for(const table of ["comps","skus","sku_aliases","retail_prices"]) {
    const columns=(d.query(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(c=>c.name).filter(c=>!["id","created_at"].includes(c));
    const changed=columns.map(c=>`NEW.${c} IS NOT OLD.${c}`).join(" OR ");
    for(const event of ["INSERT","UPDATE","DELETE"]) d.exec(`CREATE TRIGGER IF NOT EXISTS pricing_${table}_${event.toLowerCase()}
      AFTER ${event} ON ${table} ${event==="UPDATE"?`WHEN ${changed}`:""}
      BEGIN UPDATE pricing_revision SET revision=revision+1 WHERE id=1; END;`);
  }
}

/** Hourly expiry invalidation bounds drift as comps/retail age out, without a write. */
export function pricingSignature(d:Database,at=Date.now()):string {
  const r=d.query("SELECT revision FROM pricing_revision WHERE id=1").get() as {revision:number};
  return `${r.revision}|${new Date(at).toISOString().slice(0,13)}`;
}
