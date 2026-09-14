import type {Context} from 'hono';
import {db,now} from '../db/index.ts';
import {currentUser} from './auth.ts';

/** An original seller link click is interest; opening our report is research.
 * No backfill from detail views, saved lists or historical browser records. */
export function recordSellerClick(c:Context) {
  const owner=currentUser(c),id=Number(c.req.param('id'));
  if(!owner)return c.json({error:'Sign in required'},401);
  if(!Number.isSafeInteger(id)||id<1)return c.json({error:'Invalid listing'},400);
  if(!db().query('SELECT 1 FROM listings WHERE id=?').get(id))return c.json({error:'Listing not found'},404);
  const at=now();
  db().run(`INSERT INTO listing_contacts(user_id,listing_id,first_clicked_at,last_clicked_at) VALUES(?,?,?,?)
    ON CONFLICT(user_id,listing_id) DO UPDATE SET last_clicked_at=excluded.last_clicked_at`,[owner.id,id,at,at]);
  return c.json({ok:true});
}

export function followUp(c:Context) {
  const owner=currentUser(c);if(!owner)return c.json({error:'Sign in required'},401);
  const at=Date.now(),day=86_400_000;
  const row=db().query(`SELECT l.id,l.title,lc.last_clicked_at at,v.call FROM listing_contacts lc
    JOIN listings l ON l.id=lc.listing_id
    LEFT JOIN verdicts v ON v.id=(SELECT MAX(id) FROM verdicts WHERE listing_id=l.id)
    WHERE lc.user_id=? AND lc.dismissed_at IS NULL AND lc.last_clicked_at<=? AND lc.last_clicked_at>=?
    AND NOT EXISTS(SELECT 1 FROM outcomes o WHERE o.listing_id=l.id AND o.user_id=lc.user_id)
    AND NOT EXISTS(SELECT 1 FROM listing_dismissals x WHERE x.listing_id=l.id AND x.user_id=lc.user_id)
    ORDER BY lc.last_clicked_at,l.id LIMIT 1`).get(owner.id,new Date(at-day).toISOString(),new Date(at-14*day).toISOString()) as {id:number;title:string;at:string;call:string}|null;
  return c.json({pending:row?{...row,at:Date.parse(row.at)}:null});
}

export function dismissFollowUp(c:Context) {
  const owner=currentUser(c),id=Number(c.req.param('id'));
  if(!owner)return c.json({error:'Sign in required'},401);
  if(!Number.isSafeInteger(id)||id<1)return c.json({error:'Invalid listing'},400);
  db().run('UPDATE listing_contacts SET dismissed_at=? WHERE user_id=? AND listing_id=?',[now(),owner.id,id]);
  return c.json({ok:true});
}
