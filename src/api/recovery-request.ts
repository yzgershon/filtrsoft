import type {Context} from 'hono';import {collectionOwner} from './collection-health.ts';import {db,now} from '../db/index.ts';import {ensureEnrichment} from '../db/enrichment.ts';
export function handleRecoveryForm(c:Context){
 c.header('Cache-Control','no-store');if(!collectionOwner(c))return c.json({error:'Owner access required'},403);
 return c.html('<!doctype html><title>Filtrsoft evidence recovery</title><h1>Queue evidence recovery</h1><p>Existing complete reads, source pauses and retry delays remain respected. Enter explicit listing IDs, up to 250.</p><form method="post"><label>Listing IDs<textarea name="ids" aria-label="Listing IDs"></textarea></label><button>Queue evidence recovery</button></form>');
}
export async function handleRecoveryRequest(c:Context){
 c.header('Cache-Control','no-store');if(!collectionOwner(c))return c.json({error:'Owner access required'},403);
 // Railway terminates TLS before forwarding to Bun, so req.url may be HTTP.
 // Compare against the configured public site, never arbitrary forwarded input.
 if(c.req.header('origin')!==new URL(process.env.FILTRSOFT_SITE_URL??'https://filtrsoft.com').origin)return c.json({error:'Same-origin request required'},403);
 const body=await c.req.parseBody(),input=String(body.ids??'');if(!/^\d+(,\d+)*$/.test(input))return c.json({error:'Explicit IDs required'},400);
 const ids=[...new Set(input.split(',').map(Number))];if(ids.length>250||ids.some(n=>!Number.isSafeInteger(n)||n<1))return c.json({error:'At most 250 valid IDs'},400);
 ensureEnrichment();const at=now(),matched=db().transaction(()=>{let n=0;for(const id of ids)if(db().query('SELECT 1 FROM listings WHERE id=?').get(id)){db().run('INSERT INTO cohort_recovery_requests VALUES(?,?) ON CONFLICT(listing_id) DO NOTHING',[id,at]);n++;}return n;})();
 return c.json({at,requested:ids.length,matched,note:'Queued within existing completeness, availability and backoff guards.'});
}
