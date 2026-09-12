import type {Database} from 'bun:sqlite';

/** Additive migrations only. Unknown historic costs remain NULL, not $0. */
export function installWorkspace(d:Database) {
  const columns=new Set((d.query('PRAGMA table_info(outcomes)').all() as {name:string}[]).map(c=>c.name));
  for(const [name,type] of Object.entries({other_costs_cents:'INTEGER',transaction_revision:'INTEGER NOT NULL DEFAULT 0',transaction_updated_at:'TEXT'})) {
    if(!columns.has(name))d.exec(`ALTER TABLE outcomes ADD COLUMN ${name} ${type}`);
  }
  d.exec(`CREATE TABLE IF NOT EXISTS outcome_revisions (
    id INTEGER PRIMARY KEY, outcome_id INTEGER NOT NULL REFERENCES outcomes(id),
    user_id INTEGER NOT NULL REFERENCES users(id), revision INTEGER NOT NULL,
    before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(outcome_id,revision));
    CREATE TABLE IF NOT EXISTS listing_inspections (
    user_id INTEGER NOT NULL REFERENCES users(id), listing_id INTEGER NOT NULL REFERENCES listings(id),
    revision INTEGER NOT NULL, notes TEXT NOT NULL, answers_json TEXT NOT NULL,
    updated_at TEXT NOT NULL, PRIMARY KEY(user_id,listing_id));
    CREATE TABLE IF NOT EXISTS inspection_revisions (
    id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),listing_id INTEGER NOT NULL REFERENCES listings(id),
    revision INTEGER NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,
    UNIQUE(user_id,listing_id,revision));`);
}
