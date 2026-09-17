import {db,now} from "../db/index.ts";
import {macbookCompIdentity} from '../catalog/macbook.ts';
import {catalogCoverage} from "../valuation/coverage.ts";
import {matchSku} from "../catalog/match.ts";
import {usableCompSql} from "../db/comp-evidence.ts";
import {detectCategory} from '../signals/index.ts';
import {queryForSku} from './ebay.ts';
import {textFacts} from '../signals/factual-text.ts';

export function exactDemandQuery(s:{brand:string;model:string;category:string},a:Record<string,string|number>) {
  const query=queryForSku(s);if(!['laptop','phone','tablet','prebuilt'].includes(s.category))return query;
  const capacity=(n:string|number)=>Number(n)%1024===0?`${Number(n)/1024}TB`:`${n}GB`;
  return [query,...(['laptop','prebuilt'].includes(s.category)?[a.cpu,a.gpu,a.ram_gb?`${a.ram_gb}GB RAM`:null]:[]),a.storage_gb?`${capacity(a.storage_gb)}${['laptop','prebuilt'].includes(s.category)?' SSD':''}`:null,...(s.category==='laptop'?[a.screen_inches?`${a.screen_inches}-inch`:null,a.gpu_cores?`${a.gpu_cores}-core GPU`:null]:[])].filter(Boolean).join(' ');
}
function installDemand(){db().exec(`CREATE TABLE IF NOT EXISTS comp_identity_demand(listing_id INTEGER PRIMARY KEY,state TEXT NOT NULL,reason TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS comp_rejections(attempt_id INTEGER NOT NULL,reason TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(attempt_id,reason));
 CREATE INDEX IF NOT EXISTS comp_attempt_query ON comp_collection_attempts(query,id);`);}

export function startCollection(skuId:number|null,query:string):number {
  return Number(db().run("INSERT INTO comp_collection_attempts(sku_id,query,started_at) VALUES(?,?,?)",[skuId,query,now()]).lastInsertRowid);
}
export function finishCollection(id:number,counts:{fetched:number;parsed:number;accepted:number;saved:number;error?:string;rejections?:Record<string,number>}) {
  installDemand();for(const [reason,n] of Object.entries(counts.rejections??{}))db().run('INSERT OR REPLACE INTO comp_rejections VALUES(?,?,?)',[id,reason,n]);
  db().run("UPDATE comp_collection_attempts SET finished_at=?,fetched=?,parsed=?,accepted=?,saved=?,error=? WHERE id=? AND finished_at IS NULL",
    [now(),counts.fetched,counts.parsed,counts.accepted,counts.saved,counts.error??null,id]);
}

/** Exact catalog demand is a priority signal, not permission to relax matching.
 * Repeated empty or duplicate-only pulls back off exponentially up to seven days.
 * An interrupted attempt also backs off so a crashing query cannot monopolize chunks.
 */
export function collectionPriority(limit=20,at=Date.now()) {
  installDemand();
  const d=db(),demand=new Map<number,number>(),queries=new Map<number,Map<string,number>>();
  const unresolved=d.query(`SELECT l.id,l.title,l.description FROM listings l JOIN verdicts v ON v.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id)
    WHERE l.delisted_at IS NULL AND COALESCE(l.posted_at,l.last_seen,l.captured_at)>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-28 days')
    AND v.call='INSUFFICIENT_DATA'`).all() as {id:number;title:string;description:string|null}[];
  const add=(id:number,query?:string)=>{demand.set(id,(demand.get(id)??0)+1);if(query){const counts=queries.get(id)??new Map<string,number>();counts.set(query,(counts.get(query)??0)+1);queries.set(id,counts);}};
  for(const l of unresolved) {
    const category=detectCategory(l.title,l.description??''),m=matchSku(l.title,l.description??'',category);
    const conflict=textFacts(`${l.title}\n${l.description??''}`).conflicts.length>0;
    const resolved=Boolean(m.skuId&&m.confidence!=='low'&&!conflict);
    const state=resolved?'resolved':'identity-required',reason=conflict?'Conflicting stated specifications':resolved?'Exact catalog identity resolved':'Missing exact catalog identity; no speculative price query';
    d.run('INSERT INTO comp_identity_demand VALUES(?,?,?,?) ON CONFLICT(listing_id) DO UPDATE SET state=excluded.state,reason=excluded.reason,updated_at=excluded.updated_at WHERE state!=excluded.state OR reason!=excluded.reason',[l.id,state,reason,new Date(at).toISOString()]);
    if(conflict)continue;
    if(m.skuId && m.confidence!=='low' && m.category!=='console') {
      add(m.skuId,['laptop','phone','tablet','prebuilt'].includes(m.category??'')?exactDemandQuery({brand:m.brand??'',model:m.model??'',category:m.category!},m.attributes):undefined);
    }
    if(category==='prebuilt'){
      for(const [field,cat] of [['cpu','component'],['gpu','gpu']] as const){const value=m.attributes[field];if(!value)continue;const part=matchSku(String(value),'',cat);if(part.skuId&&part.confidence!=='low')add(part.skuId);}
      const build=d.query("SELECT id,brand,model,category FROM skus WHERE category='prebuilt' AND LOWER(model)=LOWER(?)").get(`Gaming PC ${m.attributes.gpu??''}`) as {id:number;brand:string;model:string;category:string}|null;
      if(build&&['cpu','gpu','ram_gb','storage_gb'].every(k=>m.attributes[k]!=null))add(build.id,exactDemandQuery(build,m.attributes));
    }
  }
  const raw=new Map((d.query(`SELECT sku_id,COUNT(*) comps,MAX(CASE WHEN ${usableCompSql()} THEN sold_at END) newest FROM comps GROUP BY sku_id`).all() as {sku_id:number;comps:number;newest:string|null}[]).map(r=>[r.sku_id,r]));
  return catalogCoverage().flatMap(s=>{
    const identity=`${s.brand} ${s.model}`;
    if(!macbookCompIdentity(identity,identity))return [];
    const choices=[...(queries.get(s.id)?.keys()??[])];
    return (choices.length?choices:[undefined]).flatMap(demandQuery=>{
    const attempts=d.query(`SELECT started_at,finished_at,saved,error FROM comp_collection_attempts WHERE ${demandQuery?'query=?':'sku_id=?'} ORDER BY id DESC LIMIT 10`).all(demandQuery??s.id) as {started_at:string;finished_at:string|null;saved:number;error:string|null}[];
    let empty=0;for(const a of attempts){if(a.finished_at && a.saved>0 && !a.error)break;empty++;}
    const last=attempts[0],delay=empty?Math.min(7*86400000,3600000*2**(empty-1)):6*3600000;
    if(last && Date.parse(last.started_at)+delay>at)return [];
    const r=raw.get(s.id),age=r?.newest?Math.max(0,(at-Date.parse(r.newest))/86400000):90;
    const n=demandQuery?(queries.get(s.id)?.get(demandQuery)??0):(demand.get(s.id)??0);
    const waiting=last?Math.max(0,(at-Date.parse(last.started_at))/86400000):0;
    return [{...s,demandQuery,comps:r?.comps??0,demand:n,age,lastAttempt:last?.started_at??'',acceptedYield:last?.saved??0,priority:Math.min(10,n)*2+waiting}];
    });
  }).sort((a,b)=>b.priority-a.priority || (a.status==='ok'?1:0)-(b.status==='ok'?1:0) || b.age-a.age
    || a.compCount-b.compCount || a.lastAttempt.localeCompare(b.lastAttempt) || b.acceptedYield-a.acceptedYield || a.id-b.id)
    .slice(0,Math.max(0,Math.min(500,limit)));
}
