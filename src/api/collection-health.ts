import type {Context} from 'hono';
import {z} from 'zod';
import {db,now,DB_PATH} from '../db/index.ts';
import {storageStatus} from '../db/storage.ts';
import {currentUser,ownsDevice} from './auth.ts';
import {agentAuthorised,AGENT_SOURCES,touchAgent} from './jobs.ts';
import {readHostPolicy} from '../agent/host-policy.ts';
import {serverBackupStatus} from './server-backup.ts';

export function collectionOwner(c:Context) {const user=currentUser(c);return Boolean(user&&ownsDevice(user.id,(process.env.FILTRSOFT_OWNER_REF??'').trim()));}
const telemetry=z.object({nodeId:z.uuid(),label:z.string().min(1).max(80),revision:z.string().max(64),
  status:z.enum(['starting','online','working','paused','offline']),jobId:z.number().int().positive().nullable(),
  pending:z.partialRecord(z.enum(AGENT_SOURCES),z.number().int().min(0).max(10_000_000)).nullable(),
  maintenance:z.record(z.string().max(40),z.object({status:z.enum(['running','done','failed']),attemptedAt:z.iso.datetime(),finishedAt:z.iso.datetime().optional(),nextAt:z.iso.datetime(),note:z.string().max(160)})).optional()});
export async function handleCollectorHeartbeat(c:Context) {
  if(!agentAuthorised(c))return c.json({error:'unauthorised'},401);
  const parsed=telemetry.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)return c.json({error:'Invalid collector status'},400);
  const v=parsed.data;
  // Maintenance heartbeats also keep automatic job dispatch alive, so an idle
  // comp refresh can see queued listing work and yield before its next poll.
  if(v.status!=='paused'&&v.status!=='offline')touchAgent(c,v.jobId);
  db().run(`INSERT INTO collector_nodes(node_id,label,revision,seen_at,telemetry) VALUES(?,?,?,?,?)
    ON CONFLICT(node_id) DO UPDATE SET label=excluded.label,revision=excluded.revision,seen_at=excluded.seen_at,telemetry=excluded.telemetry`,
    [v.nodeId,v.label,v.revision,now(),JSON.stringify(v)]);
  let ownsJob:boolean|null=null;
  if(v.jobId!==null) {
    const changed=db().run("UPDATE crawl_jobs SET heartbeat_at=? WHERE id=? AND status='running' AND agent_id=? AND node_id=?",
      [now(),v.jobId,c.req.header('x-filtrsoft-agent')??'legacy',v.nodeId]);
    ownsJob=changed.changes===1;
  }
  return c.json({ok:true,ownsJob,workWaiting:Boolean(db().query("SELECT id FROM crawl_jobs WHERE status='queued' LIMIT 1").get())});
}
/** Never render raw worker tails: they can contain seller text or remote URLs. */
export function failureLabel(error:string|null) {
  if(!error)return null;
  if(/log.?in|sign.?in|session expired/i.test(error))return 'Sign-in needs attention';
  if(/challenge|captcha|blocked|429/i.test(error))return 'Marketplace challenge';
  if(/timeout|timed out|deadline/i.test(error))return 'Search timed out';
  if(/sync|acknowledg|upload|push failed/i.test(error))return 'Upload needs retry';
  return 'Collection needs attention';
}
export function collectionHealth(at=Date.now()) {
  const d=db(),stamp=new Date(at).toISOString();
  const nodes=(d.query('SELECT node_id,label,revision,seen_at,telemetry FROM collector_nodes ORDER BY seen_at DESC LIMIT 20').all() as any[]).map(n=>({
    id:n.node_id,label:n.label,revision:n.revision,seenAt:n.seen_at,online:at-Date.parse(n.seen_at)<90_000,...JSON.parse(n.telemetry)}));
  const sources=AGENT_SOURCES.map(source=>{
    const stages=d.query(`SELECT s.*,j.heartbeat_at,j.status job_status FROM crawl_job_stages s JOIN crawl_jobs j ON j.id=s.job_id
      WHERE s.stage LIKE ? ORDER BY s.job_id DESC,s.started_at DESC LIMIT 100`).all(source+'/%') as any[];
    const searches=stages.filter(s=>s.stage.includes('/search-')&&!s.stage.endsWith('-sync'));
    const latest=searches[0],good=searches.find(s=>s.status==='done');
    const group=(stage:string)=>stage.endsWith('-sync')?'sync':stage.includes('/search-')?'search':stage;
    const failed=stages.find(s=>s.status==='failed'&&!stages.some(later=>later.status==='done'&&group(later.stage)===group(s.stage)&&later.finished_at>s.finished_at));
    const newest=d.query('SELECT MAX(captured_at) capturedAt FROM listings WHERE source=?').get(source) as {capturedAt:string|null};
    const active=stages.find(s=>s.status==='running'&&s.job_status==='running'&&at-Date.parse(s.heartbeat_at)<90_000);
    const unresolved=Boolean(failed);
    const stale=!good||at-Date.parse(good.finished_at)>3*3600_000;
    const status=active?'working':unresolved?'attention':stale?'stale':'healthy';
    const sync=stages.find(s=>s.stage.endsWith('-sync')&&s.status==='done');
    return {source,status,lastSearchAt:latest?.finished_at??latest?.started_at??null,lastSuccessAt:good?.finished_at??null,
      newestCaptureAt:newest.capturedAt,lastUploadAt:sync?.finished_at??null,issue:unresolved?failureLabel(failed.error):null,
      activeStage:active?.stage.split('/')[1]??null};
  });
  return {at:stamp,nodes,sources,policy:readHostPolicy(d),server:{source:'craigslist',enabled:(process.env.FILTRSOFT_CRAWL??'on').toLowerCase()!=='off',backup:serverBackupStatus(),storage:storageStatus(DB_PATH)}};
}
export function handleCollectionHealth(c:Context) {
  if(!collectionOwner(c))return c.json({allowed:false});
  return c.json({allowed:true,...collectionHealth()});
}
export async function handleCollectionPolicy(c:Context) {
  if(!collectionOwner(c))return c.json({error:'Owner access required'},403);
  const parsed=z.object({preferredNode:z.uuid().nullable(),fallbackMinutes:z.number().int().min(3).max(60)}).strict().safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:'Choose a registered computer and a fallback delay from 3 to 60 minutes'},400);
  const v=parsed.data;if(v.preferredNode&&!db().query('SELECT node_id FROM collector_nodes WHERE node_id=?').get(v.preferredNode))return c.json({error:'This computer has not connected yet'},400);
  db().run('INSERT INTO collector_policy VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET preferred_node=excluded.preferred_node,fallback_minutes=excluded.fallback_minutes',[v.preferredNode,v.fallbackMinutes]);
  return c.json({ok:true,policy:readHostPolicy(db())});
}
