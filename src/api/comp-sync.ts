import type {Context} from 'hono';
import {z} from 'zod';
import {agentAuthorised} from './jobs.ts';
import {compTransfer} from '../sync/comps.ts';
import {contentHash} from '../sync/outbox.ts';
import {db,insertComp} from '../db/index.ts';
import {soldEvidence} from '../db/comp-evidence.ts';
import {queryForSku,compMatchesQuery} from '../sources/ebay.ts';
const batch=z.object({items:z.array(compTransfer.extend({hash:z.string().regex(/^[a-f0-9]{64}$/)})).min(1).max(25)});
export function receiveComps(input:unknown) {
  const parsed=batch.parse(input);
  return db().transaction(()=>parsed.items.map(({hash,...item})=>{
    const rejected=(reason:string)=>({hash,status:'rejected',reason});
    if(contentHash(item)!==hash)return rejected('Content hash mismatch');
    const sku=db().query('SELECT id,category,brand,model FROM skus WHERE category=? AND brand=? AND model=?').get(item.sku.category,item.sku.brand,item.sku.model) as any;
    if(!sku)return rejected('Exact catalog identity is not registered on the server');
    const c=item.comp,query=queryForSku(sku),match=compMatchesQuery(c.raw_title,query,sku.category);
    if(!match.ok)return rejected(match.why);
    if(!soldEvidence(c))return rejected('Unverified sale date or sold evidence');
    const raw=JSON.parse(c.raw_json);
    if(raw.title!==c.raw_title||raw.sourceItemId!==c.source_item_id||raw.soldPriceCents!==c.sold_price_cents||(raw.shippingCents??null)!==c.shipping_cents)return rejected('Stored row does not match its original parsed sale');
    const existing=db().query("SELECT sku_id FROM comps WHERE source='ebay' AND source_item_id=?").get(c.source_item_id) as {sku_id:number|null}|null;
    if(existing?.sku_id!=null&&existing.sku_id!==sku.id)return rejected('Existing comp belongs to another SKU');
    const saved=insertComp({...c,url:c.url,shipping_cents:c.shipping_cents??undefined,condition_raw:c.condition_raw??undefined,condition_norm:c.condition_norm??undefined,
      sku_id:sku.id,query,raw:JSON.parse(c.raw_json)});
    return {hash,status:saved.changes?'applied':'duplicate'};
  }))();
}
export async function handleCompSync(c:Context) {
  if(!agentAuthorised(c))return c.json({error:'unauthorised'},401);
  const reader=c.req.raw.body?.getReader();if(!reader)return c.json({error:'Missing body'},400);
  const chunks:Uint8Array[]=[];let bytes=0;
  for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1_000_000){await reader.cancel();return c.json({error:'Comp batch too large'},413);}chunks.push(value);}
  try{return c.json({acks:receiveComps(JSON.parse(Buffer.concat(chunks).toString('utf8')))});}
  catch(error){if(error instanceof z.ZodError||error instanceof SyntaxError)return c.json({error:'Invalid comp batch'},400);throw error;}
}
