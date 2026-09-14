import type {Context} from 'hono';
import {db} from '../db/index.ts';
import {pricingSignature} from '../db/revisions.ts';
import {catalogCategory} from '../catalog/identity.ts';
import {currentUser} from './auth.ts';
import {marketCohorts,marketSeries,marketCsv,marketCategory,rangeStart,type StoredMarketSale} from '../market/core.ts';
import type {MarketProduct,MarketRange,MarketCondition,PriceBasis} from '../market/types.ts';

const categories=new Set(['phone','tablet','laptop','prebuilt','desktop','cpu','gpu','ram','storage','motherboard','psu','case','component','monitor','wearable','audio','camera','networking']);
const normalizeProduct=(p:MarketProduct)=>({...p,category:marketCategory(p.category,p.model)});
export function marketCatalog(c:Context) {
  const q=(c.req.query('q')??'').trim().toLowerCase(),category=c.req.query('category')??'',offset=Number(c.req.query('offset')??0);
  if(q.length>100||category&&!categories.has(category)||!Number.isSafeInteger(offset)||offset<0)return c.json({error:'Invalid market search.'},400);
  const all=(db().query('SELECT id,brand,model,category FROM skus ORDER BY brand,model,id').all() as MarketProduct[]).map(normalizeProduct).filter(p=>categories.has(p.category));
  const pins=new Set((db().query('SELECT sku_id FROM market_pins WHERE user_id=?').all(currentUser(c)!.id) as {sku_id:number}[]).map(p=>p.sku_id));
  const items=all.filter(p=>(!category||p.category===category)&&q.split(/\s+/).every(word=>`${p.brand} ${p.model}`.toLowerCase().includes(word))&&(c.req.query('pinned')!=='1'||pins.has(p.id)));
  c.header('Cache-Control','private, no-store');
  return c.json({items:items.slice(offset,offset+60).map(p=>({...p,pinned:pins.has(p.id)})),total:items.length,nextOffset:offset+60<items.length?offset+60:null,categories:[...new Set(all.map(p=>p.category))].sort()});
}

// Bounded, revision-aware cache: full-volume health must not depend on a
// database write simply to browse a price chart. At most 20k sale rows retained.
const cache=new Map<number,{revision:string;data:ReturnType<typeof marketCohorts>;rows:number;truncated:boolean}>();
function history(product:MarketProduct) {
  const revision=pricingSignature(db()),existing=cache.get(product.id);
  if(existing?.revision===revision)return existing;
  const rows=db().query(`SELECT id,source,source_item_id,url,raw_title,sold_price_cents,shipping_cents,currency,condition_norm,condition_raw,sold_at,captured_at,raw_json
    FROM comps WHERE sku_id=? ORDER BY sold_at DESC,id DESC LIMIT 20001`).all(product.id) as StoredMarketSale[];
  const entry={revision,data:marketCohorts(product,rows.slice(0,20000)),rows:Math.min(rows.length,20000),truncated:rows.length>20000};
  cache.delete(product.id);
  while(cache.size&&([...cache.values()].reduce((n,c)=>n+c.rows,0)+entry.rows>20000||cache.size>=40))cache.delete(cache.keys().next().value!);
  cache.set(product.id,entry);return entry;
}
export function marketHistory(c:Context) {
  const id=Number(c.req.param('id')),range=(c.req.query('range')??'3m') as MarketRange,condition=(c.req.query('condition')??'used') as MarketCondition,basis=(c.req.query('basis')??'item') as PriceBasis,cohort=c.req.query('cohort');
  if(!Number.isSafeInteger(id)||id<1||!['1m','3m','6m','1y','3y','all'].includes(range)||!['used','new','open_box','refurb'].includes(condition)||!['item','delivered'].includes(basis)||cohort&&!/^[a-f0-9]{20}$/.test(cohort))return c.json({error:'Invalid market history selection.'},400);
  const product=db().query('SELECT id,brand,model,category FROM skus WHERE id=?').get(id) as MarketProduct|null;
  if(!product||!categories.has(catalogCategory(product.category,product.model)))return c.json({error:'Product not found.'},404);
  const {data,truncated}=history(product);
  if(cohort&&!data.cohorts.some(c=>c.key===cohort&&c.sales.some(s=>s.condition===condition)))return c.json({error:'This configuration has no sales in the selected condition. Choose another configuration.'},400);
  const response=marketSeries(product,data.cohorts,{range,condition,basis,cohort,excluded:data.excluded,truncated});
  response.pinned=!!db().query('SELECT 1 FROM market_pins WHERE user_id=? AND sku_id=?').get(currentUser(c)!.id,id);
  c.header('Cache-Control','private, no-store');
  if(c.req.query('format')==='csv') {
    const since=rangeStart(range,Date.now());
    const sales=(data.cohorts.find(c=>c.key===response.selected)?.sales??[]).filter(s=>s.condition===condition&&Date.parse(s.date)>=since&&(basis==='item'||s.shippingCents!==null)).sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id);
    c.header('Content-Disposition',`attachment; filename="filtrsoft-market-${id}-${range}.csv"`);
    return c.body('\uFEFF'+marketCsv(sales,basis),200,{'Content-Type':'text/csv; charset=utf-8'});
  }
  return c.json(response);
}
export async function marketPin(c:Context) {
  const id=Number(c.req.param('id')),owner=currentUser(c)!.id;
  let body:any;try{body=await c.req.json();}catch{return c.json({error:'Invalid pin request.'},400);}
  if(!Number.isSafeInteger(id)||id<1||typeof body?.pinned!=='boolean')return c.json({error:'Invalid pin request.'},400);
  const product=db().query('SELECT id,brand,model,category FROM skus WHERE id=?').get(id) as MarketProduct|null;
  if(!product||!categories.has(catalogCategory(product.category,product.model)))return c.json({error:'Product not found.'},404);
  if(body.pinned){
    if((db().query('SELECT COUNT(*) n FROM market_pins WHERE user_id=?').get(owner) as {n:number}).n>=50&&!db().query('SELECT 1 FROM market_pins WHERE user_id=? AND sku_id=?').get(owner,id))return c.json({error:'You can pin up to 50 products. Unpin one first.'},409);
    db().run('INSERT OR IGNORE INTO market_pins(user_id,sku_id) VALUES(?,?)',[owner,id]);
  }else db().run('DELETE FROM market_pins WHERE user_id=? AND sku_id=?',[owner,id]);
  return c.json({ok:true,pinned:body.pinned});
}
