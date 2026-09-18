import {z} from 'zod';
import {db} from '../db/index.ts';
import {contentHash} from './outbox.ts';
import {identityFingerprint,installIdentityJobs} from '../catalog/recovery.ts';
export const catalogTransfer=z.object({source:z.enum(['facebook','offerup','mercari']),sourceId:z.string().min(1).max(100),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),identity:z.object({category:z.string().max(50),brand:z.string().max(100),model:z.string().max(300)})});
export function captureCatalog(target:string){
 installIdentityJobs();const d=db();d.exec("CREATE TABLE IF NOT EXISTS catalog_outbox(target TEXT,hash TEXT,payload TEXT,state TEXT NOT NULL DEFAULT 'pending',next_at TEXT NOT NULL DEFAULT '',reason TEXT,PRIMARY KEY(target,hash))");
 for(const row of d.query("SELECT l.*,j.fingerprint,s.category,s.brand,s.model FROM identity_jobs j JOIN listings l ON l.id=j.listing_id JOIN skus s ON s.id=j.sku_id WHERE j.state='resolved' AND l.source IN ('facebook','offerup','mercari')").all() as any[]){
  if(identityFingerprint(row)!==row.fingerprint)continue;
  const item=catalogTransfer.parse({source:row.source,sourceId:row.source_id,fingerprint:row.fingerprint,identity:{category:row.category,brand:row.brand,model:row.model}});
  const hash=contentHash(item);
  d.run('INSERT OR IGNORE INTO catalog_outbox(target,hash,payload) VALUES(?,?,?)',[target,hash,JSON.stringify(item)]);
  // Old descriptions cannot become current again by retrying their hash. Keep
  // the evidence, but retire the retry only when this exact current item has
  // a successful server acknowledgement; a queued replacement is not enough.
  if(d.query("SELECT 1 FROM catalog_outbox WHERE target=? AND hash=? AND state IN ('applied','duplicate')").get(target,hash))
   d.run("UPDATE catalog_outbox SET state='superseded',reason=?,next_at='' WHERE target=? AND state='pending' AND hash!=? AND json_extract(payload,'$.source')=? AND json_extract(payload,'$.sourceId')=?",['Current facts acknowledged as '+hash,target,hash,item.source,item.sourceId]);
 }
}
export async function flushCatalog(target:string,authorization:string){
 captureCatalog(target);let acked=0;
 for(let batch=0;batch<4;batch++){
  const rows=db().query("SELECT hash,payload FROM catalog_outbox WHERE target=? AND state='pending' AND next_at<=? LIMIT 25").all(target,new Date().toISOString()) as {hash:string;payload:string}[];
  if(!rows.length)break;
  const r=await fetch(target+'/v1/collector/catalog',{method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify({items:rows.map(r=>({hash:r.hash,...JSON.parse(r.payload)}))}),signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('Catalog synchronization HTTP '+r.status);
  const body=await r.json() as {acks?:{hash:string;state:string;reason?:string}[]};const hashes=new Set(rows.map(r=>r.hash));
  for(const ack of body.acks??[]){if(!hashes.delete(ack.hash)||!['applied','duplicate','deferred','rejected'].includes(ack.state))throw Error('Invalid catalog acknowledgement');
   db().run('UPDATE catalog_outbox SET state=?,next_at=?,reason=? WHERE target=? AND hash=?',[ack.state==='deferred'?'pending':ack.state,ack.state==='deferred'?new Date(Date.now()+3600000).toISOString():'',ack.reason??null,target,ack.hash]);if(['applied','duplicate'].includes(ack.state))acked++;}
  if(hashes.size)throw Error('Missing catalog acknowledgements');
 }
 captureCatalog(target);
 return acked;
}
