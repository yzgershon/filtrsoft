import type {Context} from 'hono';
import {collectionOwner} from './collection-health.ts';
import {DB_PATH} from '../db/index.ts';
import {storageStatus} from '../db/storage.ts';
let active=false,lastStarted=0;
/** Owner session only: the upload token deliberately cannot export accounts,
 * saved inspections or authentication records. A second stream is refused. */
export function handleOffhostBackup(c:Context){
  c.header('Cache-Control','no-store');c.header('X-Content-Type-Options','nosniff');
  if(!collectionOwner(c))return c.json({error:'Owner access required'},403);
  if(c.req.header('sec-fetch-site')==='cross-site')return c.json({error:'Same-site request required'},403);
  if(active||Date.now()-lastStarted<60000)return c.json({error:'A snapshot is active or cooling down'},409);
  const s=storageStatus(DB_PATH);if(s.freeBytes===null||s.freeBytes<64*1024*1024)return c.json({error:'Insufficient physical headroom for a bounded read snapshot'},503);
  const child=Bun.spawn([process.execPath,'run','src/scripts/snapshot-stream.ts'],{env:{...process.env,FILTRSOFT_DB:DB_PATH},stdout:'pipe',stderr:'ignore'});
  active=true;lastStarted=Date.now();const deadline=setTimeout(()=>child.kill(),185000);
  void child.exited.finally(()=>{active=false;clearTimeout(deadline);});
  const reader=child.stdout.getReader();
  const body=new ReadableStream<Uint8Array>({async pull(controller){try{const r=await reader.read();if(r.done){if(await child.exited!==0)controller.error(Error('Snapshot interrupted'));else controller.close();}else controller.enqueue(r.value);}catch(e){child.kill();controller.error(e);}},cancel(){child.kill();void reader.cancel();}});
  c.req.raw.signal.addEventListener('abort',()=>child.kill(),{once:true});
  c.header('Content-Type','application/gzip');c.header('Content-Disposition',`attachment; filename="filtrsoft-production-${new Date().toISOString().replaceAll(':','-')}.jsonl.gz"`);
  return c.body(body);
}
