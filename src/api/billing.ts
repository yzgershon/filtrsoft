/** Billing stays disabled until configured. Account identity comes from the
 * session; webhook event order never substitutes for current provider state.
 */
import type {Context} from "hono";
import Stripe from "stripe";
import {randomUUID,createHash} from "node:crypto";
import {z} from "zod";
import {db,now} from "../db/index.ts";
import {currentUser,ownsDevice} from "./auth.ts";
const KEY=()=>(process.env.STRIPE_SECRET_KEY??'').trim();
const PRICE=()=>(process.env.STRIPE_PRICE_ID??'').trim();
const WHSEC=()=>(process.env.STRIPE_WEBHOOK_SECRET??'').trim();
const SITE=()=>(process.env.FILTRSOFT_SITE_URL??'https://filtrsoft.com').replace(/\/$/,'');
export const billingEnabled=()=>Boolean(KEY()&&PRICE());
let client:Stripe|null=null;
const stripe=()=>client??=new Stripe(KEY(),{apiVersion:'2025-08-27.basil' as Stripe.LatestApiVersion,timeout:20000,maxNetworkRetries:0});
export function ensureBillingTables(){
  db().exec(`CREATE TABLE IF NOT EXISTS entitlements(ref TEXT PRIMARY KEY,customer_id TEXT,subscription_id TEXT,status TEXT NOT NULL,current_period_end TEXT,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS billing_accounts(user_id INTEGER PRIMARY KEY,customer_id TEXT UNIQUE,create_key TEXT NOT NULL UNIQUE,checkout_key TEXT NOT NULL,checkout_started_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS billing_events(event_id TEXT PRIMARY KEY,event_type TEXT NOT NULL,customer_id TEXT,event_hash TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,received_at TEXT NOT NULL,processed_at TEXT);
    CREATE TABLE IF NOT EXISTS billing_locks(customer_id TEXT PRIMARY KEY,token TEXT NOT NULL,lease_until TEXT NOT NULL);`);
}
const accountRef=(id:number)=>`account:${id}`;
const owner=(id:number)=>ownsDevice(id,(process.env.FILTRSOFT_OWNER_REF??'').trim());
export function entitlementFor(userId:number){
  if(owner(userId))return {active:true,status:'owner',until:null};
  ensureBillingTables();
  const r=db().query('SELECT status,current_period_end FROM entitlements WHERE ref=?').get(accountRef(userId)) as {status:string;current_period_end:string|null}|null;
  return {active:Boolean(r && ['active','trialing'].includes(r.status) && r.current_period_end && r.current_period_end>now()),status:r?.status??'none',until:r?.current_period_end??null};
}
export function handleBillingStatus(c:Context){
  const user=currentUser(c);if(!user)return c.json({error:'sign in required'},401);
  const ref=c.req.query('ref');if(ref && !ownsDevice(user.id,ref))return c.json({error:'device does not belong to this account'},403);
  const e=entitlementFor(user.id),isOwner=e.status==='owner';
  return c.json({enabled:billingEnabled(),plan:isOwner?'owner':e.active?'pro':'free',owner:isOwner,...e});
}
const input=z.object({ref:z.string().min(8).max(64).optional()}).strict();
async function accountRequest(c:Context){
  const user=currentUser(c);if(!user)return {error:c.json({error:'sign in required'},401)};
  const body=input.safeParse(await c.req.json().catch(()=>null));
  if(!body.success)return {error:c.json({error:'Invalid billing input'},400)};
  if(body.data.ref && !ownsDevice(user.id,body.data.ref))return {error:c.json({error:'device does not belong to this account'},403)};
  return {user};
}
export interface CurrentSubscription {id:string;customerId:string;status:string;periodEnd:number|null;priceIds:string[]}
export type SubscriptionReader=(customerId:string)=>Promise<CurrentSubscription[]>;
async function subscriptions(customerId:string):Promise<CurrentSubscription[]> {
  const rows=await stripe().subscriptions.list({customer:customerId,status:'all',limit:100}).autoPagingToArray({limit:1000});
  if(rows.length>=1000)throw new Error('Subscription history exceeds safe reconciliation limit');
  return rows.map(s=>({id:s.id,customerId:typeof s.customer==='string'?s.customer:s.customer.id,status:s.status,
    periodEnd:((s as any).current_period_end??Math.max(0,...s.items.data.filter(i=>i.price.id===PRICE()).map(i=>(i as any).current_period_end??0)))||null,
    priceIds:s.items.data.map(i=>i.price.id)}));
}
async function boundedRead(read:SubscriptionReader,customerId:string){
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([read(customerId),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Subscription reconciliation timed out')),25000);})]);}
  finally{if(timer)clearTimeout(timer);}
}
const activeSubscription=(rows:CurrentSubscription[])=>rows.filter(s=>['active','trialing'].includes(s.status)&&s.priceIds.includes(PRICE())&&s.periodEnd!=null&&s.periodEnd>Date.now()/1000).sort((a,b)=>b.periodEnd!-a.periodEnd!)[0];
const relevant=new Set(['checkout.session.completed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','customer.subscription.paused','customer.subscription.resumed','invoice.paid','invoice.payment_failed']);

/** A bounded per-customer lease serializes reconciliation; a fencing token
 * prevents a timed-out older request from committing over its successor.
 * See https://docs.stripe.com/webhooks#event-ordering .
 */
export async function processBillingEvent(event:{id:string;type:string;data:{object:any}},read:SubscriptionReader=subscriptions) {
  ensureBillingTables();const d=db(),object=event.data.object;
  const customerId=typeof object.customer==='string'?object.customer:object.customer?.id??null;
  const hash=createHash('sha256').update(JSON.stringify({type:event.type,customerId,objectId:object.id??null})).digest('hex');
  d.run("INSERT OR IGNORE INTO billing_events(event_id,event_type,customer_id,event_hash,status,received_at) VALUES(?,?,?,?,'pending',?)",[event.id,event.type,customerId,hash,now()]);
  const previous=d.query('SELECT status,event_hash FROM billing_events WHERE event_id=?').get(event.id) as {status:string;event_hash:string};
  if(previous.event_hash!==hash)throw new Error('Conflicting event identity');
  if(previous.status==='done')return {duplicate:true};
  if(!relevant.has(event.type)){d.run("UPDATE billing_events SET status='done',processed_at=? WHERE event_id=?",[now(),event.id]);return {ignored:true};}
  d.run("UPDATE billing_events SET attempts=attempts+1 WHERE event_id=? AND status<>'done'",[event.id]);
  const token=randomUUID();let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    if(!PRICE())throw new Error('Billing price is not configured');
    if(!customerId)throw new Error('Missing customer reference');
    const account=d.query('SELECT user_id FROM billing_accounts WHERE customer_id=?').get(customerId) as {user_id:number}|null;
    // Never claim a customer using a client_reference_id supplied by old clients.
    if(!account)throw new Error('Customer has no verified local account binding');
    const acquired=d.run(`INSERT INTO billing_locks VALUES(?,?,?) ON CONFLICT(customer_id) DO UPDATE SET token=excluded.token,lease_until=excluded.lease_until WHERE billing_locks.lease_until<=?`,
      [customerId,token,new Date(Date.now()+60000).toISOString(),now()]);
    if(!acquired.changes)throw new Error('Customer reconciliation already running');
    d.run("UPDATE billing_events SET status='processing',last_error=NULL WHERE event_id=? AND status<>'done'",[event.id]);
    const rows=await Promise.race([read(customerId),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Subscription reconciliation timed out')),25000);})]);
    if(rows.some(s=>s.customerId!==customerId))throw new Error('Provider customer mismatch');
    const active=activeSubscription(rows);
    const status=active?.status??'inactive',end=active?.periodEnd?new Date(active.periodEnd*1000).toISOString():null;
    d.transaction(()=>{
      if(!d.query('SELECT 1 FROM billing_locks WHERE customer_id=? AND token=? AND lease_until>?').get(customerId,token,now()))throw new Error('Reconciliation lease expired');
      d.run(`INSERT INTO entitlements(ref,customer_id,subscription_id,status,current_period_end,updated_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(ref) DO UPDATE SET customer_id=excluded.customer_id,subscription_id=excluded.subscription_id,status=excluded.status,current_period_end=excluded.current_period_end,updated_at=excluded.updated_at`,
        [accountRef(account.user_id),customerId,active?.id??null,status,end,now()]);
      d.run("UPDATE billing_events SET status='done',processed_at=?,last_error=NULL WHERE event_id=?",[now(),event.id]);
    })();return {reconciled:true};
  } catch(e){
    d.run("UPDATE billing_events SET status='retry',last_error=? WHERE event_id=? AND status<>'done'",[(e as Error).message.slice(0,500),event.id]);throw e;
  } finally {if(timer)clearTimeout(timer);if(customerId)d.run('DELETE FROM billing_locks WHERE customer_id=? AND token=?',[customerId,token]);}
}

/** Factory keeps transport tests synthetic without a production bypass flag. */
export function billingRoutes(getClient:()=>Pick<Stripe,'customers'|'checkout'|'billingPortal'|'webhooks'>=stripe,read:SubscriptionReader=subscriptions){
  return {
    checkout:async(c:Context)=>{
      const request=await accountRequest(c);if(request.error)return request.error;
      if(!billingEnabled())return c.json({error:'billing is not configured'},503);
      const user=request.user!;ensureBillingTables();
      if(entitlementFor(user.id).active)return c.json({error:'This account already has access'},409);
      try {
        const d=db();d.run('INSERT OR IGNORE INTO billing_accounts(user_id,create_key,checkout_key,checkout_started_at) VALUES(?,?,?,?)',[user.id,randomUUID(),randomUUID(),now()]);
        let account=d.query('SELECT * FROM billing_accounts WHERE user_id=?').get(user.id) as any;
        if(!account.customer_id){
          const customer=await getClient().customers.create({metadata:{filtrsoft_user_id:String(user.id)}},{idempotencyKey:account.create_key});
          d.run('UPDATE billing_accounts SET customer_id=? WHERE user_id=? AND customer_id IS NULL',[customer.id,user.id]);
          account=d.query('SELECT * FROM billing_accounts WHERE user_id=?').get(user.id);
          if(account.customer_id!==customer.id)throw new Error('Customer binding conflict');
        }
        // Reconcile the remote state before offering a second subscription when a
        // completed checkout's webhook has not arrived yet. Fail closed on outages.
        const existing=await boundedRead(read,account.customer_id);
        if(existing.some(s=>s.customerId!==account.customer_id))throw new Error('Provider customer mismatch');
        if(activeSubscription(existing))return c.json({error:'This account already has an active subscription'},409);
        if(Date.parse(account.checkout_started_at)+86400000<Date.now()){
          d.run('UPDATE billing_accounts SET checkout_key=?,checkout_started_at=? WHERE user_id=? AND checkout_key=?',[randomUUID(),now(),user.id,account.checkout_key]);
          account=d.query('SELECT * FROM billing_accounts WHERE user_id=?').get(user.id);
        }
        const session=await getClient().checkout.sessions.create({mode:'subscription',customer:account.customer_id,
          line_items:[{price:PRICE(),quantity:1}],client_reference_id:accountRef(user.id),subscription_data:{metadata:{filtrsoft_user_id:String(user.id)}},
          allow_promotion_codes:true,success_url:SITE()+'/?paid=1',cancel_url:SITE()+'/'},{idempotencyKey:account.checkout_key+':'+PRICE()});
        return c.json({url:session.url});
      }catch{return c.json({error:'could not start checkout; retry safely'},502);}
    },
    portal:async(c:Context)=>{
      const request=await accountRequest(c);if(request.error)return request.error;
      if(!billingEnabled())return c.json({error:'billing is not configured'},503);
      ensureBillingTables();const row=db().query('SELECT customer_id FROM billing_accounts WHERE user_id=?').get(request.user!.id) as {customer_id:string|null}|null;
      if(!row?.customer_id)return c.json({error:'no subscription on this account'},404);
      try {const session=await getClient().billingPortal.sessions.create({customer:row.customer_id,return_url:SITE()+'/'});return c.json({url:session.url});}
      catch{return c.json({error:'could not open the billing portal'},502);}
    },
    webhook:async(c:Context)=>{
      if(!billingEnabled()||!WHSEC())return c.json({error:'billing is not configured'},503);
      const signature=c.req.header('stripe-signature');if(!signature)return c.json({error:'missing signature'},400);
      let event:Stripe.Event;
      try{event=await getClient().webhooks.constructEventAsync(await c.req.text(),signature,WHSEC());}
      catch{return c.json({error:'bad signature'},400);}
      try{return c.json({received:true,...await processBillingEvent(event,read)});}
      catch{return c.json({error:'billing reconciliation pending retry'},503);}
    },
  };
}
const routes=billingRoutes();
export const handleCheckout=routes.checkout,handlePortal=routes.portal,handleWebhook=routes.webhook;
