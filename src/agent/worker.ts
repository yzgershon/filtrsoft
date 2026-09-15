import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {killChildTree} from './process.ts';

type Event={type:string;[key:string]:unknown};
/** Node owns Playwright; Bun only consumes its NDJSON. A worker that exits
 * without its terminal event did not complete, even if it returned exit 0. */
export async function* workerEvents<T extends Event>(args:string[],opts:{timeoutMs?:number;executable?:string;requireDone?:boolean;interactive?:boolean}={}):AsyncGenerator<T> {
  const child=spawn(opts.executable??process.env.FILTRSOFT_NODE??'node',args,{shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:[opts.interactive?'inherit':'ignore','pipe','pipe']});
  let stderr='',failure='',done=false,timedOut=false;
  child.stderr!.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-4000);});
  const closed=new Promise<number|null>(resolve=>{child.once('error',e=>{failure=e.message;resolve(null);});child.once('close',resolve);});
  const timer=opts.timeoutMs===0?null:setTimeout(()=>{timedOut=true;killChildTree(child);},opts.timeoutMs??12*60_000);
  const onExit=()=>killChildTree(child);process.once('exit',onExit);
  const lines=createInterface({input:child.stdout!,crlfDelay:Infinity});
  try {
    for await (const line of lines) {
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
    if(timer)clearTimeout(timer);lines.close();killChildTree(child);await closed;process.removeListener('exit',onExit);
  }
}
