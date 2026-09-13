import {randomUUID} from "node:crypto";
import {evidenceHash} from "../engine/provenance.ts";

export class CursorError extends Error {}
type Window={owner:number;hash:string;ids:number[];expires:number};
const windows=new Map<string,Window>();
const MAX_WINDOWS=400,MAX_IDS=500_000;
function remember(id:string,w:Window) {
  const at=Date.now();
  for(const [key,value] of windows)if(value.expires<=at)windows.delete(key);
  const owned=[...windows].filter(([,value])=>value.owner===w.owner);
  while(owned.length>=20)windows.delete(owned.shift()![0]);
  let count=[...windows.values()].reduce((n,value)=>n+value.ids.length,0);
  while(windows.size && (windows.size>=MAX_WINDOWS || count+w.ids.length>MAX_IDS)) {
    const key=windows.keys().next().value!;count-=windows.get(key)!.ids.length;windows.delete(key);
  }
  // A single oversized population remains browsable without an unbounded cache.
  if(w.ids.length<=MAX_IDS)windows.set(id,w);
}
/** Freeze only membership/order. Each page still checks current eligibility and
 * current account labels, so retiring a listing cannot resurrect it from a cache.
 * September 13: a full Railway disk made every feed GET fail while writing its
 * pagination cache. These 30-minute windows are expendable, not user data. Keep
 * a bounded process cache; restart/eviction uses the existing 409-and-refresh path.
 */
export function feedWindow<T extends {id:number}>(current:T[],owner:number,filters:unknown,cursor?:string) {
  const hash=evidenceHash(filters);
  let id:string,ids:number[],start=0;
  if(cursor) {
    const m=cursor.match(/^([a-f0-9-]{36}):(\d+)$/);
    if(!m)throw new CursorError('Invalid feed cursor');
    id=m[1];start=Number(m[2]);
    const row=windows.get(id);
    if(!row || row.owner!==owner || row.hash!==hash || row.expires<=Date.now())throw new CursorError('Feed cursor expired or belongs to a different account/filter');
    ids=row.ids;if(!Number.isSafeInteger(start)||start>ids.length)throw new CursorError('Invalid feed position');
  } else {
    id=randomUUID();ids=current.map(r=>r.id);
    remember(id,{owner,hash,ids,expires:Date.now()+1800000});
  }
  const byId=new Map(current.map(r=>[r.id,r])),positions=new Map(ids.map((id,i)=>[id,i]));
  const scoped=ids.flatMap(id=>byId.has(id)?[byId.get(id)!]:[]);
  return {scoped,page:(filtered:T[],limit:number,offset=0)=>{
    const remaining=filtered.filter(r=>positions.get(r.id)!>=start).slice(cursor?0:offset);
    const items=remaining.slice(0,limit),last=items.at(-1);
    return {items,nextCursor:windows.has(id)&&remaining.length>items.length && last?`${id}:${positions.get(last.id)!+1}`:null};
  }};
}
