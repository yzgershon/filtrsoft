/** Explicit maintenance entrypoint. Does not import db(), migrate, crawl or
 * re-score. Default is a read-only sample; --apply preserves all logical rows. */
import {Database} from 'bun:sqlite';
import {statfsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {compactVerdictBatch} from '../db/verdict-history.ts';
const args=process.argv.slice(2),apply=args.includes('--apply'),restore=args.includes('--restore');
const pathArg=args.find(a=>a.startsWith('--db='));if(!pathArg)throw new Error('Supply an explicit --db=/absolute/path; shared databases are never selected implicitly.');
// Bun requires an explicit readwrite flag. {readonly:false} becomes zero
// SQLite open flags on Linux and fails before entering the maintenance loop.
const path=resolve(pathArg.slice(5)),d=new Database(path,apply?{readwrite:true}:{readonly:true});
d.exec('PRAGMA busy_timeout=5000');
const batchArg=args.find(a=>a.startsWith('--batches=')),batches=batchArg?Number(batchArg.slice(10)):apply?10000:1;
if(!Number.isSafeInteger(batches)||batches<1||batches>10000)throw new Error('Invalid batch count');
const afterArg=args.find(a=>a.startsWith('--after='));
let after=afterArg?Number(afterArg.slice(8)):0,changed=0,savedBytes=0,scanned=0;
if(!Number.isSafeInteger(after)||after<0)throw new Error('Invalid after cursor');
try {
  for(let i=0;i<batches;i++){
    const f=statfsSync(dirname(path));if(apply&&f.bavail*f.bsize<32*1024*1024)throw new Error('Less than 32 MB physical headroom; stopping before a write');
    const result=compactVerdictBatch(d,{after,apply,restore});after=result.next;changed+=result.changed;savedBytes+=result.savedBytes;scanned+=result.scanned;
    if(apply){const status=d.query('PRAGMA wal_checkpoint(TRUNCATE)').get() as {busy:number};if(status.busy)throw new Error('Checkpoint busy; committed compression is safe, stopping before more WAL growth');}
    if(i%50===0||result.done)console.log(JSON.stringify({apply,restore,batches:i+1,after,scanned,changed,savedBytes,done:result.done}));
    if(result.done)break;
    if(apply)await Bun.sleep(10);
  }
  console.log(JSON.stringify({apply,restore,after,scanned,changed,savedBytes,freePages:d.query('PRAGMA freelist_count').get(),pageSize:d.query('PRAGMA page_size').get()}));
}finally{d.close();}
