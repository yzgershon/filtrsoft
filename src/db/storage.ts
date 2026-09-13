import {statSync,statfsSync,readdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import type {Database} from 'bun:sqlite';

export function storageStatus(path:string) {
  const size=(file:string)=>{try{return statSync(file).size;}catch{return 0;}};
  let totalBytes:number|null=null,freeBytes:number|null=null;
  try {const s=statfsSync(dirname(path));totalBytes=s.blocks*s.bsize;freeBytes=s.bavail*s.bsize;}catch{}
  return {totalBytes,freeBytes,pressure:freeBytes===null?'unknown':freeBytes<64*1024*1024?'critical':freeBytes<256*1024*1024?'low':'normal',
    databaseBytes:size(path),walBytes:size(path+'-wal')};
}

/** Let SQLite merge committed WAL pages and reclaim its journal. Never unlink
 * WAL/SHM files: they may contain the only copy of committed user records. A
 * busy/full-volume checkpoint is reported and left for a later retry. */
export function checkpointStorage(d:Database,path:string) {
  const before=storageStatus(path);
  if(before.walBytes<16*1024*1024 && before.pressure!=='critical')return {before,after:before,checkpoint:null};
  try {
    const checkpoint=d.query('PRAGMA wal_checkpoint(TRUNCATE)').get();
    return {before,after:storageStatus(path),checkpoint};
  } catch(e) {return {before,after:storageStatus(path),checkpoint:null,error:(e as Error).message};}
}

/** Startup log only: file sizes identify retained files without reading their
 * contents or exposing storage paths in an anonymous API response. */
export function logStorage(d:Database,path:string) {
  console.log('storage checkpoint',JSON.stringify(checkpointStorage(d,path)));
  try {console.log('storage files',JSON.stringify(readdirSync(dirname(path),{withFileTypes:true}).map(f=>({name:f.name,directory:f.isDirectory(),bytes:f.isFile()?statSync(join(dirname(path),f.name)).size:null}))));}catch{}
  try {console.log('storage tables',JSON.stringify(d.query('SELECT name,SUM(pgsize) bytes FROM dbstat GROUP BY name ORDER BY bytes DESC LIMIT 12').all()));}catch{}
}
