import {db} from "../db/index.ts";
import {pricingSignature} from "../db/revisions.ts";
import {catalogCategory} from "../catalog/identity.ts";
import {valueSku} from "./index.ts";

let cached:{signature:string;rows:CatalogCoverage[]}|null=null;
export interface CatalogCoverage {id:number;brand:string;model:string;category:string;status:string;compCount:number}
/** Generic used-condition coverage, never proof of a specific listing's configuration. */
export function catalogCoverage():CatalogCoverage[] {
  const d=db(),signature=pricingSignature(d);
  if(cached?.signature===signature)return cached.rows;
  const rows=(d.query("SELECT id,brand,model,category FROM skus WHERE category<>'console'").all() as Omit<CatalogCoverage,'status'|'compCount'>[]).map(s=>{
    const category=catalogCategory(s.category,s.model);
    const v=valueSku(s.id,{category,condition:'used'});
    return {...s,category,status:v.status,compCount:v.compCount};
  });
  cached={signature,rows};return rows;
}
