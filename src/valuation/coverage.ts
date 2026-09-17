import {db} from "../db/index.ts";
import {pricingSignature} from "../db/revisions.ts";
import {catalogCategory} from "../catalog/identity.ts";
import {valueSku} from "./index.ts";

let cached:{signature:string;rows:CatalogCoverage[]}|null=null;
let pending:{work:Promise<{signature:string;rows:CatalogCoverage[]}>}|null=null;
export interface CatalogCoverage {id:number;brand:string;model:string;category:string;status:string;compCount:number}
function coverageRow(s:Omit<CatalogCoverage,'status'|'compCount'>):CatalogCoverage {
  const category=catalogCategory(s.category,s.model);
  const v=valueSku(s.id,{category,condition:'used'});
  return {...s,category,status:v.status,compCount:v.compCount};
}
/** Generic used-condition coverage, never proof of a specific listing's configuration. */
export function catalogCoverage():CatalogCoverage[] {
  const d=db(),signature=pricingSignature(d);
  if(cached?.signature===signature)return cached.rows;
  const rows=(d.query("SELECT id,brand,model,category FROM skus WHERE category<>'console'").all() as Omit<CatalogCoverage,'status'|'compCount'>[]).map(coverageRow);
  cached={signature,rows};return rows;
}

/** The cold 561-SKU audit took 11.84 seconds on September 17. A health probe
 * must yield while measuring the catalog instead of stopping every HTTP route.
 * Share a refresh between readers; changed facts invalidate the saved signature.
 */
export async function catalogCoverageAsync(yieldAfterMs=20):Promise<{signature:string;rows:CatalogCoverage[]}> {
  const d=db(),signature=pricingSignature(d);
  if(cached?.signature===signature)return cached;
  if(pending)return pending.work;
  const work=(async()=>{
    const skus=d.query("SELECT id,brand,model,category FROM skus WHERE category<>'console'").all() as Omit<CatalogCoverage,'status'|'compCount'>[];
    const rows:CatalogCoverage[]=[];let started=performance.now();
    for(const sku of skus) {
      rows.push(coverageRow(sku));
      if(performance.now()-started>=yieldAfterMs){await new Promise(resolve=>setTimeout(resolve,0));started=performance.now();}
    }
    cached={signature,rows};return cached;
  })();
  pending={work};
  try{return await work;}finally{if(pending?.work===work)pending=null;}
}
