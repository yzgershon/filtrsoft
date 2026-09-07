import { db, now } from "../db/index.ts";
import { upsertListingFacts } from "../db/listings.ts";
import { syncPhotoUrls, fingerprintOf } from "../vision/merge.ts";
import { batchSchema, contentHash, ensureSync, type SyncAck } from "./outbox.ts";

/** Acknowledgement means facts and a scoring request are durable. Derivation and
 * thumbnails run in background queues; slow images cannot hide accepted writes.
 */
export function receiveChanges(input:unknown):{acks:SyncAck[]} {
  const batch=batchSchema.parse(input),d=db();ensureSync(d);
  // Validate the whole envelope before any writes, including replay identity.
  for(const c of batch.changes) {
    if(contentHash(c.listing)!==c.hash) throw new Error("change hash mismatch");
    if([c.listing.observedAt,c.listing.detailAt,c.listing.retiredAt,c.listing.vision?.createdAt].some(t=>t&&Date.parse(t)>Date.now()+300_000)) throw new Error("observation timestamp is in the future");
    if(c.listing.vision) JSON.parse(c.listing.vision.payload);
  }
  return d.transaction(()=>{
    const acks:SyncAck[]=[];
    for(const c of batch.changes) {
      const receipt=d.query("SELECT hash FROM sync_receipts WHERE client_id=? AND sequence=?").get(batch.clientId,c.sequence) as {hash:string}|null;
      if(receipt) {
        if(receipt.hash!==c.hash) throw new Error("sequence reused for different content");
        acks.push({sequence:c.sequence,hash:c.hash,status:"duplicate"});continue;
      }
      const l=c.listing;
      const existing=d.query("SELECT id,last_seen,captured_at,description FROM listings WHERE source=? AND source_id=?").get(l.source,l.sourceId) as {id:number;last_seen:string|null;captured_at:string;description:string}|null;
      const version=existing?d.query("SELECT sequence FROM sync_versions WHERE client_id=? AND listing_id=?").get(batch.clientId,existing.id) as {sequence:number}|null:null;
      const oldVersion=version && version.sequence>=c.sequence;
      const stale=oldVersion || (existing && l.observedAt<(existing.last_seen??existing.captured_at));
      let status:SyncAck["status"]="stale";
      if(!stale) {
        const partial=!l.description;
        const stored=upsertListingFacts(d,{...l,updatedAt:l.detailAt,photoCount:l.photos.length,partial},l.observedAt);
        d.run("UPDATE listings SET captured_at=MIN(captured_at,?) WHERE id=?",[l.capturedAt,stored.id]);
        // A search-card thumbnail is not an authoritative replacement gallery.
        const replacePhotos=!partial || !existing?.description;
        if(replacePhotos) {
          syncPhotoUrls(stored.id,l.photos.map(p=>p.url));
          for(const p of l.photos) if(p.phash) d.run("UPDATE listing_photos SET phash=? WHERE listing_id=? AND url=?",[p.phash,stored.id,p.url]);
        }
        if(l.retiredAt && l.retiredAt>=l.observedAt) d.run("UPDATE listings SET delisted_at=?,delist_reason=? WHERE id=? AND (delisted_at IS NULL OR delisted_at<=?)",[l.retiredAt,l.retireReason??"gone",stored.id,l.retiredAt]);
        const v=l.vision;
        const hashes=d.query("SELECT phash FROM listing_photos WHERE listing_id=?").all(stored.id) as {phash:string|null}[];
        if(v && hashes.length && hashes.every(p=>p.phash) && fingerprintOf(hashes.map(p=>p.phash!))===v.fingerprint) {
          // The laptop already paid. Import evidence, never duplicate spend or a local verdict.
          d.run(`INSERT INTO vision_results(listing_id,model,prompt_version,photo_fingerprint,payload,cost_micros,created_at)
            SELECT ?,?,?,?,?,0,? WHERE NOT EXISTS(SELECT 1 FROM vision_results WHERE listing_id=? AND model=? AND prompt_version=? AND photo_fingerprint=? AND payload=?)`,
            [stored.id,v.model,v.promptVersion,v.fingerprint,v.payload,v.createdAt,stored.id,v.model,v.promptVersion,v.fingerprint,v.payload]);
        }
        d.run("INSERT INTO listing_rechecks VALUES(?, 'sync', ?) ON CONFLICT(listing_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at",[stored.id,now()]);
        d.run("INSERT INTO sync_versions VALUES(?,?,?) ON CONFLICT(client_id,listing_id) DO UPDATE SET sequence=excluded.sequence",[batch.clientId,stored.id,c.sequence]);
        status="applied";
      }
      // Availability has its own observation time. A later delisting probe can
      // retire a row even when another collector has newer descriptive facts.
      if(stale && !oldVersion && existing && l.retiredAt && l.retiredAt>=(existing.last_seen??existing.captured_at)) {
        d.run("UPDATE listings SET delisted_at=?,delist_reason=? WHERE id=? AND (delisted_at IS NULL OR delisted_at<=?)",[l.retiredAt,l.retireReason??"gone",existing.id,l.retiredAt]);
        status="applied";
        d.run("INSERT INTO sync_versions VALUES(?,?,?) ON CONFLICT(client_id,listing_id) DO UPDATE SET sequence=excluded.sequence",[batch.clientId,existing.id,c.sequence]);
      }
      d.run("INSERT INTO sync_receipts VALUES(?,?,?,?)",[batch.clientId,c.sequence,c.hash,status]);
      acks.push({sequence:c.sequence,hash:c.hash,status});
    }
    return {acks};
  })();
}
