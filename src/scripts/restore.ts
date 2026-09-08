/** Restores only to a new path. Never point a running service at it until verified. */
import {restoreBackup} from "../db/backup.ts";
const [source,target]=process.argv.slice(2);
if(!source||!target)throw new Error('Usage: bun run src/scripts/restore.ts <backup.db> <new-target.db>');
console.log(JSON.stringify(restoreBackup(source,target),null,2));
