import {restoreSnapshot} from '../db/offhost-backup.ts';
import {createReadStream,writeFileSync} from 'node:fs';
import {createGunzip} from 'node:zlib';
async function* lines(path:string){let pending='';const decoder=new TextDecoder();
  for await(const bytes of createReadStream(path).pipe(createGunzip())){pending+=decoder.decode(bytes,{stream:true});let end;
    while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);yield line;}
    if(pending.length>16*1024*1024)throw Error('Snapshot line too large');}
  pending+=decoder.decode();if(pending)throw Error('Truncated snapshot');}
const [input,target]=process.argv.slice(2);if(!input||!target)throw Error('Usage: restore-stream.ts private-snapshot.jsonl.gz new-database.db');
const receipt=await restoreSnapshot(lines(input),target);writeFileSync(target+'.receipt.json',JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify(receipt));
