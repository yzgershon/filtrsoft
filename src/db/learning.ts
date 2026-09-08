import {randomUUID} from "node:crypto";
import type {Database} from "bun:sqlite";
import {db,now} from "./index.ts";

export function installLearning(d:Database) {
  const add=(table:string,columns:Record<string,string>)=>{
    const existing=new Set((d.query(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(r=>r.name));
    for(const [key,type] of Object.entries(columns))if(!existing.has(key))d.exec(`ALTER TABLE ${table} ADD COLUMN ${key} ${type}`);
  };
  for(const table of ['judgments','outcomes','verdict_overrides'])add(table,{decision_id:'INTEGER',decision_json:'TEXT'});
  add('judgments',{user_id:'INTEGER',device_ref:'TEXT'});
  add('outcomes',{evidence_kind:'TEXT',observed_ask_cents:'INTEGER'});
  d.exec(`CREATE TABLE IF NOT EXISTS decision_views(token TEXT PRIMARY KEY,user_id INTEGER,listing_id INTEGER,decision_id INTEGER,payload TEXT NOT NULL,expires_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS decision_view_owner ON decision_views(user_id,listing_id);`);
  // Preserve the old column bytes for undo/audit. The evidence kind prevents
  // a historical inferred ask being reinterpreted as an actual transaction.
  d.run("UPDATE outcomes SET evidence_kind='legacy_disappearance',observed_ask_cents=sold_price_cents WHERE action='dead_listing' AND evidence_kind IS NULL");
}
export function rememberDecision(listingId:number,userId:number|undefined,payload:unknown):string|undefined {
  if(!userId || !payload)return undefined;
  const d=db(),token=randomUUID();
  const v=d.query('SELECT MAX(id) id FROM verdicts WHERE listing_id=?').get(listingId) as {id:number|null};
  d.transaction(()=>{
    d.run('DELETE FROM decision_views WHERE expires_at<=?',[now()]);
    d.run('DELETE FROM decision_views WHERE user_id=? AND token NOT IN (SELECT token FROM decision_views WHERE user_id=? ORDER BY expires_at DESC LIMIT 99)',[userId,userId]);
    d.run('INSERT INTO decision_views VALUES(?,?,?,?,?,?)',[token,userId,listingId,v.id,JSON.stringify(payload),new Date(Date.now()+86400000).toISOString()]);
  })();return token;
}
export function decisionAt(listingId:number,userId:number|null,token?:string,at=now()):{id:number|null;payload:string|null} {
  const d=db();
  if(token){
    const r=d.query('SELECT decision_id id,payload FROM decision_views WHERE token=? AND user_id=? AND listing_id=? AND expires_at>?').get(token,userId,listingId,now()) as {id:number|null;payload:string}|null;
    if(!r)throw new Error('Decision reference expired or belongs to another account/listing');return r;
  }
  return d.query('SELECT id,payload FROM verdicts WHERE listing_id=? AND created_at<=? ORDER BY id DESC LIMIT 1').get(listingId,at) as {id:number;payload:string}|null ?? {id:null,payload:null};
}
export function decisionSku(payload:string|null):number|null {
  try{return JSON.parse(payload??'null')?.provenance?.match?.skuId??null;}catch{return null;}
}
