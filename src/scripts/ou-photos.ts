import {enrichMarketplace} from '../agent/enrich-marketplace.ts';
const i=process.argv.indexOf('--limit');
const result=await enrichMarketplace('offerup',{limit:i>=0?Number(process.argv[i+1])||20:20,
  dry:process.argv.includes('--dry'),all:process.argv.includes('--all'),headless:process.argv.includes('--headless')});
if(result.failed && !result.read && !result.gone)process.exitCode=1;
