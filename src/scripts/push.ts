/** Durable fact synchronization. --limit is the batch size, never a date window. */
import { db } from "../db/index.ts";
import { captureChanges, pendingBatch, acknowledge, type SyncAck } from "../sync/outbox.ts";
const arg=(k:string)=>{const i=process.argv.indexOf(`--${k}`);return i<0?undefined:process.argv[i+1];};
const dry=process.argv.includes("--dry");
const target=new URL(process.env.FILTRSOFT_API??"https://filtrsoft.com").origin;
const token=process.env.FILTRSOFT_PUSH_TOKEN;
const source=arg("source")??"facebook";
const limit=Math.max(1,Math.min(300,Number(arg("limit"))||200));
if(!token&&!dry) throw new Error("FILTRSOFT_PUSH_TOKEN is not set locally");
const d=db();
if(dry) {
  const count=d.query("SELECT COUNT(*) n FROM listings WHERE source=?").get(source) as {n:number};
  console.log(`dry run: ${count.n} ${source} snapshots eligible; no queue writes or sends`);
} else {
  const added=captureChanges(d,target,source);
  console.log(`${added} ${source} changes queued -> ${target}`);
  let acknowledged=0;
  // Capture once, then drain a finite snapshot in sequence order. A killed process
  // leaves unacknowledged payloads intact for the next invocation.
  for(;;) {
    const batch=pendingBatch(d,target,source,limit);
    if(!batch.changes.length) break;
    const response=await fetch(`${target}/v1/push`,{method:"POST",signal:AbortSignal.timeout(60_000),
      headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify(batch)});
    if(!response.ok) throw new Error(`push failed HTTP ${response.status}; changes remain queued`);
    const result=await response.json() as {acks?:SyncAck[]};
    if(!Array.isArray(result.acks)) throw new Error("server did not acknowledge versioned changes; queue retained");
    const count=acknowledge(d,target,batch,result.acks);
    acknowledged+=count;
    if(count!==batch.changes.length) throw new Error("incomplete acknowledgement; remaining changes retained");
  }
  console.log(`acknowledged ${acknowledged} durable changes`);
}
