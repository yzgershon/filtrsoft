import {db,now} from "../db/index.ts";
import {macbookCompIdentity} from '../catalog/macbook.ts';
import {catalogCoverage} from "../valuation/coverage.ts";
import {matchSku} from "../catalog/match.ts";
import {usableCompSql} from "../db/comp-evidence.ts";
import {detectCategory} from '../signals/index.ts';

export function startCollection(skuId:number|null,query:string):number {
  return Number(db().run("INSERT INTO comp_collection_attempts(sku_id,query,started_at) VALUES(?,?,?)",[skuId,query,now()]).lastInsertRowid);
}
export function finishCollection(id:number,counts:{fetched:number;parsed:number;accepted:number;saved:number;error?:string}) {
  db().run("UPDATE comp_collection_attempts SET finished_at=?,fetched=?,parsed=?,accepted=?,saved=?,error=? WHERE id=? AND finished_at IS NULL",
    [now(),counts.fetched,counts.parsed,counts.accepted,counts.saved,counts.error??null,id]);
}

/** Exact catalog demand is a priority signal, not permission to relax matching.
 * Repeated empty or duplicate-only pulls back off exponentially up to seven days.
 * An interrupted attempt also backs off so a crashing query cannot monopolize chunks.
 */
export function collectionPriority(limit=20,at=Date.now()) {
  const d=db(),demand=new Map<number,number>(),queries=new Map<number,Map<string,number>>();
  const unresolved=d.query(`SELECT l.title,l.description FROM listings l JOIN verdicts v ON v.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id)
    WHERE l.delisted_at IS NULL AND COALESCE(l.posted_at,l.last_seen,l.captured_at)>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-28 days')
    AND v.call='INSUFFICIENT_DATA'`).all() as {title:string;description:string|null}[];
  for(const l of unresolved) {
    const m=matchSku(l.title,l.description??'',detectCategory(l.title,l.description??''));
    if(m.skuId && m.confidence!=='low' && m.category!=='console') {
      demand.set(m.skuId,(demand.get(m.skuId)??0)+1);
      if(m.category==='laptop' && m.attributes.cpu && m.attributes.gpu) {
        const query=[m.brand,m.model,m.attributes.cpu,m.attributes.gpu].join(' ');
        const counts=queries.get(m.skuId)??new Map<string,number>();counts.set(query,(counts.get(query)??0)+1);queries.set(m.skuId,counts);
      }
    }
  }
  const raw=new Map((d.query(`SELECT sku_id,COUNT(*) comps,MAX(CASE WHEN ${usableCompSql()} THEN sold_at END) newest FROM comps GROUP BY sku_id`).all() as {sku_id:number;comps:number;newest:string|null}[]).map(r=>[r.sku_id,r]));
  return catalogCoverage().flatMap(s=>{
    const identity=`${s.brand} ${s.model}`;
    if(!macbookCompIdentity(identity,identity))return [];
    const attempts=d.query('SELECT started_at,finished_at,saved,error FROM comp_collection_attempts WHERE sku_id=? ORDER BY id DESC LIMIT 10').all(s.id) as {started_at:string;finished_at:string|null;saved:number;error:string|null}[];
    let empty=0;for(const a of attempts){if(a.finished_at && a.saved>0 && !a.error)break;empty++;}
    const last=attempts[0],delay=empty?Math.min(7*86400000,3600000*2**(empty-1)):6*3600000;
    if(last && Date.parse(last.started_at)+delay>at)return [];
    const r=raw.get(s.id),age=r?.newest?Math.max(0,(at-Date.parse(r.newest))/86400000):90;
    const demandQuery=[...(queries.get(s.id)??[])].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0];
    return [{...s,demandQuery,comps:r?.comps??0,demand:demand.get(s.id)??0,age,lastAttempt:last?.started_at??'',acceptedYield:last?.saved??0}];
  }).sort((a,b)=>b.demand-a.demand || (a.status==='ok'?1:0)-(b.status==='ok'?1:0) || b.age-a.age
    || a.compCount-b.compCount || a.lastAttempt.localeCompare(b.lastAttempt) || b.acceptedYield-a.acceptedYield || a.id-b.id)
    .slice(0,Math.max(0,Math.min(500,limit)));
}
