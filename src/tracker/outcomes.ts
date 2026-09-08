/** Disappearance is an availability observation. Only reported transactions can
 * calibrate sale price or realized profit; the decision is frozen at record time.
 */
import {db,now} from "../db/index.ts";
import {decisionAt,decisionSku} from "../db/learning.ts";
import {outcomes as inferOutcomes} from "./index.ts";

export interface RecordStats {considered:number;recorded:number;skipped:number}
export function recordObservedOutcomes():RecordStats {
  const d=db(),st={considered:0,recorded:0,skipped:0};
  d.transaction(()=>{for(const o of inferOutcomes()){
    st.considered++;
    if(o.signal!=='likely_sold' || d.query("SELECT 1 FROM outcomes WHERE listing_id=? AND action='dead_listing'").get(o.listingId)){st.skipped++;continue;}
    const l=d.query('SELECT delisted_at FROM listings WHERE id=?').get(o.listingId) as {delisted_at:string};
    const decision=decisionAt(o.listingId,null,undefined,l.delisted_at);
    d.run(`INSERT INTO outcomes(listing_id,sku_id,action,observed_ask_cents,days_to_sell,notes,created_at,decision_id,decision_json,evidence_kind)
      VALUES(?,?,'dead_listing',?,?,?,?,?,?,'observed_disappearance')`,
      [o.listingId,decisionSku(decision.payload),o.observedAskingPriceCents,o.daysOnMarket==null?null:Math.round(o.daysOnMarket),o.reason,now(),decision.id,decision.payload]);
    st.recorded++;
  }})();return st;
}
export interface Calibration {call:string;n:number;medianDays:number|null;medianErrorPct:number|null}
const median=(xs:number[])=>{if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b);return s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2;};
export function calibration(userId?:number):Calibration[] {
  const rows=db().query(`SELECT sold_price_cents,days_to_sell,decision_json FROM outcomes
    WHERE evidence_kind IN ('personal_transaction','seller_reported_sale') AND sold_price_cents>0 AND decision_json IS NOT NULL
    AND (? IS NULL OR user_id=?)`).all(userId??null,userId??null) as any[];
  const groups=new Map<string,{n:number;days:number[];errors:number[]}>();
  for(const r of rows){const v=JSON.parse(r.decision_json),call=v.call;
    const b=groups.get(call)??{n:0,days:[],errors:[]};b.n++;
    if(r.days_to_sell!=null)b.days.push(r.days_to_sell);
    if(v.valuation?.medianCents>0)b.errors.push((v.valuation.medianCents-r.sold_price_cents)/r.sold_price_cents*100);
    groups.set(call,b);
  }
  return [...groups].map(([call,b])=>({call,n:b.n,medianDays:median(b.days),medianErrorPct:median(b.errors)}));
}
export function recordReportedOutcome(o:{userId:number;listingId:number;action:'bought'|'passed'|'no_reply'|'was_scam'|'seller_sold';
  purchasePriceCents?:number;soldPriceCents?:number;soldChannel?:string;feesCents?:number;shippingCents?:number;daysToSell?:number;notes?:string;decisionToken?:string}):number {
  for(const value of [o.purchasePriceCents,o.soldPriceCents,o.feesCents,o.shippingCents,o.daysToSell])
    if(value!=null && (!Number.isSafeInteger(value)||value<0))throw new Error('Outcome amounts must be nonnegative integers');
  const decision=decisionAt(o.listingId,o.userId,o.decisionToken);
  const kind=o.action==='seller_sold'?'seller_reported_sale':o.action==='bought' && o.soldPriceCents!=null?'personal_transaction':'personal_report';
  return Number(db().run(`INSERT INTO outcomes(listing_id,user_id,sku_id,action,purchase_price_cents,sold_price_cents,sold_channel,fees_cents,shipping_cents,days_to_sell,notes,created_at,decision_id,decision_json,evidence_kind)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[o.listingId,o.userId,decisionSku(decision.payload),o.action,o.purchasePriceCents??null,o.soldPriceCents??null,o.soldChannel??null,
      o.feesCents??null,o.shippingCents??null,o.daysToSell??null,o.notes??null,now(),decision.id,decision.payload,kind]).lastInsertRowid);
}
/** Unknown transaction costs cannot silently become zero-dollar costs. */
export function realisedMargin(userId?:number):Array<{listingId:number;buyCents:number;sellCents:number;netCents:number;days:number|null}> {
  return (db().query(`SELECT listing_id,purchase_price_cents,sold_price_cents,fees_cents,shipping_cents,days_to_sell FROM outcomes
    WHERE evidence_kind='personal_transaction' AND action='bought' AND purchase_price_cents IS NOT NULL
    AND sold_price_cents IS NOT NULL AND fees_cents IS NOT NULL AND shipping_cents IS NOT NULL AND (? IS NULL OR user_id=?)`).all(userId??null,userId??null) as any[])
    .map(r=>({listingId:r.listing_id,buyCents:r.purchase_price_cents,sellCents:r.sold_price_cents,netCents:r.sold_price_cents-r.purchase_price_cents-r.fees_cents-r.shipping_cents,days:r.days_to_sell}));
}
