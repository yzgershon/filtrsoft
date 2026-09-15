import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {STATE_DIR} from '../agent/state.ts';

const result:Record<string,unknown>={};
for(const file of ['status.json','supervisor.json']) {
  try{const saved=JSON.parse(readFileSync(join(STATE_DIR,file),'utf8'));result[file]={...saved,ageSeconds:Math.round((Date.now()-Date.parse(saved.updatedAt))/1000)};}
  catch{result[file]='unavailable';}
}
if(process.argv.includes('--remote')) {
  const token=process.env.FILTRSOFT_PUSH_TOKEN;
  if(!token)throw new Error('Collector environment not loaded; no credential requested or displayed.');
  const api=(process.env.FILTRSOFT_API??'https://filtrsoft.com').replace(/\/$/,'');
  const res=await fetch(`${api}/v1/jobs/diagnostics`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
  result.production=res.ok?await res.json():{error:`HTTP ${res.status}`};
}
console.log(JSON.stringify(result,null,2));
