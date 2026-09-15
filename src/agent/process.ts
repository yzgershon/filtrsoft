import {spawn, execFileSync, type ChildProcess} from 'node:child_process';

/** Only terminate the tree we created. Never match an executable name: this
 * machine also runs unrelated Bun processes and the owner's personal Chrome. */
export function killChildTree(child:ChildProcess) {
  if(!child.pid || child.exitCode!==null || child.signalCode!==null)return;
  if(process.platform==='win32') {
    try {execFileSync('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true,timeout:10_000});}catch {}
  } else {try {process.kill(-child.pid,'SIGKILL');}catch {}}
}

export interface CommandResult {ok:boolean; tail:string; timedOut:boolean; cancelled:boolean}
export async function runCommand(executable:string,args:string[],opts:{timeoutMs:number;cwd?:string;env?:NodeJS.ProcessEnv;onOutput?:(text:string)=>void;cancelled?:()=>boolean}):Promise<CommandResult> {
  return new Promise(resolve=>{
    const child=spawn(executable,args,{cwd:opts.cwd,env:opts.env,shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    let tail='',timedOut=false,cancelled=false,settled=false;
    const keep=(chunk:Buffer|string)=>{const text=String(chunk);tail=(tail+text).slice(-12_000);opts.onOutput?.(text);};
    // Drain both pipes from launch. Waiting for exit before reading stderr can
    // deadlock a noisy Chrome launch when its OS pipe buffer fills.
    child.stdout?.on('data',keep);child.stderr?.on('data',keep);
    const stop=()=>{killChildTree(child);};
    const timer=setTimeout(()=>{timedOut=true;keep(`\nTimed out after ${Math.round(opts.timeoutMs/1000)}s\n`);stop();},opts.timeoutMs);
    const pause=opts.cancelled?setInterval(()=>{if(opts.cancelled?.()){cancelled=true;stop();}},1000):null;
    const onExit=()=>stop();process.once('exit',onExit);
    const finish=(ok:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);if(pause)clearInterval(pause);process.removeListener('exit',onExit);resolve({ok:ok&&!timedOut&&!cancelled,tail:tail.trim(),timedOut,cancelled});};
    child.once('error',error=>{keep(error.message);finish(false);});
    child.once('close',code=>finish(code===0));
  });
}
