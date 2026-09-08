import {test} from "bun:test";
import {isolated} from "./isolated.ts";

test('backup verifies a WAL snapshot and restore before publication, without overwriting a live target',()=>isolated(`
  import {db} from '@/src/db/index.ts';
  import {createBackup,verifyBackup,restoreBackup,copyBackup} from '@/src/db/backup.ts';
  import {Database} from 'bun:sqlite';
  const d=db();d.run("INSERT INTO skus(category,brand,model,created_at) VALUES('gpu','fixture','RTX 4090',?)",[new Date().toISOString()]);
  const b=createBackup(d,'backups');assert.equal(b.restoreVerified,true);assert.equal(b.counts.skus,1);
  d.run("INSERT INTO skus(category,brand,model,created_at) VALUES('gpu','fixture','RTX 3080',?)",[new Date().toISOString()]);
  assert.equal(verifyBackup(b.path).counts.skus,1);
  const restored=restoreBackup(b.path,'restore.db');const r=new Database(restored.path,{readonly:true});
  assert.equal(r.query('SELECT COUNT(*) n FROM skus').get().n,1);r.close();
  assert.throws(()=>restoreBackup(b.path,'restore.db'));
  assert.equal(verifyBackup(copyBackup(b.path,'secondary')).sha256,b.sha256);
`));
test('failed backup replacement preserves the previously verified backup and tampering is detected',()=>isolated(`
  import {db} from '@/src/db/index.ts';
  import {createBackup,verifyBackup,rotateBackups} from '@/src/db/backup.ts';
  import {writeFileSync,existsSync,readdirSync} from 'node:fs';
  const d=db(),first=createBackup(d,'backups');
  assert.throws(()=>createBackup(d,'backups',{beforeVerify:path=>writeFileSync(path,'broken')}));
  assert.equal(verifyBackup(first.path).sha256,first.sha256);
  assert.equal(readdirSync('backups').filter(p=>p.endsWith('.pending')).length,0);
  const second=createBackup(d,'backups');rotateBackups('backups',1);
  assert.equal(existsSync(second.path),true);assert.equal(existsSync(first.path),false);
  writeFileSync(second.path+'.json','{}');assert.throws(()=>verifyBackup(second.path));
`));
