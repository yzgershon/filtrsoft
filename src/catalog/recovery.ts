import {db,now} from '../db/index.ts';
import {createHash,randomUUID} from 'node:crypto';
import {sourceIdentity} from './source-identity.ts';
import {findOrCreateSku} from './derive.ts';
import {matchSku} from './match.ts';
import {detectCategory} from '../signals/index.ts';
import {textFacts} from '../signals/factual-text.ts';
import {exactDemandQuery} from '../sources/comp-query.ts';
import {ensureEnrichment} from '../db/enrichment.ts';
export const identityFingerprint=(r:any)=>createHash('sha256').update(JSON.stringify([r.title,r.description??'',r.delisted_at??null])).digest('hex');
export function installIdentityJobs(){ensureEnrichment();db().exec(`CREATE TABLE IF NOT EXISTS comp_identity_demand(listing_id INTEGER PRIMARY KEY,state TEXT NOT NULL,reason TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS identity_jobs(listing_id INTEGER PRIMARY KEY REFERENCES listings(id),fingerprint TEXT NOT NULL,state TEXT NOT NULL,reason TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at TEXT NOT NULL,owner TEXT,lease_until TEXT,sku_id INTEGER,query TEXT,evidence TEXT,updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS identity_due ON identity_jobs(next_at,lease_until);`);}
export function enqueueIdentity(row:any,at=Date.now()){
 installIdentityJobs();const fingerprint=identityFingerprint(row),stamp=new Date(at).toISOString();
 db().run(`INSERT INTO identity_jobs(listing_id,fingerprint,state,reason,next_at,updated_at) VALUES(?,?,'queued','Current seller facts need deterministic identity resolution',?,?)
 ON CONFLICT(listing_id) DO UPDATE SET fingerprint=excluded.fingerprint,state='queued',reason=excluded.reason,attempts=0,next_at=excluded.next_at,owner=NULL,lease_until=NULL,sku_id=NULL,query=NULL,evidence=NULL,updated_at=excluded.updated_at WHERE fingerprint!=excluded.fingerprint`,[row.id,fingerprint,stamp,stamp]);
}
export function enqueueUnresolvedIdentities(at=Date.now()){
 installIdentityJobs();const rows=db().query(`SELECT l.id,l.title,l.description,l.delisted_at FROM listings l JOIN verdicts v ON v.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id) WHERE v.call='INSUFFICIENT_DATA' AND l.delisted_at IS NULL AND COALESCE(l.last_seen,l.captured_at)>=? ORDER BY l.id`).all(new Date(at-28*86400000).toISOString()) as any[];
 db().transaction(()=>{for(const row of rows)enqueueIdentity(row,at);})();return rows.length;
}
export function claimIdentity(owner:string,at=Date.now(),ids?:number[]){
 installIdentityJobs();return db().transaction(()=>{
 const row=db().query(`SELECT * FROM identity_jobs WHERE next_at<=? AND (owner IS NULL OR lease_until<=?) ${ids?.length?'AND listing_id IN ('+ids.map(()=>'?').join(',')+')':''} ORDER BY CASE WHEN listing_id IN (SELECT listing_id FROM cohort_recovery_requests) THEN 0 ELSE 1 END,next_at,listing_id LIMIT 1`).get(new Date(at).toISOString(),new Date(at).toISOString(),...(ids??[])) as any;
 if(!row)return null;db().run("UPDATE identity_jobs SET state='running',owner=?,lease_until=?,attempts=attempts+1 WHERE listing_id=?",[owner,new Date(at+60000).toISOString(),row.listing_id]);return {...row,owner,attempts:row.attempts+1};
 })();
}
/** No network or paid model calls. Every owned job ends in resolved, unavailable,
 * conflict, missing-model, missing-text or deferred with a bounded retry. */
export function resolveIdentityJob(job:any,at=Date.now()){
 return db().transaction(()=>{
  const d=db(),owned=d.query('SELECT * FROM identity_jobs WHERE listing_id=? AND owner=? AND lease_until>?').get(job.listing_id,job.owner,new Date(at).toISOString()) as any;
  if(!owned)return null;
  const row=d.query('SELECT * FROM listings WHERE id=?').get(job.listing_id) as any;if(!row)return null;
  if(identityFingerprint(row)!==owned.fingerprint){enqueueIdentity(row,at);return null;}
  const category=detectCategory(row.title,row.description??''),evidence=sourceIdentity(row.title,row.description??'',category),conflicts=textFacts(row.title+'\n'+(row.description??'')).conflicts;
  let state='missing-model',reason=evidence.reason,created=false,skuId:number|null=null,query:string|null=null;
  if(row.delisted_at){state='unavailable';reason='Confirmed unavailable; no comp work requested';}
  else if(conflicts.length||evidence.conflict){state='conflict';reason=evidence.reason;}
  else {
   if(evidence.identity){const found=findOrCreateSku(evidence.identity);created=found.created;
    // Only a canonical alias, never a generic listing headline. The source quote
    // remains on the durable job; specifications stay on their original listing.
    const alias=(evidence.identity.brand+' '+evidence.identity.model).toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
    d.run("INSERT INTO sku_aliases(sku_id,alias,source,confidence,created_at) VALUES(?,?,'source-identity','medium',?) ON CONFLICT(alias) DO NOTHING",[found.id,alias,new Date(at).toISOString()]);
   }
   const match=matchSku(row.title,row.description??'',category);
   if(match.skuId&&match.confidence!=='low'){
    state='resolved';reason=created?'Registered quoted exact manufacturer identity; exact sold query scheduled':'Existing exact catalog identity; exact sold query scheduled';skuId=match.skuId;
    query=exactDemandQuery({brand:match.brand!,model:match.model!,category:match.category!},match.attributes);
   }else if(!row.description?.trim()){state='missing-text';reason='Seller description absent; retry after a complete source read';}
  }
  const delay=state==='resolved'||state==='unavailable'?7*86400000:Math.min(86400000,3600000*2**Math.min(owned.attempts-1,5));
  d.run('UPDATE identity_jobs SET state=?,reason=?,next_at=?,owner=NULL,lease_until=NULL,sku_id=?,query=?,evidence=?,updated_at=? WHERE listing_id=? AND owner=?',
   [state,reason,new Date(at+delay).toISOString(),skuId,query,JSON.stringify({quotes:evidence.quotes,identity:evidence.identity,created}),new Date(at).toISOString(),row.id,job.owner]);
  d.run('INSERT INTO comp_identity_demand VALUES(?,?,?,?) ON CONFLICT(listing_id) DO UPDATE SET state=excluded.state,reason=excluded.reason,updated_at=excluded.updated_at',[row.id,state==='resolved'?'resolved':'identity-required',reason,new Date(at).toISOString()]);
  if(created)d.run("INSERT INTO listing_rechecks VALUES(?,'identity',?) ON CONFLICT(listing_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at",[row.id,new Date(at).toISOString()]);
  return {listingId:row.id,state,reason,skuId,query,created};
 })();
}
export function recoverIdentities(limit=20,opts:{ids?:number[];at?:number;enqueue?:boolean}={}){
 const at=opts.at??Date.now();if(opts.enqueue!==false)enqueueUnresolvedIdentities(at);
 const owner=randomUUID(),results:any[]=[];
 for(let i=0;i<Math.min(100,limit);i++){const job=claimIdentity(owner,at,opts.ids);if(!job)break;
  try{results.push(resolveIdentityJob(job,at));}catch{db().run("UPDATE identity_jobs SET state='deferred',reason='Resolver error; retry scheduled',owner=NULL,lease_until=NULL,next_at=? WHERE listing_id=? AND owner=?",[new Date(at+3600000).toISOString(),job.listing_id,owner]);}}
 return results;
}
