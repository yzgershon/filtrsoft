import type { Context } from "hono";
import { db } from "../db/index.ts";
import { currentUser } from "./auth.ts";
import { transactionProfit } from "../tracker/outcomes.ts";
import {z} from 'zod';
import {now} from '../db/index.ts';

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
    EXISTS(SELECT 1 FROM listing_rechecks q WHERE q.listing_id=l.id) recheck_pending,
    EXISTS(SELECT 1 FROM listing_thumbs t WHERE t.listing_id=l.id) has_thumb,
    (SELECT url FROM listing_photos p WHERE p.listing_id=l.id ORDER BY position LIMIT 1) thumb
    FROM outcomes o JOIN listings l ON l.id=o.listing_id
    LEFT JOIN verdicts v ON v.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id)
    WHERE o.action='bought' AND o.user_id=? ORDER BY o.created_at DESC,o.id DESC LIMIT 200`).all(user.id) as any[];
  const total=(db().query("SELECT COUNT(*) n FROM outcomes WHERE action='bought' AND user_id=?").get(user.id) as {n:number}).n;
  const items=rows.map(r=>{
    const current=r.recheck_pending?null:decision(r.current_payload), frozen=decision(r.decision_json);
    const paid=r.purchase_price_cents, worth=estimatedProceeds(current);
    return {
      id:r.id,listingId:r.listing_id,title:r.title,url:r.url,source:r.source,location:r.location,
      thumb:r.has_thumb?`/v1/thumb/${r.listing_id}`:r.thumb??null,askingPriceCents:r.asking_price_cents,
      paidCents:paid,worthCents:worth,marginCents:paid!=null&&worth!=null?worth-paid:null,
      engineCall:frozen?.call??null,currentEngineCall:r.recheck_pending?null:r.current_call??null,decisionWorthCents:estimatedProceeds(frozen),
      soldPriceCents:r.sold_price_cents,soldChannel:r.sold_channel,soldAt:r.sold_at,
      feesCents:r.fees_cents,shippingCents:r.shipping_cents,otherCostsCents:r.other_costs_cents,
      revision:r.transaction_revision,updatedAt:r.transaction_updated_at,
      realizedProfitCents:transactionProfit(r),notes:r.notes,boughtAt:r.created_at,
    };
  });
  const paid=items.filter(i=>i.paidCents!=null), valued=items.filter(i=>i.worthCents!=null), paired=items.filter(i=>i.marginCents!=null);
  const complete=items.filter(i=>i.realizedProfitCents!=null);
  const inventory=items.filter(i=>i.soldPriceCents==null);
  return c.json({items,total,limit:200,summary:{count:items.length,
    inventory:{count:inventory.length,paidKnownCount:inventory.filter(i=>i.paidCents!=null).length,
      paidCents:sumKnown(inventory.map(i=>i.paidCents)),worthCents:sumKnown(inventory.map(i=>i.worthCents)),
      valueKnownCount:inventory.filter(i=>i.worthCents!=null).length},
    spentCents:sumKnown(items.map(i=>i.paidCents)),paidKnownCount:paid.length,paidMissingCount:items.length-paid.length,
    worthCents:sumKnown(items.map(i=>i.worthCents)),estimatedValueKnownCount:valued.length,
    marginCents:sumKnown(items.map(i=>i.marginCents)),estimatedDifferenceCount:paired.length,
    realizedProfitCents:sumKnown(items.map(i=>i.realizedProfitCents)),completeSaleCount:complete.length,
    incompleteSaleCount:items.filter(i=>i.soldPriceCents!=null&&i.realizedProfitCents==null).length,
  }});
}

const cents=z.number().int().min(0).max(100000000).nullable();
const transactionInput=z.object({revision:z.number().int().min(0),paidCents:cents,soldPriceCents:cents,
  feesCents:cents,shippingCents:cents,otherCostsCents:cents,
  soldChannel:z.enum(['facebook','craigslist','offerup','mercari','ebay','other']).nullable(),
  soldAt:z.iso.date().nullable(),notes:z.string().max(4000)}).strict();

/** Editing an outcome never overwrites the decision captured when it was bought.
 * A revision fence prevents two devices from silently losing a sale correction. */
export async function handleUpdatePurchase(c:Context) {
  const user=currentUser(c);if(!user)return c.json({error:'Sign in required'},401);
  const id=Number(c.req.param('id'));if(!Number.isSafeInteger(id)||id<1)return c.json({error:'Invalid purchase'},400);
  const p=transactionInput.safeParse(await c.req.json().catch(()=>null));
  if(!p.success)return c.json({error:'Use valid dates and dollar amounts with at most two decimal places.'},400);
  const b=p.data;
  if(b.soldAt&&b.soldAt>now().slice(0,10))return c.json({error:'The sale date cannot be in the future.'},400);
  if(b.soldPriceCents!==null&&(!b.soldAt||!b.soldChannel))return c.json({error:'Add the sale date and marketplace.'},400);
  if(b.soldPriceCents===null&&(b.soldAt!==null||b.soldChannel!==null))return c.json({error:'Add the sale amount or clear the sale details.'},400);
  const result=db().transaction(()=>{
    const row=db().query("SELECT * FROM outcomes WHERE id=? AND user_id=? AND action='bought'").get(id,user.id) as any;
    if(!row)return {error:'Purchase not found',status:404} as const;
    if(row.transaction_revision!==b.revision)return {error:'This purchase changed on another screen. Reload before saving.',status:409} as const;
    const at=now(),revision=b.revision+1;
    db().run(`UPDATE outcomes SET purchase_price_cents=?,sold_price_cents=?,sold_channel=?,sold_at=?,fees_cents=?,shipping_cents=?,other_costs_cents=?,
      notes=?,evidence_kind=?,transaction_revision=?,transaction_updated_at=?,days_to_sell=NULL WHERE id=? AND user_id=?`,[
      b.paidCents,b.soldPriceCents,b.soldChannel,b.soldAt,b.feesCents,b.shippingCents,b.otherCostsCents,b.notes,
      b.soldPriceCents===null?'personal_report':'personal_transaction',revision,at,id,user.id]);
    const after=db().query('SELECT * FROM outcomes WHERE id=?').get(id) as any;
    db().run('INSERT INTO outcome_revisions(outcome_id,user_id,revision,before_json,after_json,created_at) VALUES(?,?,?,?,?,?)',[
      id,user.id,revision,JSON.stringify(row),JSON.stringify(after),at]);
    return {id,revision,realizedProfitCents:transactionProfit(after)};
  })();
  return 'error' in result?c.json({error:result.error},result.status):c.json(result);
}
