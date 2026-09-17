import {enrichMarketplace} from '../agent/enrich-marketplace.ts';
const i=process.argv.indexOf('--limit');
const result=await enrichMarketplace('mercari',{limit:i>=0?Number(process.argv[i+1])||20:20,
  dry:process.argv.includes('--dry'),headless:process.argv.includes('--headless')});
// Individual failures already have durable backoff. Do not stop probes and
// penalize the whole source when other item pages loaded successfully.
if(result.failed && !result.read && !result.gone)process.exitCode=1;
