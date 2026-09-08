import {randomUUID} from "node:crypto";
import {db,now} from "../db/index.ts";
import {evidenceHash} from "../engine/provenance.ts";

export class CursorError extends Error {}
/** Freeze only membership/order. Each page still checks current eligibility and
 * current account labels, so retiring a listing cannot resurrect it from a cache.
 */
export function feedWindow<T extends {id:number}>(current:T[],owner:number,filters:unknown,cursor?:string) {
  const d=db(),hash=evidenceHash(filters);
  d.exec(`CREATE TABLE IF NOT EXISTS feed_windows(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,filters_hash TEXT NOT NULL,
    ids TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL);`);
  let id:string,ids:number[],start=0;
  if(cursor) {
    const m=cursor.match(/^([a-f0-9-]{36}):(\d+)$/);
    if(!m)throw new CursorError('Invalid feed cursor');
    id=m[1];start=Number(m[2]);
    const row=d.query('SELECT ids FROM feed_windows WHERE id=? AND user_id=? AND filters_hash=? AND expires_at>?').get(id,owner,hash,now()) as {ids:string}|null;
    if(!row)throw new CursorError('Feed cursor expired or belongs to a different account/filter');
    ids=JSON.parse(row.ids);if(!Number.isSafeInteger(start)||start>ids.length)throw new CursorError('Invalid feed position');
  } else {
    id=randomUUID();ids=current.map(r=>r.id);
    d.transaction(()=>{
      d.run('DELETE FROM feed_windows WHERE expires_at<=?',[now()]);
      d.run('DELETE FROM feed_windows WHERE user_id=? AND id NOT IN (SELECT id FROM feed_windows WHERE user_id=? ORDER BY created_at DESC LIMIT 19)',[owner,owner]);
      d.run('INSERT INTO feed_windows VALUES(?,?,?,?,?,?)',[id,owner,hash,JSON.stringify(ids),now(),new Date(Date.now()+1800000).toISOString()]);
    })();
  }
  const byId=new Map(current.map(r=>[r.id,r])),positions=new Map(ids.map((id,i)=>[id,i]));
  const scoped=ids.flatMap(id=>byId.has(id)?[byId.get(id)!]:[]);
  return {scoped,page:(filtered:T[],limit:number,offset=0)=>{
    const remaining=filtered.filter(r=>positions.get(r.id)!>=start).slice(cursor?0:offset);
    const items=remaining.slice(0,limit),last=items.at(-1);
    return {items,nextCursor:remaining.length>items.length && last?`${id}:${positions.get(last.id)!+1}`:null};
  }};
}
