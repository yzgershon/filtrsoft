import type { Context } from "hono";
import { db } from "../db/index.ts";
import { currentUser } from "./auth.ts";
import { transactionProfit } from "../tracker/outcomes.ts";

function decision(raw: string | null): any {
  try { const v=JSON.parse(raw ?? "null"); return v && typeof v === "object" ? v : null; } catch { return null; }
}
function estimatedProceeds(v: any): number | null {
  const local=Array.isArray(v?.channels) ? v.channels.find((c:any)=>c.channel === "facebook" && c.available) : null;
  const value=local?.netCents ?? v?.valuation?.medianCents;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
const sumKnown=(values:Array<number|null>)=>{const known=values.filter((v):v is number=>v!==null);return known.length?known.reduce((a,b)=>a+b,0):null;};

/** Reports recorded money independently of seller asks and later estimates.
 * Legacy missing decision evidence remains missing; it cannot be reconstructed
 * from the newest verdict without inventing what was known at purchase time. */
export function handlePurchases(c: Context) {
  const user=currentUser(c); if(!user)return c.json({error:"sign in required"},401);
  const rows=db().query(`SELECT o.*,l.title,l.url,l.source,l.location,l.asking_price_cents,
    v.call current_call,v.payload current_payload,
    EXISTS(SELECT 1 FROM listing_thumbs t WHERE t.listing_id=l.id) has_thumb,
    (SELECT url FROM listing_photos p WHERE p.listing_id=l.id ORDER BY position LIMIT 1) thumb
    FROM outcomes o JOIN listings l ON l.id=o.listing_id
    LEFT JOIN verdicts v ON v.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id)
    WHERE o.action='bought' AND o.user_id=? ORDER BY o.created_at DESC,o.id DESC LIMIT 200`).all(user.id) as any[];
  const total=(db().query("SELECT COUNT(*) n FROM outcomes WHERE action='bought' AND user_id=?").get(user.id) as {n:number}).n;
  const items=rows.map(r=>{
    const current=decision(r.current_payload), frozen=decision(r.decision_json);
    const paid=r.purchase_price_cents, worth=estimatedProceeds(current);
    return {
      id:r.id,listingId:r.listing_id,title:r.title,url:r.url,source:r.source,location:r.location,
      thumb:r.has_thumb?`/v1/thumb/${r.listing_id}`:r.thumb??null,askingPriceCents:r.asking_price_cents,
      paidCents:paid,worthCents:worth,marginCents:paid!=null&&worth!=null?worth-paid:null,
      engineCall:frozen?.call??null,currentEngineCall:r.current_call??null,decisionWorthCents:estimatedProceeds(frozen),
      soldPriceCents:r.sold_price_cents,soldChannel:r.sold_channel,soldAt:r.sold_at,
      feesCents:r.fees_cents,shippingCents:r.shipping_cents,
      realizedProfitCents:transactionProfit(r),notes:r.notes,boughtAt:r.created_at,
    };
  });
  const paid=items.filter(i=>i.paidCents!=null), valued=items.filter(i=>i.worthCents!=null), paired=items.filter(i=>i.marginCents!=null);
  const complete=items.filter(i=>i.realizedProfitCents!=null);
  return c.json({items,total,limit:200,summary:{count:items.length,
    spentCents:sumKnown(items.map(i=>i.paidCents)),paidKnownCount:paid.length,paidMissingCount:items.length-paid.length,
    worthCents:sumKnown(items.map(i=>i.worthCents)),estimatedValueKnownCount:valued.length,
    marginCents:sumKnown(items.map(i=>i.marginCents)),estimatedDifferenceCount:paired.length,
    realizedProfitCents:sumKnown(items.map(i=>i.realizedProfitCents)),completeSaleCount:complete.length,
    incompleteSaleCount:items.filter(i=>i.soldPriceCents!=null&&i.realizedProfitCents==null).length,
  }});
}
