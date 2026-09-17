import { createHash, randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import { z } from "zod";
import { rawObject } from "../db/facts.ts";
import {ensureEnrichment} from '../db/enrichment.ts';
import {ensurePhotoClock} from '../vision/merge.ts';

const timestamp = z.iso.datetime();
const remoteUrl = z.url().refine(s => new URL(s).protocol === "https:");
export const recoveryReceiptSchema=z.object({fingerprint:z.string().regex(/^[a-f0-9]{64}$/),complete:z.boolean(),unchanged:z.number().int().nonnegative(),observedAt:timestamp,durationMs:z.number().nonnegative(),reason:z.string().max(200)});
export const snapshotSchema = z.object({
  source: z.enum(["facebook", "offerup", "mercari", "craigslist"]),
  sourceId: z.string().min(1).max(200), url: remoteUrl, title: z.string().min(1).max(2000),
  description: z.string().max(100_000), askingPriceCents: z.number().int().positive().nullable(),
  location: z.string().max(2000).nullable(), postedAt: timestamp.nullable(),
  sellerRef: z.string().max(2000).nullable(), observedAt: timestamp, capturedAt: timestamp,
  detailAt: timestamp.nullable(), retiredAt: timestamp.nullable(), retireReason: z.string().max(200).nullable(),
  raw: z.record(z.string(), z.unknown()),
  photos: z.array(z.object({url: remoteUrl, phash: z.string().regex(/^[a-f0-9]{16}$/i).nullable()})).max(40),
  vision: z.object({model:z.string().max(200),promptVersion:z.string().max(200),
    fingerprint:z.string().regex(/^[a-f0-9]{32}$/),payload:z.string().max(200_000),createdAt:timestamp}).nullable(),
  availability:z.object({observedAt:timestamp,outcome:z.enum(['alive','gone','unknown']),nextAt:timestamp,failures:z.number().int().nonnegative()}).nullable().optional(),
  enrichment:z.object({attemptedAt:timestamp,nextAt:timestamp,failures:z.number().int().nonnegative(),outcome:z.enum(['read','empty','failed','gone']),fingerprint:z.string().regex(/^[a-f0-9]{64}$/).optional()}).nullable().optional(),
  recovery:recoveryReceiptSchema.nullable().optional(),
  photosAt:timestamp.nullable().optional(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export const batchSchema = z.object({version:z.literal(2),clientId:z.uuid(),changes:z.array(z.object({
  sequence:z.number().int().positive(),hash:z.string().regex(/^[a-f0-9]{64}$/),listing:snapshotSchema,
})).min(1).max(300)});
export type SyncBatch = z.infer<typeof batchSchema>;
export type SyncAck = {sequence:number;hash:string;status:"applied"|"stale"|"duplicate"};
export const contentHash = (value:unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function ensureSync(d:Database) {
  d.exec(`CREATE TABLE IF NOT EXISTS sync_identity(id INTEGER PRIMARY KEY CHECK(id=1),client_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_local_state(target TEXT,listing_id INTEGER,hash TEXT NOT NULL,PRIMARY KEY(target,listing_id));
    CREATE TABLE IF NOT EXISTS sync_outbox(sequence INTEGER PRIMARY KEY AUTOINCREMENT,target TEXT NOT NULL,listing_id INTEGER NOT NULL,source TEXT NOT NULL,hash TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS sync_outbox_target ON sync_outbox(target,source,sequence);
    CREATE TABLE IF NOT EXISTS sync_receipts(client_id TEXT,sequence INTEGER,hash TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(client_id,sequence));
    CREATE TABLE IF NOT EXISTS sync_versions(client_id TEXT,listing_id INTEGER,sequence INTEGER NOT NULL,PRIMARY KEY(client_id,listing_id));`);
}

/** Scan facts, not posting dates: old/null-date listings, retirements and later
 * vision reads must converge too. Snapshot+queue insertion is one transaction.
 * Hashes are destination-specific; acknowledging staging cannot drain production.
 */
export function captureChanges(d:Database,target:string,source:string) {
  ensureSync(d);
  ensureEnrichment(d);
  ensurePhotoClock(d);
  return d.transaction(()=>{
    d.run("INSERT OR IGNORE INTO sync_identity VALUES(1,?)",[randomUUID()]);
    const rows=d.query("SELECT * FROM listings WHERE source=? ORDER BY id").all(source) as any[];
    let added=0;
    for(const l of rows) {
      const photos=d.query("SELECT url,phash FROM listing_photos WHERE listing_id=? ORDER BY position").all(l.id);
      const v=d.query("SELECT model,prompt_version,photo_fingerprint,payload,created_at FROM vision_results WHERE listing_id=? ORDER BY id DESC LIMIT 1").get(l.id) as any;
      const availability=d.query('SELECT observed_at observedAt,outcome FROM listing_availability WHERE listing_id=?').get(l.id) as any;
      const enrichment=d.query('SELECT attempted_at attemptedAt,next_attempt_at nextAt,failures,outcome FROM listing_enrichment WHERE listing_id=?').get(l.id) as any;
      const attempt=d.query('SELECT fingerprint FROM listing_recovery_attempts WHERE listing_id=?').get(l.id) as {fingerprint:string}|null;
      if(enrichment&&attempt)enrichment.fingerprint=attempt.fingerprint;
      const recovery=d.query('SELECT payload FROM listing_recovery WHERE listing_id=?').get(l.id) as {payload:string}|null;
      const photoClock=d.query('SELECT observed_at FROM listing_photo_observations WHERE listing_id=?').get(l.id) as {observed_at:string}|null;
      const snapshot:Snapshot=snapshotSchema.parse({source:l.source,sourceId:l.source_id,url:l.url,title:l.title,
        description:l.description??"",askingPriceCents:l.asking_price_cents,location:l.location,postedAt:l.posted_at,
        sellerRef:l.seller_ref,observedAt:l.last_seen??l.captured_at,capturedAt:l.captured_at,detailAt:l.updated_at,
        retiredAt:l.delisted_at,retireReason:l.delist_reason,raw:rawObject(l.raw_json),photos,
        vision:v?.photo_fingerprint&&v?.prompt_version?{model:v.model,promptVersion:v.prompt_version,fingerprint:v.photo_fingerprint,payload:v.payload,createdAt:v.created_at}:null,
        availability:availability?{...availability,nextAt:l.next_probe_at,failures:l.probe_failures}:null,enrichment,
        ...(recovery?{recovery:JSON.parse(recovery.payload)}:{}),...(photoClock?{photosAt:photoClock.observed_at}:{})});
      const hash=contentHash(snapshot);
      const previous=d.query("SELECT hash FROM sync_local_state WHERE target=? AND listing_id=?").get(target,l.id) as {hash:string}|null;
      if(previous?.hash===hash) continue;
      d.run("INSERT INTO sync_outbox(target,listing_id,source,hash,payload) VALUES(?,?,?,?,?)",[target,l.id,source,hash,JSON.stringify(snapshot)]);
      d.run("INSERT INTO sync_local_state VALUES(?,?,?) ON CONFLICT(target,listing_id) DO UPDATE SET hash=excluded.hash",[target,l.id,hash]);
      added++;
    }
    return added;
  })();
}

export function pendingBatch(d:Database,target:string,source:string,limit=200):SyncBatch {
  ensureSync(d);
  const identity=d.query("SELECT client_id FROM sync_identity WHERE id=1").get() as {client_id:string};
  const rows=d.query("SELECT sequence,hash,payload FROM sync_outbox WHERE target=? AND source=? ORDER BY sequence LIMIT ?").all(target,source,Math.max(1,Math.min(300,limit))) as {sequence:number;hash:string;payload:string}[];
  return {version:2,clientId:identity.client_id,changes:rows.map(r=>({sequence:r.sequence,hash:r.hash,listing:JSON.parse(r.payload)}))};
}

/** Only an acknowledgement of this exact transmitted version drains the queue. */
export function acknowledge(d:Database,target:string,batch:SyncBatch,acks:SyncAck[]) {
  const sent=new Map(batch.changes.map(c=>[c.sequence,c.hash]));
  return d.transaction(()=>{
    let count=0;
    for(const ack of acks) if(sent.get(ack.sequence)===ack.hash && ["applied","stale","duplicate"].includes(ack.status)) {
      count+=d.run("DELETE FROM sync_outbox WHERE target=? AND sequence=? AND hash=?",[target,ack.sequence,ack.hash]).changes;
    }
    return count;
  })();
}
