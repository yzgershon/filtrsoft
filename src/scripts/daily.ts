/** Manual fallback. The Windows daily task ensures the managed agent is alive;
 * it does not start a second independent crawl against the same profiles. */
import {collect,collectionPlan,SOURCES} from '../agent/collection.ts';
import {claimRunner,advanceCursor} from '../agent/state.ts';
import {runCommand} from '../agent/process.ts';
import {isPaused} from './pause.ts';

if(isPaused()){console.log('daily: paused; no work claimed');process.exit(0);}
if(process.argv.includes('--dry')){console.log(JSON.stringify(collectionPlan([...SOURCES],0),null,2));process.exit(0);}
let release:()=>void;
try{release=claimRunner();}catch(error){console.log(`daily: another collector owns this machine; ${String(error)}`);process.exit(0);}
try {
  const summary=await collect([...SOURCES],{cursor:advanceCursor(2),limit:process.argv.includes('--fast')?6:12,paused:isPaused,
    run:step=>runCommand(process.execPath,step.args,{timeoutMs:step.timeoutMs,cancelled:step.kind==='sync'?undefined:isPaused,onOutput:text=>process.stdout.write(text)}),
    stage:async(step,status,error)=>{console.log(`[${new Date().toISOString()}] ${step.name}: ${status}${error?` ${error}`:''}`);}});
  console.log(JSON.stringify(summary,null,2));
  if(Object.values(summary).some(s=>s!=='ok'))process.exitCode=1;
} finally {release();}
