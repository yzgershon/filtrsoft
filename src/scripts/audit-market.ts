/** Read the packaged archive directly. Does not open or mutate any database. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {marketCohorts,marketCategory,type StoredMarketSale} from '../market/core.ts';
const archive=JSON.parse(gunzipSync(readFileSync(new URL('../../data/archive.json.gz',import.meta.url))).toString());
const bySku=new Map<string,StoredMarketSale[]>();
for(const [i,row] of archive.comps.entries()){
  const list=bySku.get(row.sku_key)??[];list.push({...row,id:i+1});bySku.set(row.sku_key,list);
}
const products=archive.skus.filter((s:any)=>s.category!=='console').map((sku:any,id:number)=>{
  const rows=bySku.get([sku.category,sku.brand,sku.model].join('|'))??[],result=marketCohorts({...sku,id:id+1},rows);
  const sales=result.cohorts.flatMap(c=>c.sales),dates=sales.map(s=>s.date).sort();
  return {brand:sku.brand,model:sku.model,category:marketCategory(sku.category,sku.model),captured:rows.length,accepted:sales.length,excluded:result.excluded,completeConfigurationSales:result.cohorts.filter(c=>c.complete).reduce((n,c)=>n+c.sales.length,0),cohorts:result.cohorts.length,first:dates[0]??null,last:dates.at(-1)??null};
});
const report={measuredAt:new Date().toISOString(),source:'packaged archive, not production',products:products.length,productsWithSales:products.filter((p:any)=>p.accepted).length,accepted:products.reduce((n:number,p:any)=>n+p.accepted,0),excluded:products.reduce((n:number,p:any)=>n+p.excluded,0),categories:[...new Set(products.map((p:any)=>p.category))].map(category=>({category,products:products.filter((p:any)=>p.category===category).length,withSales:products.filter((p:any)=>p.category===category&&p.accepted).length,accepted:products.filter((p:any)=>p.category===category).reduce((n:number,p:any)=>n+p.accepted,0)})),detail:products};
mkdirSync('docs/qa/market',{recursive:true});writeFileSync('docs/qa/market/archive-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,detail:undefined},null,2));
