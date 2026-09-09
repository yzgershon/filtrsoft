import { z } from "zod";
import type { Database } from "bun:sqlite";
import { applyQuality, matchesSearch } from "./query.ts";
import { detectCategory } from "../signals/index.ts";

const money = z.number().int().min(0).max(100_000_000).nullable().optional();
export const searchInput = z.object({
  label: z.string().trim().max(100).optional(), query: z.string().trim().max(80).nullable().optional(),
  category: z.enum(["gpu", "laptop", "phone", "prebuilt", "tablet", "component"]).nullable().optional(),
  source: z.enum(["craigslist", "facebook", "offerup", "mercari"]).nullable().optional(),
  quality: z.enum(["review", "all", "ready", "verify", "risky", "browse"]).optional(),
  sort: z.enum(["best", "newest", "drop", "price"]).optional(),
  maxPriceCents: z.number().int().positive().max(100_000_000).nullable().optional(), minProfitCents: money,
  calls: z.array(z.enum(["BUY", "VERIFY", "FAIR", "PASS", "RISK", "INSUFFICIENT_DATA", "OUT_OF_SCOPE"])).max(7).optional(),
  subId: z.number().int().positive().nullable().optional(),
}).strict();

/** Criteria belong to the account; an expired delivery endpoint must not erase
 * them. Stable IDs preserve delivery leases, retries and sent deduplication. */
export function installSavedSearches(d: Database) {
  d.transaction(() => {
    const columns = d.query("PRAGMA table_info(saved_searches)").all() as { name: string }[];
    if (columns.some(c => c.name === "criteria_version")) return;
    d.exec(`CREATE TABLE saved_searches_owned (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id),
      sub_id INTEGER REFERENCES push_subs(id) ON DELETE SET NULL,
      label TEXT NOT NULL, query TEXT, category TEXT, source TEXT, quality TEXT,
      sort TEXT NOT NULL DEFAULT 'best', max_price_cents INTEGER, min_profit_cents INTEGER,
      calls TEXT, created_at TEXT NOT NULL, standing INTEGER NOT NULL DEFAULT 0,
      notify_since TEXT, criteria_version INTEGER NOT NULL DEFAULT 2
    );
    INSERT INTO saved_searches_owned(id,user_id,sub_id,label,query,max_price_cents,min_profit_cents,calls,created_at,standing,notify_since,criteria_version)
      SELECT s.id,p.user_id,s.sub_id,s.label,s.query,s.max_price_cents,s.min_profit_cents,s.calls,s.created_at,s.standing,
        CASE WHEN s.standing=1 THEN s.created_at ELSE NULL END,CASE WHEN s.standing=1 THEN 2 ELSE 1 END
      FROM saved_searches s LEFT JOIN push_subs p ON p.id=s.sub_id;
    DROP TABLE saved_searches;
    ALTER TABLE saved_searches_owned RENAME TO saved_searches;
    CREATE INDEX saved_search_owner ON saved_searches(user_id,standing,id);`);
    // Deleted searches leave delivery history. Never recycle one of those IDs
    // into a new query or its old acknowledgements would suppress new alerts.
    let high=(d.query("SELECT COALESCE(MAX(id),0) n FROM saved_searches").get() as {n:number}).n;
    for(const table of ["alert_sent", "alert_deliveries"]){
      if(d.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
        high=Math.max(high,(d.query(`SELECT COALESCE(MAX(search_id),0) n FROM ${table}`).get() as {n:number}).n);
    }
    if(!d.run("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='saved_searches'",[high]).changes)
      d.run("INSERT INTO sqlite_sequence(name,seq) VALUES('saved_searches',?)",[high]);
  })();
}

export interface Criteria {
  query: string | null; max_price_cents: number | null; min_profit_cents: number | null; calls: string | null;
  category?: string | null; source?: string | null; quality?: string | null;
}
export function matchesCriteria(s: Criteria, l: { title: string; price: number | null; call: string; net: number | null; source?: string; reviewed?: boolean }): boolean {
  if (s.quality && !applyQuality([{ call:l.call, askingPriceCents:l.price, reviewed:l.reviewed }], s.quality).length) return false;
  if (s.calls && !s.calls.split(",").filter(Boolean).includes(l.call)) return false;
  if (s.category && detectCategory(l.title, "") !== s.category) return false;
  if (s.source && s.source !== l.source) return false;
  if (s.max_price_cents != null && (l.price == null || l.price > s.max_price_cents)) return false;
  if (s.min_profit_cents != null && (l.net == null || l.net < s.min_profit_cents)) return false;
  return matchesSearch(l.title, s.query ?? "");
}

export function searchView(row: any) {
  // Old names may mention categories/sources that were never saved. Preserve
  // the old bytes, show the actual criteria, and ask for review before delivery.
  const needsReview = !row.standing && (row.criteria_version < 2 || !row.quality);
  const params = new URLSearchParams();
  if (row.quality) params.set("quality", row.quality);
  if (row.query) params.set("q", row.query);
  if (row.category) params.set("category", row.category);
  if (row.source) params.set("source", row.source);
  if (row.max_price_cents != null) params.set("maxPrice", String(row.max_price_cents));
  if (row.sort !== "best") params.set("sort", row.sort);
  const canOpen = !needsReview && !row.standing && row.min_profit_cents == null && !row.calls;
  return { ...row, needsReview, notifications: !!row.sub_id && !!row.notify_since && !needsReview,
    openUrl: canOpen ? `/?${params}` : null };
}
