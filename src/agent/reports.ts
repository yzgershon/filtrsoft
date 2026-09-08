import type {Database} from 'bun:sqlite';
export function queueJobReport(d:Database,api:string,agent:string,job:number,body:Record<string,unknown>) {
  d.exec(`CREATE TABLE IF NOT EXISTS agent_reports(id INTEGER PRIMARY KEY AUTOINCREMENT,api TEXT,agent TEXT,
    job INTEGER,payload TEXT,status TEXT DEFAULT 'pending',last_error TEXT,created_at TEXT)`);
  d.run('INSERT INTO agent_reports(api,agent,job,payload,created_at) VALUES(?,?,?,?,?)',[api,agent,job,JSON.stringify(body),new Date().toISOString()]);
}

const flights=new Map<string,Promise<number>>();
/** Persist first. A lost completion response is retried even after an agent
 * restart; authorization remains in the environment, never in this queue.
 */
export async function flushJobReports(d:Database,api:string,authorization:string):Promise<number> {
  if(flights.has(api))return flights.get(api)!;
  const task=(async()=>{
    if(!d.query("SELECT 1 FROM sqlite_master WHERE name='agent_reports'").get())return 0;
    const rows=d.query("SELECT id,agent,job,payload FROM agent_reports WHERE api=? AND status='pending' ORDER BY id LIMIT 20").all(api) as {id:number;agent:string;job:number;payload:string}[];
    let acknowledged=0;
    for(const row of rows) {
      try {
        const response=await fetch(`${api}/v1/jobs/${row.job}`,{method:'POST',signal:AbortSignal.timeout(10_000),
          headers:{authorization,'x-filtrsoft-agent':row.agent,'content-type':'application/json'},body:row.payload});
        if(response.ok) {d.run("UPDATE agent_reports SET status='acknowledged',last_error=NULL WHERE id=?",[row.id]);acknowledged++;}
        else if([404,409].includes(response.status))d.run("UPDATE agent_reports SET status='conflict',last_error=? WHERE id=?",[`HTTP ${response.status}: job no longer accepts this report`,row.id]);
        else throw new Error(`HTTP ${response.status}`);
      } catch(error) {
        d.run('UPDATE agent_reports SET last_error=? WHERE id=?',[String(error).slice(0,300),row.id]);break;
      }
    }
    return acknowledged;
  })().finally(()=>flights.delete(api));
  flights.set(api,task);return task;
}
