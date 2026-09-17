import {db} from './index.ts';
export type Availability={state:'checked'|'unknown'|'stale'|'unchecked'|'gone';checkedAt:string|null};
export function availabilityView(row:{observed_at:string;outcome:string}|undefined,gone=false,at=Date.now()):Availability {
  if(gone||row?.outcome==='gone')return {state:'gone',checkedAt:row?.observed_at??null};
  if(!row)return {state:'unchecked',checkedAt:null};
  if(row.outcome!=='alive')return {state:'unknown',checkedAt:row.observed_at};
  const age=at-Date.parse(row.observed_at);
  return {state:Number.isFinite(age)&&age>=-300000&&age<=6*3600000?'checked':'stale',checkedAt:row.observed_at};
}
export function availabilityMap() {
  return new Map((db().query('SELECT listing_id,observed_at,outcome FROM listing_availability').all() as {listing_id:number;observed_at:string;outcome:string}[]).map(r=>[r.listing_id,r]));
}
