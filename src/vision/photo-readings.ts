/**
 * Server-side store for shadow photo readings uploaded by the collector.
 * Display only: nothing here is read by the engine, scoring or alerts.
 */
import type {Database} from 'bun:sqlite';
import {db} from '../db/index.ts';
import {fingerprintOf} from './merge.ts';
import {photoReadingSchema,type PhotoReading} from './photo-shadow.ts';

export function ensurePhotoReadings(d:Database=db()) {
  d.run('CREATE TABLE IF NOT EXISTS photo_readings(listing_id INTEGER PRIMARY KEY,updated_at TEXT NOT NULL,payload TEXT NOT NULL)');
}

/**
 * The stored reading with `photosChanged`: true when the listing's current
 * gallery hashes differ from the photos that were read, null when that cannot
 * be told (some photos not hashed yet).
 */
export function loadPhotoReading(listingId:number,d:Database=db()):(PhotoReading&{photosChanged:boolean|null})|null {
  ensurePhotoReadings(d);
  const row=d.query('SELECT payload FROM photo_readings WHERE listing_id=?').get(listingId) as {payload:string}|null;
  if(!row)return null;
  const parsed=photoReadingSchema.safeParse(JSON.parse(row.payload));
  if(!parsed.success)return null;
  const hashes=d.query('SELECT phash FROM listing_photos WHERE listing_id=?').all(listingId) as {phash:string|null}[];
  const photosChanged=hashes.length&&hashes.every(h=>h.phash)?fingerprintOf(hashes.map(h=>h.phash!))!==parsed.data.fingerprint:null;
  return {...parsed.data,photosChanged};
}
