import {Database} from "bun:sqlite";
import {randomUUID,createHash} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync,renameSync,copyFileSync,existsSync,unlinkSync,linkSync,readdirSync} from "node:fs";
import {join,resolve,dirname} from "node:path";

export function inspectBackup(path:string) {
  const d=new Database(path,{readonly:true});
  try {
    const integrity=d.query('PRAGMA integrity_check').all() as Record<string,string>[];
    if(integrity.length!==1 || Object.values(integrity[0])[0]!=='ok')throw new Error('Backup integrity check failed');
    const tables=new Set((d.query("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).map(t=>t.name));
    const counts:Record<string,number>={};
    for(const table of ['comps','skus','listings','verdicts','judgments','outcomes'])if(tables.has(table))counts[table]=(d.query(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n;
    return {sha256:createHash('sha256').update(readFileSync(path)).digest('hex'),counts,foreignKeyViolations:d.query('PRAGMA foreign_key_check').all().length};
  } finally {d.close();}
}
export function verifyBackup(path:string) {
  const m=JSON.parse(readFileSync(path+'.json','utf8'));
  const actual=inspectBackup(path);
  if(m.version!==1 || actual.sha256!==m.sha256 || JSON.stringify(actual.counts)!==JSON.stringify(m.counts))throw new Error('Backup manifest mismatch');
  return {...actual,createdAt:m.createdAt};
}
/** Unique target + verified restore rehearsal BEFORE publishing/rotating. The
 * old backup survives every failure. Counts belong to the snapshot, not a racing source.
 */
export function createBackup(d:Database,directory:string,opts:{beforeVerify?:(path:string)=>void}={}) {
  const root=resolve(directory);mkdirSync(root,{recursive:true});
  const stamp=new Date().toISOString().replace(/[:.]/g,'-'),name=`filtrsoft-${stamp}-${randomUUID()}.db`;
  const target=join(root,name),temp=target+'.pending',rehearsal=target+'.restore-check';
  try {
    d.run('VACUUM INTO ?',[temp]);opts.beforeVerify?.(temp);
    const evidence=inspectBackup(temp);
    copyFileSync(temp,rehearsal);
    const restored=inspectBackup(rehearsal);
    if(restored.sha256!==evidence.sha256)throw new Error('Restore rehearsal changed snapshot bytes');
    const manifest={version:1,createdAt:new Date().toISOString(),...evidence,restoreVerified:true};
    writeFileSync(temp+'.json',JSON.stringify(manifest,null,2),{flag:'wx'});
    renameSync(temp,target);renameSync(temp+'.json',target+'.json');
    verifyBackup(target);return {path:target,...manifest};
  } finally {
    for(const path of [temp,temp+'.json',rehearsal,rehearsal+'-shm',rehearsal+'-wal'])if(existsSync(path))unlinkSync(path);
  }
}
export function restoreBackup(source:string,target:string) {
  const expected=verifyBackup(source),out=resolve(target);
  if(existsSync(out)||existsSync(out+'-wal')||existsSync(out+'-shm'))throw new Error('Restore target must be new; live databases are never overwritten');
  mkdirSync(dirname(out),{recursive:true});const temp=out+'.restore-'+randomUUID();
  try {
    copyFileSync(source,temp);const actual=inspectBackup(temp);
    if(actual.sha256!==expected.sha256)throw new Error('Restore verification mismatch');
    // Hard-link publication is atomic and fails if somebody created the target.
    linkSync(temp,out);return {path:out,...actual};
  } finally {if(existsSync(temp))unlinkSync(temp);}
}
export function copyBackup(source:string,directory:string) {
  const verified=verifyBackup(source),root=resolve(directory);mkdirSync(root,{recursive:true});
  const dest=join(root,source.replace(/.*[\\/]/,''));
  if(resolve(source)===dest)throw new Error('Secondary copy must use a different directory');
  const tmp=dest+'.pending-'+randomUUID();
  try {
    copyFileSync(source,tmp);if(inspectBackup(tmp).sha256!==verified.sha256)throw new Error('Secondary copy mismatch');
    copyFileSync(source+'.json',tmp+'.json');renameSync(tmp,dest);renameSync(tmp+'.json',dest+'.json');verifyBackup(dest);return dest;
  } finally {for(const p of [tmp,tmp+'.json'])if(existsSync(p))unlinkSync(p);}
}
export function rotateBackups(directory:string,keep:number) {
  const root=resolve(directory);if(!Number.isInteger(keep)||keep<1)throw new Error('keep must be positive');
  const verified=readdirSync(root).filter(n=>/^filtrsoft-\d{4}-\d{2}-\d{2}T[a-f0-9ZT-]+\.db$/.test(n)).filter(n=>{
    try{verifyBackup(join(root,n));return true;}catch{return false;}
  }).sort();
  for(const name of verified.slice(0,Math.max(0,verified.length-keep))){const path=join(root,name);
    if(dirname(path)!==root)throw new Error('Unsafe retention path');unlinkSync(path);unlinkSync(path+'.json');}
}
