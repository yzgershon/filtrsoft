import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import type {Database} from 'bun:sqlite';
const MARKER='{"$filtrsoft":"verdict-gzip-v1",';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');

/** Lossless storage, not a new verdict. Old decision references must recover
 * the exact JSON bytes, including their original pricing revision and quotes. */
export function decodeVerdictPayload(payload:string):string {
  if(!payload.startsWith(MARKER))return payload;
  const envelope=JSON.parse(payload);
  const decoded=gunzipSync(Buffer.from(envelope.data,'base64'),{maxOutputLength:16*1024*1024}).toString('utf8');
  if(hash(decoded)!==envelope.sha256)throw new Error('Archived verdict checksum mismatch');
  return decoded;
}
export function encodeVerdictPayload(payload:string):string {
  if(payload.startsWith(MARKER)||Buffer.byteLength(payload)<1024)return payload;
  const packed=JSON.stringify({$filtrsoft:'verdict-gzip-v1',sha256:hash(payload),data:gzipSync(payload,{level:6}).toString('base64')});
  if(Buffer.byteLength(packed)>=Buffer.byteLength(payload)-128)return payload;
  if(decodeVerdictPayload(packed)!==payload)throw new Error('Verdict compression round-trip failed');
  return packed;
}

/**
 * VERDICT HISTORY RETENTION, approved by Yish on 2026-09-25 when production
 * had 88 MB free on a 4.7 GB volume, 95% of it verdict history, and server
 * backups had stopped for lack of space.
 *
 * Deleted: rows older than 14 days that are not a listing's current verdict
 * and that no override, judgment, outcome or open decision view names (those
 * also keep their own frozen JSON copies). Small immediate transactions and a
 * cursor keep each step short; the freed pages are reused by SQLite, which
 * stops the file growing even though it cannot shrink without room to VACUUM.
 */
export const HISTORY_RETENTION_DAYS=14;
export function pruneVerdictHistoryBatch(d:Database,opts:{after?:number;limit?:number;now?:number}={}) {
  const limit=opts.limit??500;if(!Number.isInteger(limit)||limit<1||limit>2000)throw new Error('Batch limit must be 1–2000');
  const cutoff=new Date((opts.now??Date.now())-HISTORY_RETENTION_DAYS*86400000).toISOString();
  const referencing=['verdict_overrides','judgments','outcomes','decision_views'].filter(t=>
    d.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)
    && (d.query(`PRAGMA table_info(${t})`).all() as {name:string}[]).some(c=>c.name==='decision_id'));
  const referenced=referencing.map(t=>`AND v.id NOT IN (SELECT decision_id FROM ${t} WHERE decision_id IS NOT NULL)`).join(' ');
  return d.transaction(()=>{
    const ids=(d.query(`SELECT v.id FROM verdicts v WHERE v.id>? AND v.created_at<?
      AND v.id<(SELECT MAX(x.id) FROM verdicts x WHERE x.listing_id=v.listing_id) ${referenced}
      ORDER BY v.id LIMIT ?`).all(opts.after??0,cutoff,limit) as {id:number}[]).map(r=>r.id);
    if(ids.length)d.run(`DELETE FROM verdicts WHERE id IN (${ids.map(()=>'?').join(',')})`,ids);
    return {deleted:ids.length,next:ids.at(-1)??opts.after??0,done:ids.length<limit};
  }).immediate();
}

/** Keep every row and every latest payload. Small transactions avoid consuming
 * the remaining filesystem with a multi-GB WAL during recovery. API readers
 * of current verdicts continue receiving plain JSON throughout the operation. */
export function compactVerdictBatch(d:Database,opts:{after?:number;limit?:number;apply?:boolean;restore?:boolean}={}) {
  const limit=opts.limit??128;if(!Number.isInteger(limit)||limit<1||limit>256)throw new Error('Batch limit must be 1–256');
  const rows=d.query(`SELECT id,listing_id,payload FROM verdicts WHERE id>?
    AND id<(SELECT MAX(v.id) FROM verdicts v WHERE v.listing_id=verdicts.listing_id)
    ORDER BY id LIMIT ?`).all(opts.after??0,limit) as Array<{id:number;listing_id:number;payload:string}>;
  let changed=0,beforeBytes=0,afterBytes=0;
  const prepared=rows.map(row=>({...row,packed:opts.restore?decodeVerdictPayload(row.payload):encodeVerdictPayload(row.payload)}));
  const apply=()=>{for(const row of prepared){const packed=row.packed;if(packed===row.payload)continue;
    if(opts.apply){const result=d.run('UPDATE verdicts SET payload=? WHERE id=? AND payload=? AND id<(SELECT MAX(v.id) FROM verdicts v WHERE v.listing_id=?)',[packed,row.id,row.payload,row.listing_id]);if(!result.changes)continue;}
    changed++;beforeBytes+=Buffer.byteLength(row.payload);afterBytes+=Buffer.byteLength(packed);
  }};
  if(opts.apply)d.transaction(apply)();else apply();
  return {scanned:rows.length,changed,beforeBytes,afterBytes,savedBytes:beforeBytes-afterBytes,next:rows.at(-1)?.id??opts.after??0,done:rows.length<limit};
}
