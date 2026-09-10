import type {Context} from 'hono';
import {db,now} from '../db/index.ts';
import {currentUser} from './auth.ts';

/** Account-owned attention control, not a global delist or a training label. */
export function dismissedIds(userId:number):Set<number> {
  return new Set((db().query('SELECT listing_id FROM listing_dismissals WHERE user_id=?').all(userId) as {listing_id:number}[]).map(r=>r.listing_id));
}
export function setDismissed(c:Context,removed:boolean) {
  const user=currentUser(c),id=Number(c.req.param('id'));
  if(!user)return c.json({error:'Sign in required'},401);
  if(!Number.isSafeInteger(id)||id<1)return c.json({error:'Invalid listing'},400);
  if(!db().query('SELECT id FROM listings WHERE id=?').get(id))return c.json({error:'Listing not found'},404);
  if(removed)db().run('INSERT INTO listing_dismissals(user_id,listing_id,created_at) VALUES(?,?,?) ON CONFLICT(user_id,listing_id) DO NOTHING',[user.id,id,now()]);
  else db().run('DELETE FROM listing_dismissals WHERE user_id=? AND listing_id=?',[user.id,id]);
  return c.json({id,removed});
}
export function listDismissed(c:Context) {
  const user=currentUser(c);if(!user)return c.json({error:'Sign in required'},401);
  const offset=Number(c.req.query('offset')??0);if(!Number.isSafeInteger(offset)||offset<0)return c.json({error:'Invalid offset'},400);
  const rows=db().query(`SELECT l.id,l.title,d.created_at FROM listing_dismissals d JOIN listings l ON l.id=d.listing_id WHERE d.user_id=? ORDER BY d.created_at DESC,d.listing_id DESC LIMIT 51 OFFSET ?`).all(user.id,offset);
  return c.json({items:rows.slice(0,50),nextOffset:rows.length>50?offset+50:null});
}
