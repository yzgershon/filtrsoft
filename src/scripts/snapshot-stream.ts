import {snapshotRecords} from '../db/offhost-backup.ts';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
const controller=new AbortController();
const deadline=setTimeout(()=>{controller.abort();process.exitCode=1;process.stdout.destroy(new Error('Snapshot deadline'));},180000);
try{await pipeline(Readable.from(snapshotRecords(process.env.FILTRSOFT_DB!,{signal:controller.signal})),createGzip({level:1}),process.stdout);}
catch{process.exitCode=1;console.error('Snapshot did not complete; retain the previous backup.');}
finally{clearTimeout(deadline);}
