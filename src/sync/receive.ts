import { db, now } from "../db/index.ts";
import { upsertListingFacts } from "../db/listings.ts";
import { syncPhotoUrls, fingerprintOf,ensurePhotoClock } from "../vision/merge.ts";
import {rawObject} from '../db/facts.ts';
import { batchSchema, contentHash, ensureSync, type SyncAck } from "./outbox.ts";
import {ensureEnrichment} from '../db/enrichment.ts';

/** Acknowledgement means facts and a scoring request are durable. Derivation and
 * thumbnails run in background queues; slow images cannot hide accepted writes.
 */
export function receiveChanges(input:unknown):{acks:SyncAck[]} {
  const batch=batchSchema.parse(input),d=db();ensureSync(d);
  ensureEnrichment(d);
  ensurePhotoClock(d);
  // Validate the whole envelope before any writes, including replay identity.
  for(const c of batch.changes) {
    if(contentHash(c.listing)!==c.hash) throw new Error("change hash mismatch");
    if([c.listing.observedAt,c.listing.detailAt,c.listing.photosAt,c.listing.retiredAt,c.listing.vision?.createdAt,c.listing.availability?.observedAt,c.listing.enrichment?.attemptedAt,c.listing.recovery?.observedAt].some(t=>t&&Date.parse(t)>Date.now()+300_000)) throw new Error("observation timestamp is in the future");
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
      const existing=d.query("SELECT id,last_seen,captured_at,description,updated_at FROM listings WHERE source=? AND source_id=?").get(l.source,l.sourceId) as {id:number;last_seen:string|null;captured_at:string;description:string;updated_at:string|null}|null;
      const version=existing?d.query("SELECT sequence FROM sync_versions WHERE client_id=? AND listing_id=?").get(batch.clientId,existing.id) as {sequence:number}|null:null;
      const oldVersion=version && version.sequence>=c.sequence;
      const stale=oldVersion || (existing && l.observedAt<(existing.last_seen??existing.captured_at));
      let status:SyncAck["status"]="stale";
      if(!stale) {
        const olderDetail=Boolean(existing?.updated_at && (!l.detailAt || l.detailAt<existing.updated_at));
        const partial=!l.description || olderDetail;
        const stored=upsertListingFacts(d,{...l,description:olderDetail?'':l.description,raw:olderDetail?undefined:l.raw,
          updatedAt:olderDetail?null:l.detailAt,photoCount:l.photos.length,partial},l.observedAt);
        d.run("UPDATE listings SET captured_at=MIN(captured_at,?) WHERE id=?",[l.capturedAt,stored.id]);
        // A search-card thumbnail is not an authoritative replacement gallery.
        const replacePhotos=!partial || !existing?.description;
        if(replacePhotos && !l.photosAt) {
          syncPhotoUrls(stored.id,l.photos.map(p=>p.url));
          for(const p of l.photos) if(p.phash) d.run("UPDATE listing_photos SET phash=? WHERE listing_id=? AND url=?",[p.phash,stored.id,p.url]);
        }
        if(l.retiredAt && l.retiredAt>=l.observedAt) d.run("UPDATE listings SET delisted_at=?,delist_reason=? WHERE id=? AND (delisted_at IS NULL OR delisted_at<=?)",[l.retiredAt,l.retireReason??"gone",stored.id,l.retiredAt]);
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
      // A newer search card can advance last_seen while an independent detail
      // read is uploading. Preserve that card's price but accept newer prose.
      if(stale && !oldVersion && existing && l.description && l.detailAt && l.detailAt>(existing.updated_at??'')) {
        d.run('UPDATE listings SET description=?,updated_at=? WHERE id=?',[l.description,l.detailAt,existing.id]);
        const savedRaw=rawObject((d.query('SELECT raw_json FROM listings WHERE id=?').get(existing.id) as any).raw_json);
        d.run('UPDATE listings SET raw_json=? WHERE id=?',[JSON.stringify({...savedRaw,...l.raw}),existing.id]);
        if(l.photos.length&&!l.photosAt){
          syncPhotoUrls(existing.id,l.photos.map(p=>p.url));
          d.run('UPDATE listings SET photo_count=? WHERE id=?',[l.photos.length,existing.id]);
          for(const p of l.photos)if(p.phash)d.run('UPDATE listing_photos SET phash=? WHERE listing_id=? AND url=?',[p.phash,existing.id,p.url]);
        }
        d.run("INSERT INTO listing_rechecks VALUES(?,'detail',?) ON CONFLICT(listing_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at",[existing.id,now()]);
        d.run("INSERT INTO sync_versions VALUES(?,?,?) ON CONFLICT(client_id,listing_id) DO UPDATE SET sequence=excluded.sequence",[batch.clientId,existing.id,c.sequence]);
        status='applied';
      }
      // Probe/retry observations have separate clocks from descriptive facts.
      // A timeout must travel too, without pretending the listing was seen alive.
      const stored=d.query('SELECT id FROM listings WHERE source=? AND source_id=?').get(l.source,l.sourceId) as {id:number}|null;
      if(stored && !oldVersion){
        if(l.photosAt){
          const clock=d.query('SELECT observed_at FROM listing_photo_observations WHERE listing_id=?').get(stored.id) as {observed_at:string}|null;
          if(!clock||l.photosAt>clock.observed_at){
            const changed=syncPhotoUrls(stored.id,l.photos.map(p=>p.url),l.photosAt);
            d.run('UPDATE listings SET photo_count=? WHERE id=?',[l.photos.length,stored.id]);
            for(const p of l.photos)if(p.phash)d.run('UPDATE listing_photos SET phash=? WHERE listing_id=? AND url=?',[p.phash,stored.id,p.url]);
            if(changed)d.run("INSERT INTO listing_rechecks VALUES(?,'photos',?) ON CONFLICT(listing_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at",[stored.id,now()]);
            status='applied';
          }
        }
        const a=l.availability,e=l.enrichment;
        if(a){
          const applied=d.run(`INSERT INTO listing_availability VALUES(?,?,?) ON CONFLICT(listing_id) DO UPDATE SET observed_at=excluded.observed_at,outcome=excluded.outcome WHERE excluded.observed_at>listing_availability.observed_at`,[stored.id,a.observedAt,a.outcome]).changes;
          if(applied)d.run('UPDATE listings SET last_probed_at=?,next_probe_at=?,probe_failures=? WHERE id=?',[a.observedAt,a.nextAt,a.failures,stored.id]);
        }
        if(e)d.run(`INSERT INTO listing_enrichment VALUES(?,?,?,?,?) ON CONFLICT(listing_id) DO UPDATE SET attempted_at=excluded.attempted_at,next_attempt_at=excluded.next_attempt_at,failures=excluded.failures,outcome=excluded.outcome WHERE excluded.attempted_at>listing_enrichment.attempted_at`,[stored.id,e.attemptedAt,e.nextAt,e.failures,e.outcome]);
        if(e?.fingerprint)d.run('INSERT INTO listing_recovery_attempts VALUES(?,?,?) ON CONFLICT(listing_id) DO UPDATE SET fingerprint=excluded.fingerprint,attempted_at=excluded.attempted_at WHERE excluded.attempted_at>listing_recovery_attempts.attempted_at',[stored.id,e.fingerprint,e.attemptedAt]);
        if(l.recovery)d.run(`INSERT INTO listing_recovery VALUES(?,?,?) ON CONFLICT(listing_id) DO UPDATE SET observed_at=excluded.observed_at,payload=excluded.payload WHERE excluded.observed_at>listing_recovery.observed_at`,[stored.id,l.recovery.observedAt,JSON.stringify(l.recovery)]);
        const v=l.vision;
        const hashes=d.query('SELECT phash FROM listing_photos WHERE listing_id=?').all(stored.id) as {phash:string|null}[];
        if(v&&hashes.length&&hashes.every(p=>p.phash)&&fingerprintOf(hashes.map(p=>p.phash!))===v.fingerprint){
          const inserted=d.run(`INSERT INTO vision_results(listing_id,model,prompt_version,photo_fingerprint,payload,cost_micros,created_at)
            SELECT ?,?,?,?,?,0,? WHERE NOT EXISTS(SELECT 1 FROM vision_results WHERE listing_id=? AND model=? AND prompt_version=? AND photo_fingerprint=? AND payload=?)`,
            [stored.id,v.model,v.promptVersion,v.fingerprint,v.payload,v.createdAt,stored.id,v.model,v.promptVersion,v.fingerprint,v.payload]).changes;
          if(inserted)d.run("INSERT INTO listing_rechecks VALUES(?,'vision',?) ON CONFLICT(listing_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at",[stored.id,now()]);
        }
      }
      d.run("INSERT INTO sync_receipts VALUES(?,?,?,?)",[batch.clientId,c.sequence,c.hash,status]);
      acks.push({sequence:c.sequence,hash:c.hash,status});
    }
    return {acks};
  })();
}
