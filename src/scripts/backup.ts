/** Verified WAL-consistent snapshot; --local-only explicitly skips a secondary copy. */
import {db,DB_PATH} from "../db/index.ts";
import {createBackup,copyBackup,rotateBackups} from "../db/backup.ts";
import {join} from "node:path";
const local=process.env.FILTRSOFT_BACKUP_DIR??join(import.meta.dir,'../../backups');
const keep=Number(process.env.FILTRSOFT_BACKUP_KEEP??14);
const result=createBackup(db(),local);
console.log(JSON.stringify({source:DB_PATH,backup:result},null,2));
if(!process.argv.includes('--local-only')){
  const cloud=process.env.FILTRSOFT_BACKUP_CLOUD;
  if(!cloud){console.error('Verified local backup retained. Set FILTRSOFT_BACKUP_CLOUD or explicitly use --local-only. Offsite coverage is unverified.');process.exitCode=2;}
  else try{console.log('verified secondary copy: '+copyBackup(result.path,cloud));rotateBackups(cloud,keep);}
  catch(e){console.error('Verified local backup retained; secondary copy failed: '+(e as Error).message);process.exitCode=2;}
}
rotateBackups(local,keep);
