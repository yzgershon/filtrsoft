import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {readLocalPhotos,evaluateRead,gpuAvailable} from '../vision/local-lab.ts';
const arg=(key:string)=>{const i=process.argv.indexOf('--'+key);return i>=0?process.argv[i+1]:undefined;};
const path=arg('manifest'),model=arg('model'),digest=arg('digest'),output=arg('out');
if(!path||!model||!digest||!output)throw new Error('Usage: bun run vision:local-eval --manifest cases.json --model installed-model --digest full-sha256 --out new-report.json');
if(existsSync(output))throw new Error('Choose a new report path to preserve earlier evaluations');
const manifest=readFileSync(path,'utf8');
const cases=z.array(z.object({id:z.string(),category:z.string(),split:z.enum(['development','heldout']).default('development'),photos:z.array(z.string()).min(1),expected:z.record(z.string(),z.array(z.string()))})).min(1).parse(JSON.parse(manifest));
const results:Array<{id:string;category:string;split:string;read?:Awaited<ReturnType<typeof readLocalPhotos>>;metrics?:ReturnType<typeof evaluateRead>;error?:string}>=[];
for(const item of cases) {
  const deadline=Date.now()+60000;while(!gpuAvailable()&&Date.now()<deadline)await Bun.sleep(2000);
  try{const read=await readLocalPhotos(item.photos.map(p=>resolve(dirname(path),p)),{model,digest});results.push({id:item.id,category:item.category,split:item.split,read,metrics:evaluateRead(item.expected,read)});}
  catch(e){results.push({id:item.id,category:item.category,split:item.split,error:String(e)});}
  console.log(JSON.stringify({id:item.id,completed:results.length,total:cases.length,error:results.at(-1)?.error,elapsedMs:results.at(-1)?.read?.elapsedMs}));
  writeFileSync(output+'.partial',JSON.stringify({model,digest,manifestSha256:createHash('sha256').update(manifest).digest('hex'),results},null,2));
}
const totals=results.reduce((sum,r)=>({correct:sum.correct+(r.metrics?.correct??0),missed:sum.missed+(r.metrics?.missed??0),unsupported:sum.unsupported+(r.metrics?.unsupported??0),failed:sum.failed+('error' in r?1:0)}),{correct:0,missed:0,unsupported:0,failed:0});
const splits=Object.fromEntries(['development','heldout'].map(split=>{const rows=results.filter(r=>r.split===split),correct=rows.reduce((n,r)=>n+(r.metrics?.correct??0),0),missed=rows.reduce((n,r)=>n+(r.metrics?.missed??0),0),unsupported=rows.reduce((n,r)=>n+(r.metrics?.unsupported??0),0);return [split,{cases:rows.length,correct,missed,unsupported,precision:correct+unsupported?correct/(correct+unsupported):0,recall:correct+missed?correct/(correct+missed):0}];}));
const report={at:new Date().toISOString(),model,digest,manifestSha256:createHash('sha256').update(manifest).digest('hex'),usage:'evaluation-only',caseCount:cases.length,totals,splits,results,
  readyForReview:cases.length>=20&&new Set(cases.map(c=>c.category)).size>=3&&splits.heldout.cases>=8&&totals.failed===0&&totals.unsupported===0&&Object.values(splits).every(s=>s.precision>=.95&&s.recall>=.8),
  note:'Review readiness is not permission to merge model output into valuations. Inspect missed fields, conflicts and original photos.'};
writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({report:resolve(output),totals,readyForReview:report.readyForReview}));if(totals.failed)process.exitCode=1;
