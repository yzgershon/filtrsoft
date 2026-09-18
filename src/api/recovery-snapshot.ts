import type {Context} from 'hono';
import {collectionOwner} from './collection-health.ts';
import {db,now} from '../db/index.ts';
/** Owner-only bounded evidence export. Never returns auth/account tables or
 * decision tokens; IDs are explicit so a frozen cohort cannot silently drift. */
export function handleRecoverySnapshot(c:Context){
 c.header('Cache-Control','no-store');
 if(!collectionOwner(c))return c.json({error:'Owner access required'},403);
 const input=c.req.query('ids')??'';
 if(!/^\d+(,\d+)*$/.test(input))return c.json({error:'Explicit listing IDs required'},400);
 const ids=[...new Set(input.split(',').map(Number))];if(ids.length>250||ids.some(id=>!Number.isSafeInteger(id)||id<1))return c.json({error:'At most 250 IDs'},400);
 const d=db(),has=(name:string)=>Boolean(d.query('SELECT 1 FROM sqlite_schema WHERE name=?').get(name));
 return c.json(d.transaction(()=>({at:now(),items:ids.map(id=>{
   const listing=d.query('SELECT * FROM listings WHERE id=?').get(id);if(!listing)return {id,missing:true};
   const v=d.query('SELECT id,engine_version,call,created_at,payload FROM verdicts WHERE listing_id=? ORDER BY id DESC LIMIT 1').get(id) as any;
   return {id,listing,verdict:v?{...v,payload:JSON.parse(v.payload)}:null,
     photos:d.query('SELECT url,position FROM listing_photos WHERE listing_id=? ORDER BY position').all(id),
     recovery:has('listing_recovery')?d.query('SELECT * FROM listing_recovery WHERE listing_id=?').get(id):null,
     enrichment:has('listing_enrichment')?d.query('SELECT * FROM listing_enrichment WHERE listing_id=?').get(id):null,
     availability:has('listing_availability')?d.query('SELECT * FROM listing_availability WHERE listing_id=?').get(id):null,
     identityJob:has('identity_jobs')?d.query('SELECT * FROM identity_jobs WHERE listing_id=?').get(id):null};
 })}))());
}
