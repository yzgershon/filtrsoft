import {Database} from 'bun:sqlite';
import {createHash} from 'node:crypto';
import {existsSync,renameSync} from 'node:fs';
import {storageStatus} from './storage.ts';
import {inspectBackup} from './backup.ts';

const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
// Runtime Bun exposes this SQLite precision option before some bundled types.
const exact=(s:ReturnType<Database['query']>)=>(s as typeof s&{safeIntegers(value:boolean):typeof s}).safeIntegers(true);
const encode=(v:unknown):unknown=>typeof v==='bigint'?{integer:String(v)}:v instanceof Uint8Array?{blob:Buffer.from(v).toString('base64')}:v;
const decode=(v:any):any=>v&&typeof v==='object'?'integer' in v?BigInt(v.integer):'blob' in v?Buffer.from(v.blob,'base64'):(()=>{throw Error('Invalid cell');})():v;
/** One read transaction spans schema, rows and footer. No database copy or
 * temporary file is written on the server. WAL growth is guarded throughout,
 * including slow consumers; an incomplete stream can never pass restoration. */
export async function* snapshotRecords(path:string,opts:{maxMs?:number;minFree?:number;free?:()=>number|null;signal?:AbortSignal}={}) {
  const d=new Database(path,{readonly:true}),start=Date.now(),hash=createHash('sha256'),counts:Record<string,number>={};
  const guard=()=>{if(opts.signal?.aborted||Date.now()-start>(opts.maxMs??180000))throw Error('Snapshot deadline or cancellation');
    const free=opts.free?opts.free():storageStatus(path).freeBytes;if(free===null||free<(opts.minFree??64*1024*1024))throw Error('Snapshot stopped before exhausting physical storage');};
  const record=(value:unknown)=>{const line=JSON.stringify(value)+'\n';hash.update(line);return Buffer.from(line);};
  try {
    d.exec('PRAGMA busy_timeout=5000; PRAGMA query_only=ON; BEGIN');guard();
    const schema=d.query("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,name").all() as {type:string;name:string;sql:string}[];
    if(schema.some(s=>/CREATE\s+VIRTUAL\s+TABLE/i.test(s.sql)))throw Error('Virtual tables require a supported backup adapter');
    yield record({format:'filtrsoft-logical-snapshot',version:1,at:new Date().toISOString(),schema});
    for(const table of schema.filter(s=>s.type==='table')) {
      const cols=(d.query(`PRAGMA table_xinfo(${quote(table.name)})`).all() as {name:string;hidden:number}[]).filter(c=>c.hidden===0).map(c=>c.name);
      const rowid=!/WITHOUT\s+ROWID/i.test(table.sql)&&!cols.some(c=>c.toLowerCase()==='_rowid_');
      if(rowid)cols.unshift('_rowid_');
      yield record({table:table.name,columns:cols,rowid});let n=0;
      const q=exact(d.query(`SELECT ${cols.map((c,i)=>`${quote(c)} AS c${i}`).join(',')} FROM ${quote(table.name)}`));
      for(const row of q.iterate() as Iterable<Record<string,unknown>>) {
        guard();const line=record({row:cols.map((_,i)=>encode(row['c'+i]))});if(line.length>16*1024*1024)throw Error('Snapshot row exceeds memory limit');yield line;n++;
        if(n%100===0)await Bun.sleep(0);
      }
      counts[table.name]=n;
    }
    const sequence=d.query("SELECT 1 FROM sqlite_schema WHERE name='sqlite_sequence'").get()?exact(d.query('SELECT name,seq FROM sqlite_sequence')).all():[];
    yield record({sequences:sequence.map((r:any)=>({name:r.name,seq:String(r.seq)}))});guard();
    yield Buffer.from(JSON.stringify({complete:true,counts,sha256:hash.digest('hex'),finishedAt:new Date().toISOString()})+'\n');
  } finally {try{d.exec('ROLLBACK');}finally{d.close();}}
}

/** Restore into a new private path only. Validate the stream footer, row counts,
 * SQLite integrity and foreign keys before publishing the usable database. */
export async function restoreSnapshot(lines:AsyncIterable<string>,target:string) {
  if(existsSync(target)||existsSync(target+'.pending'))throw Error('Restore path already exists');
  const d=new Database(target+'.pending',{create:true}),hash=createHash('sha256'),counts:Record<string,number>={};
  let schema:any[]=[],table='',columns:string[]=[],insert:ReturnType<Database['query']>|null=null,footer:any=null,header=false;
  try {
    d.exec('PRAGMA foreign_keys=OFF; BEGIN');
    for await(const line of lines) {
      if(footer)throw Error('Unexpected content after snapshot footer');
      const r=JSON.parse(line);
      if(r.complete===true){footer=r;continue;}
      hash.update(line+'\n');
      if(!header){if(r.format!=='filtrsoft-logical-snapshot'||r.version!==1||!Array.isArray(r.schema))throw Error('Invalid snapshot header');header=true;schema=r.schema;
        for(const s of schema.filter(s=>s.type==='table')){if(!/^CREATE TABLE\b/i.test(s.sql))throw Error('Unsupported schema');d.exec(s.sql);}continue;}
      if(r.table){if(!schema.some(s=>s.type==='table'&&s.name===r.table)||counts[r.table]!=null)throw Error('Invalid or duplicate table');table=r.table;columns=r.columns;counts[table]=0;
        const valid=(d.query(`PRAGMA table_xinfo(${quote(table)})`).all() as any[]).filter(c=>c.hidden===0).map(c=>c.name);if(r.rowid)valid.unshift('_rowid_');
        if(JSON.stringify(valid)!==JSON.stringify(columns))throw Error('Column mismatch');
        insert=d.query(`INSERT INTO ${quote(table)}(${columns.map(quote).join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);}
      else if(r.row){if(!insert||r.row.length!==columns.length)throw Error('Invalid row');insert.run(...r.row.map(decode));counts[table]++;}
      else if(r.sequences){for(const s of r.sequences){d.run('DELETE FROM sqlite_sequence WHERE name=?',[s.name]);d.run('INSERT INTO sqlite_sequence VALUES(?,?)',[s.name,BigInt(s.seq)]);}}
      else throw Error('Unknown snapshot record');
    }
    if(!footer||footer.sha256!==hash.digest('hex')||JSON.stringify(footer.counts)!==JSON.stringify(counts)||schema.filter(s=>s.type==='table').length!==Object.keys(counts).length)throw Error('Incomplete snapshot or checksum/count mismatch');
    for(const s of schema.filter(s=>s.type!=='table')){if(!['index','trigger','view'].includes(s.type))throw Error('Unsupported schema object');d.exec(s.sql);}
    d.exec('COMMIT');d.close();const verified=inspectBackup(target+'.pending');if(verified.foreignKeyViolations)throw Error('Restore foreign key violations');
    renameSync(target+'.pending',target);return {path:target,...verified,tables:counts,streamSha256:footer.sha256,restoreVerified:true};
  }catch(e){try{d.close();}catch{}throw e;} // retain failed private artifact for diagnosis
}
