/** Windows logon supervisor. Configuration contains paths, never secret values.
 * Node supervises Bun so collector crashes cannot take down its restart loop. */
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync,appendFileSync,statSync,renameSync,existsSync,writeFileSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {acquireProfileLease} from '../browser/profile-lease.mjs';

const config=JSON.parse(readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
for(const key of ['root','bun','node','envFile','database','state'])if(typeof config[key]!=='string'||!config[key])throw new Error(`Missing runner path: ${key}`);
const state=resolve(config.state);mkdirSync(state,{recursive:true});
let release;
const lockRoot=process.env.FILTRSOFT_AGENT_LOCK_DIR??join(homedir(),'.filtrsoft','runner-locks');
try {release=acquireProfileLease(join(lockRoot,'supervisor'));}catch {process.exit(0);}
const stopPath=join(state,'stop');
const logPath=join(state,'agent.log');
function log(text) {
  try {if(statSync(logPath).size>2_000_000){const old=logPath+'.previous';if(existsSync(old))unlinkSync(old);renameSync(logPath,old);}}catch {}
  appendFileSync(logPath,text);
}
let child=null,stopping=false,restarts=0,timer=null;
const status=(extra={})=>writeFileSync(join(state,'supervisor.json'),JSON.stringify({pid:process.pid,childPid:child?.pid??null,restarts,updatedAt:new Date().toISOString(),...extra},null,2));
function terminate() {
  stopping=true;clearTimeout(timer);
  if(child?.pid&&child.exitCode===null) {
    if(process.platform==='win32'){try{execFileSync('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true,timeout:10_000});}catch {}}
    else {try{process.kill(-child.pid,'SIGKILL');}catch {}}
  }
}
function launch() {
  if(stopping||existsSync(stopPath))return shutdown();
  log(`[${new Date().toISOString()}] starting current collector\n`);
  const started=Date.now();
  // The installer enables bounded free comp maintenance explicitly in config.
  process.env.FILTRSOFT_AGENT_COMPS=config.compsEnabled?'1':'0';
  child=spawn(config.bun,[`--env-file=${config.envFile}`,'run','src/scripts/agent.ts'],{cwd:config.root,shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],env:{...process.env,...(config.label?{FILTRSOFT_AGENT_LABEL:config.label}:{}),FILTRSOFT_DB:config.database,FILTRSOFT_AGENT_STATE:state,FILTRSOFT_NODE:config.node,FILTRSOFT_AGENT_VISION_LIMIT:String(config.visionLimit??0),FILTRSOFT_VISION:config.visionLimit?'1':'0',PATH:[config.node.replace(/[\\/][^\\/]+$/,''),config.bun.replace(/[\\/][^\\/]+$/,''),process.env.PATH??''].join(process.platform==='win32'?';':':')}});
  child.stdout.on('data',d=>log(String(d)));child.stderr.on('data',d=>log(String(d)));
  child.once('error',error=>log(`launch failed: ${error.message}\n`));
  child.once('close',(code,signal)=>{
    child=null;
    if(stopping)return finishShutdown();
    restarts++;const delay=Date.now()-started>5*60_000?10_000:Math.min(5*60_000,10_000*2**Math.min(restarts-1,5));
    log(`[${new Date().toISOString()}] collector exited ${code??signal}; retry in ${delay/1000}s\n`);
    status({lastExitCode:code,lastExitSignal:signal,nextStartAt:new Date(Date.now()+delay).toISOString()});
    timer=setTimeout(launch,delay);
  });
  status();
}
function finishShutdown(){release();process.exit(0);}
function shutdown(){
  if(stopping)return;
  terminate();
  // SIGKILL delivery is asynchronous on Linux. Exiting here used to orphan
  // the child before waitpid/reaping; native CI caught its PID still present.
  // Keep ownership until the child's close event confirms termination.
  if(!child)finishShutdown();
}
process.once('exit',()=>{terminate();release();});
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
setInterval(()=>{if(existsSync(stopPath))shutdown();else status();},2000);
launch();
