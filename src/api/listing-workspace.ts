import {createHash} from 'node:crypto';
import type {Context} from 'hono';
import {z} from 'zod';
import {db,now} from '../db/index.ts';
import {currentUser} from './auth.ts';

const idOf=(c:Context)=>Number(c.req.param('id'));
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const status=z.enum(['pending','passed','failed','not_tested']);
const input=z.object({revision:z.number().int().min(0),basis:z.string().length(64),notes:z.string().max(4000),
  answers:z.array(z.object({id:z.string().max(64),state:status,note:z.string().max(500)}).strict()).max(50)}).strict();
type Check={id:string;label:string;question:string;evidence:string|null;engineState:string|null};
type Answer={id:string;state:z.infer<typeof status>;note:string};
const baseChecks:Omit<Check,'id'>[]=[
  {label:'Exact hardware',question:'Match the actual model, capacity and configuration to the listing.',evidence:null,engineState:null},
  {label:'Condition and function',question:'Inspect physical condition and test the functions you need before payment.',evidence:null,engineState:null},
  {label:'Included items',question:'Confirm the included parts, charger, cables and accessories.',evidence:null,engineState:null},
];
function inspectView(userId:number,id:number) {
  const d=db(),listing=d.query('SELECT title,description,asking_price_cents FROM listings WHERE id=?').get(id) as any;
  if(!listing)return null;
  const photos=d.query('SELECT url FROM listing_photos WHERE listing_id=? ORDER BY position,url').all(id) as {url:string}[];
  const identity=[listing.title,listing.description,photos.map(p=>p.url)];
  const row=d.query('SELECT * FROM listing_inspections WHERE user_id=? AND listing_id=?').get(userId,id) as any;
  const verdict=d.query('SELECT payload FROM verdicts WHERE listing_id=? ORDER BY id DESC LIMIT 1').get(id) as {payload:string}|null;
  let evidenceUpdating=!!d.query('SELECT 1 FROM listing_rechecks WHERE listing_id=?').get(id);
  let risks:any[]=[];try{const v=JSON.parse(verdict?.payload??'null');
    if(v?.provenance?.facts&&(v.provenance.facts.title!==listing.title||v.provenance.facts.description!==listing.description))evidenceUpdating=true;
    if(!evidenceUpdating&&Array.isArray(v?.riskChecks))risks=v.riskChecks;
  }catch{}
  const definitions=[...risks.filter(r=>r&&typeof r.label==='string'&&typeof r.question==='string').slice(0,40).map(r=>({
    label:r.label,question:r.question,evidence:typeof r.evidence==='string'?r.evidence:null,engineState:typeof r.state==='string'?r.state:null,
  })),...baseChecks];
  const checks:Check[]=[...new Map(definitions.map(c=>{const id=digest([identity,c]);return [id,{...c,id}] as const;})).values()];
  let answers:Answer[]=[];try{const a=JSON.parse(row?.answers_json??'[]');if(Array.isArray(a))answers=a;}catch{}
  // The identity includes the question AND its evidence. A changed lock claim
  // cannot inherit yesterday's tick. Old answers remain in the revision ledger.
  const basis=digest([identity,listing.asking_price_cents,checks]);
  const known=new Map(answers.map(a=>[a.id,a]));
  return {ownerId:userId,listingId:id,revision:row?.revision??0,basis,notes:row?.notes??'',updatedAt:row?.updated_at??null,evidenceUpdating,
    staleAnswerCount:answers.filter(a=>!checks.some(c=>c.id===a.id)&&a.state!=='pending').length,
    checks:checks.map(c=>({...c,state:known.get(c.id)?.state??'pending',note:known.get(c.id)?.note??''}))};
}
export function handleInspection(c:Context) {
  const user=currentUser(c);if(!user)return c.json({error:'Sign in required'},401);
  const id=idOf(c);if(!Number.isSafeInteger(id)||id<1)return c.json({error:'Invalid listing'},400);
  const view=inspectView(user.id,id);return view?c.json(view):c.json({error:'Listing not found'},404);
}
export async function saveInspection(c:Context) {
  const user=currentUser(c);if(!user)return c.json({error:'Sign in required'},401);
  const id=idOf(c);if(!Number.isSafeInteger(id)||id<1)return c.json({error:'Invalid listing'},400);
  const parsed=input.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)return c.json({error:'Check the notes and inspection answers.'},400);
  const b=parsed.data;
  const result=db().transaction(()=>{
    const current=inspectView(user.id,id);if(!current)return {error:'Listing not found',status:404} as const;
    if(current.revision!==b.revision||current.basis!==b.basis)return {error:'This inspection or listing changed. Reload it before saving.',status:409} as const;
    const ids=new Set(current.checks.map(c=>c.id));
    if(b.answers.length!==ids.size||new Set(b.answers.map(a=>a.id)).size!==ids.size||b.answers.some(a=>!ids.has(a.id)))return {error:'The inspection questions changed. Reload them.',status:400} as const;
    const at=now(),revision=current.revision+1;
    db().run(`INSERT INTO listing_inspections VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,listing_id) DO UPDATE SET
      revision=excluded.revision,notes=excluded.notes,answers_json=excluded.answers_json,updated_at=excluded.updated_at`,[user.id,id,revision,b.notes,JSON.stringify(b.answers),at]);
    db().run('INSERT INTO inspection_revisions(user_id,listing_id,revision,payload,created_at) VALUES(?,?,?,?,?)',[user.id,id,revision,JSON.stringify({before:current,after:b}),at]);
    return {view:inspectView(user.id,id)};
  })();
  return 'error' in result?c.json({error:result.error},result.status):c.json(result.view);
}

/** Observed seller asks, not a transaction history. No synthetic baseline is
 * created at read time when an older listing has no observations. */
export function handlePriceHistory(c:Context) {
  if(!currentUser(c))return c.json({error:'Sign in required'},401);
  const id=idOf(c),before=c.req.query('before');
  if(!Number.isSafeInteger(id)||id<1||before!==undefined&&(!/^\d+$/.test(before)||!Number.isSafeInteger(Number(before))||Number(before)<1))return c.json({error:'Invalid history cursor'},400);
  const l=db().query('SELECT captured_at,last_seen,delisted_at,delist_reason,asking_price_cents FROM listings WHERE id=?').get(id) as any;
  if(!l)return c.json({error:'Listing not found'},404);
  const cursor=before?db().query('SELECT COALESCE(julianday(observed_at),-1) at FROM listing_prices WHERE listing_id=? AND id=?').get(id,Number(before)) as {at:number}|null:null;
  if(before&&!cursor)return c.json({error:'History cursor not found for this listing'},400);
  // Legacy observations can be inserted after newer ones during backfills.
  // Their insertion id must not turn an old ask into an apparent price drop.
  const rows=db().query(`SELECT id,price_cents AS priceCents,observed_at AS observedAt FROM listing_prices
    WHERE listing_id=? AND (? IS NULL OR COALESCE(julianday(observed_at),-1)<? OR (COALESCE(julianday(observed_at),-1)=? AND id<?))
    ORDER BY COALESCE(julianday(observed_at),-1) DESC,id DESC LIMIT 51`).all(id,before??null,cursor?.at??null,cursor?.at??null,before??null) as any[];
  return c.json({listingId:id,firstObservedAt:l.captured_at,lastSeenAt:l.last_seen,unavailableAt:l.delisted_at,
    currentAskCents:l.asking_price_cents,items:rows.slice(0,50),nextBefore:rows.length>50?rows[49].id:null});
}
