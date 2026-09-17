import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';
import type {Readable} from 'node:stream';
import {killChildTree} from './process.ts';

type Event={type:string;[key:string]:unknown};
/** Only LF frames NDJSON. Bun's readline also splits U+2028/U+2029, which
 * JSON.stringify legitimately leaves inside seller descriptions. Decode
 * across byte chunks so non-ASCII text and final unterminated events survive. */
async function* jsonLines(input:Readable):AsyncGenerator<string> {
  const decoder=new StringDecoder('utf8');let pending='';
  for await(const chunk of input){
    pending+=decoder.write(chunk);let end:number;
    while((end=pending.indexOf('\n'))!==-1){yield pending.slice(0,end);pending=pending.slice(end+1);}
  }
  pending+=decoder.end();if(pending)yield pending;
}
/** Node owns Playwright; Bun only consumes its NDJSON. A worker that exits
 * without its terminal event did not complete, even if it returned exit 0. */
export async function* workerEvents<T extends Event>(args:string[],opts:{timeoutMs?:number;executable?:string;requireDone?:boolean;interactive?:boolean}={}):AsyncGenerator<T> {
  const child=spawn(opts.executable??process.env.FILTRSOFT_NODE??'node',args,{shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:[opts.interactive?'inherit':'ignore','pipe','pipe']});
  let stderr='',failure='',done=false,timedOut=false;
  child.stderr!.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-4000);});
  const closed=new Promise<number|null>(resolve=>{child.once('error',e=>{failure=e.message;resolve(null);});child.once('close',resolve);});
  const timer=opts.timeoutMs===0?null:setTimeout(()=>{timedOut=true;killChildTree(child);},opts.timeoutMs??12*60_000);
  const onExit=()=>killChildTree(child);process.once('exit',onExit);
  try {
    for await (const line of jsonLines(child.stdout!)) {
      if(!line.trim())continue;
      let event:Event;
      try {event=JSON.parse(line);if(!event||typeof event.type!=='string')throw new Error('invalid event');}
      catch {yield {type:'log',msg:`unparseable worker output: ${line.slice(0,120)}`} as unknown as T;continue;}
      if(event.type==='done')done=true;
      yield event as T;
    }
    const code=await closed;
    if(timedOut||failure||code!==0||(!done&&opts.requireDone!==false)) {
      const reason=timedOut?'worker timed out':failure||`worker exited ${code}${done?'':' without completion'}`;
      yield {type:'error',msg:`${reason}${stderr?`: ${stderr.slice(-500)}`:''}`} as unknown as T;
    }
  } finally {
    if(timer)clearTimeout(timer);killChildTree(child);await closed;process.removeListener('exit',onExit);
  }
}
