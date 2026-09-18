/** Small targeted maintenance chunks run under the existing agent lease. */
import {dueDetails} from '../db/enrichment.ts';import {runCommand} from '../agent/process.ts';import {sourceCooldown} from '../agent/backoff.ts';
for(const [source,script] of [['facebook','fb:detail'],['offerup','ou:photos'],['mercari','mc:detail']] as const){
 if(sourceCooldown(source)||!dueDetails(source,40).some(r=>r.recovery_requested_at))continue;
 const read=await runCommand(process.execPath,['run',script,'--limit','5'],{timeoutMs:90000,onOutput:s=>process.stdout.write(s)});
 const sync=await runCommand(process.execPath,['run','push','--source',source],{timeoutMs:30000,onOutput:s=>process.stdout.write(s)});
 if(!read.ok||!sync.ok)process.exitCode=1;
}
