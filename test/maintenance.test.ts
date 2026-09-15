import {test} from 'bun:test';
import {isolated} from './isolated.ts';
test('verified automatic backup can restore current facts and failure does not mark maintenance complete',()=>isolated(`
  import {db} from '@/src/db/index.ts';import {createBackup,restoreBackup} from '@/src/db/backup.ts';import {maintenanceTask,maintenanceState,maintenanceDue} from '@/src/agent/maintenance.ts';
  import {Database} from 'bun:sqlite';import {resolve} from 'node:path';
  const d=db();d.run("INSERT INTO users(id,email,created_at,last_seen_at) VALUES(1,'fixture@example.invalid','2026-01-01','2026-01-01')");
  const backup=createBackup(d,resolve('backups'));assert.equal(backup.restoreVerified,true);
  const restored=restoreBackup(backup.path,resolve('restored.db'));const check=new Database(restored.path,{readonly:true});assert.equal(check.query('SELECT COUNT(*) n FROM users').get().n,1);check.close();
  assert.equal(await maintenanceTask('fixture',[],{intervalMs:86400000,timeoutMs:1000,run:async()=>({ok:false,tail:'synthetic failure',timedOut:false,cancelled:false})}),false);
  assert.equal(maintenanceState().fixture.status,'failed');assert.equal(maintenanceDue('fixture'),false);assert.equal(maintenanceDue('fixture',Date.now()+3600001),true);
`));
