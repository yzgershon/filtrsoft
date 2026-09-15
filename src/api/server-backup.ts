import {dirname,join} from 'node:path';
import {db,DB_PATH,now} from '../db/index.ts';
import {storageStatus} from '../db/storage.ts';
import {runCommand} from '../agent/process.ts';
export function serverBackupStatus(){
  db().exec('CREATE TABLE IF NOT EXISTS server_backup_state(id INTEGER PRIMARY KEY CHECK(id=1),status TEXT,attempted_at TEXT,finished_at TEXT,next_at TEXT,note TEXT)');
  return db().query('SELECT status,attempted_at AS attemptedAt,finished_at AS finishedAt,next_at AS nextAt,note FROM server_backup_state WHERE id=1').get() as any;
}
let running=false;
export async function backupServerIfDue() {
  if(running||process.env.FILTRSOFT_SERVER_BACKUP==='off')return;
  const previous=serverBackupStatus();if(previous?.nextAt>now())return;
  running=true;const attempted=now();
  const save=(status:string,note:string,wait:number)=>db().run('INSERT INTO server_backup_state VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,attempted_at=excluded.attempted_at,finished_at=excluded.finished_at,next_at=excluded.next_at,note=excluded.note',
    [status,attempted,status==='running'?null:now(),new Date(Date.now()+wait).toISOString(),note]);
  try {
    const storage=storageStatus(DB_PATH);
    if(storage.freeBytes===null||storage.freeBytes<storage.databaseBytes*3+256*1024*1024){save('failed','Not enough verified free space for a safe backup',3600_000);return;}
    save('running','Creating and restoring a snapshot',3600_000);
    const result=await runCommand(process.execPath,['run','src/scripts/backup.ts','--local-only'],{timeoutMs:180000,
      env:{...process.env,FILTRSOFT_BACKUP_DIR:process.env.FILTRSOFT_BACKUP_DIR??join(dirname(DB_PATH),'backups'),FILTRSOFT_BACKUP_KEEP:'2'}});
    save(result.ok?'done':'failed',result.ok?'Verified local snapshot; same-volume protection':'Backup failed; retry scheduled',result.ok?86400_000:3600_000);
    if(!result.ok)console.error('server backup failed',result.tail.slice(-300));
  }finally{running=false;}
}
export function startServerBackups() {const tick=async()=>{try{await backupServerIfDue();}catch(e){console.error('server backup check failed',String(e));}finally{setTimeout(()=>void tick(),3600_000).unref?.();}};setTimeout(()=>void tick(),5*60_000).unref?.();}
