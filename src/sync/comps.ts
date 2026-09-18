import {z} from 'zod';
import type {Database} from 'bun:sqlite';
import {contentHash} from './outbox.ts';
import {soldEvidence} from '../db/comp-evidence.ts';
export const compTransfer=z.object({sku:z.object({category:z.string().max(50),brand:z.string().max(100),model:z.string().max(300)}),
  comp:z.object({source:z.literal('ebay'),source_item_id:z.string().min(1).max(100),url:z.url().refine(s=>/^https:\/\/(www\.)?ebay\.com\/itm\//.test(s)),
    raw_title:z.string().min(1).max(1500),sold_price_cents:z.number().int().positive(),shipping_cents:z.number().int().nonnegative().nullable(),
    currency:z.literal('USD'),condition_raw:z.string().max(300).nullable(),condition_norm:z.string().max(50).nullable(),
    sold_at:z.string().max(50),captured_at:z.string().max(50),raw_json:z.string().max(30000)})});
export function ensureCompOutbox(d:Database) {
  d.exec(`CREATE TABLE IF NOT EXISTS comp_outbox(target TEXT,hash TEXT,payload TEXT,status TEXT NOT NULL DEFAULT 'pending',reason TEXT,PRIMARY KEY(target,hash));
    CREATE TABLE IF NOT EXISTS comp_capture_cursor(target TEXT PRIMARY KEY,last_id INTEGER NOT NULL,last_at TEXT NOT NULL);`);
}
export function captureNewComps(d:Database,target:string,initialId:number) {
  ensureCompOutbox(d);
  d.run('INSERT OR IGNORE INTO comp_capture_cursor VALUES(?,?,?)',[target,initialId,new Date().toISOString()]);
  return d.transaction(()=>{
    const cursor=d.query('SELECT last_id,last_at FROM comp_capture_cursor WHERE target=?').get(target) as {last_id:number;last_at:string};
    const at=new Date().toISOString();
    const rows=d.query(`SELECT c.*,s.category,s.brand,s.model FROM comps c LEFT JOIN skus s ON s.id=c.sku_id WHERE c.id>? OR c.updated_at>=? ORDER BY c.id`).all(cursor.last_id,cursor.last_at) as any[];
    let added=0;
    for(const row of rows) {
      const parsed=compTransfer.safeParse({sku:row,comp:row});
      if(parsed.success&&soldEvidence(row)){const payload=parsed.data;added+=d.run('INSERT OR IGNORE INTO comp_outbox(target,hash,payload) VALUES(?,?,?)',[target,contentHash(payload),JSON.stringify(payload)]).changes;}
    }
    d.run('UPDATE comp_capture_cursor SET last_id=?,last_at=? WHERE target=?',[Math.max(cursor.last_id,rows.at(-1)?.id??0),at,target]);
    return added;
  })();
}
export async function flushComps(d:Database,target:string,authorization:string) {
  ensureCompOutbox(d);let sent=0;
  const hasCatalog=Boolean(d.query("SELECT 1 FROM sqlite_schema WHERE name='catalog_outbox'").get());
  for(let batch=0;batch<20;batch++) {
    const rows=d.query(`SELECT hash,payload FROM comp_outbox o WHERE target=? AND status='pending' ${hasCatalog?`AND NOT EXISTS(SELECT 1 FROM catalog_outbox c WHERE c.target=o.target AND c.state='pending' AND json_extract(c.payload,'$.identity.category')=json_extract(o.payload,'$.sku.category') AND json_extract(c.payload,'$.identity.brand')=json_extract(o.payload,'$.sku.brand') AND json_extract(c.payload,'$.identity.model')=json_extract(o.payload,'$.sku.model'))`:''} LIMIT 25`).all(target) as {hash:string;payload:string}[];
    if(!rows.length)return sent;
    const response=await fetch(target+'/v1/collector/comps',{method:'POST',headers:{authorization,'content-type':'application/json'},
      body:JSON.stringify({items:rows.map(r=>({hash:r.hash,...JSON.parse(r.payload)}))}),signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error(`Comp upload HTTP ${response.status}; queue retained`);
    const body=await response.json() as {acks?:{hash:string;status:string;reason?:string}[]};
    if(!Array.isArray(body.acks))throw new Error('Missing comp acknowledgements');
    const hashes=new Set(rows.map(r=>r.hash));let acknowledged=0;
    for(const ack of body.acks)if(hashes.delete(ack.hash)&&['applied','duplicate','rejected'].includes(ack.status)) {
      d.run('UPDATE comp_outbox SET status=?,reason=? WHERE target=? AND hash=?',[ack.status,ack.reason??null,target,ack.hash]);acknowledged++;if(ack.status!=='rejected')sent++;
    }
    if(acknowledged!==rows.length)throw new Error('Incomplete comp acknowledgement; queue retained');
  }
  return sent;
}
