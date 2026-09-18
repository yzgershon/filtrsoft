import type {Context} from 'hono';import {z} from 'zod';
import {agentAuthorised} from './jobs.ts';import {catalogTransfer} from '../sync/catalog.ts';import {contentHash} from '../sync/outbox.ts';
import {db} from '../db/index.ts';import {identityFingerprint,enqueueIdentity,recoverIdentities} from '../catalog/recovery.ts';import {matchSku} from '../catalog/match.ts';import {detectCategory} from '../signals/index.ts';
const input=z.object({items:z.array(catalogTransfer.extend({hash:z.string().regex(/^[a-f0-9]{64}$/)})).max(25).min(1)});
export function receiveCatalog(value:unknown){return input.parse(value).items.map(({hash,...item})=>{
 const reply=(state:string,reason?:string)=>({hash,state,reason});if(contentHash(item)!==hash)return reply('rejected','Hash mismatch');
 const row=db().query('SELECT * FROM listings WHERE source=? AND source_id=?').get(item.source,item.sourceId) as any;
 if(!row||identityFingerprint(row)!==item.fingerprint)return reply('deferred','Current source facts must synchronize before catalog resolution');
 db().exec('CREATE TABLE IF NOT EXISTS catalog_receipts(hash TEXT PRIMARY KEY,received_at TEXT NOT NULL)');
 if(db().query('SELECT 1 FROM catalog_receipts WHERE hash=?').get(hash))return reply('duplicate');
 enqueueIdentity(row);recoverIdentities(1,{ids:[row.id],enqueue:false});
 const m=matchSku(row.title,row.description??'',detectCategory(row.title,row.description??''));
 if(!m.skuId||m.confidence==='low'||m.category!==item.identity.category||m.brand!==item.identity.brand||m.model!==item.identity.model)return reply('rejected','Requested identity is not supported by current source facts');
 db().run('INSERT OR IGNORE INTO catalog_receipts VALUES(?,?)',[hash,new Date().toISOString()]);return reply('applied');
});}
export async function handleCatalogSync(c:Context){
 if(!agentAuthorised(c))return c.json({error:'unauthorised'},401);
 const reader=c.req.raw.body?.getReader();if(!reader)return c.json({error:'Missing body'},400);const chunks:Uint8Array[]=[];let size=0;
 for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>100000){await reader.cancel();return c.json({error:'Batch too large'},413);}chunks.push(r.value);}
 try{return c.json({acks:receiveCatalog(JSON.parse(Buffer.concat(chunks).toString('utf8')))});}catch(error){if(error instanceof z.ZodError||error instanceof SyntaxError)return c.json({error:'Invalid catalog batch'},400);throw error;}
}
