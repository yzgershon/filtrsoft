import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {z} from 'zod';
import {readLocalPhotos,evaluateRead} from '../vision/local-lab.ts';
const arg=(key:string)=>{const i=process.argv.indexOf('--'+key);return i>=0?process.argv[i+1]:undefined;};
const path=arg('manifest'),model=arg('model'),digest=arg('digest'),output=arg('out');
if(!path||!model||!digest||!output)throw new Error('Usage: bun run vision:local-eval --manifest cases.json --model installed-model --digest full-sha256 --out new-report.json');
if(existsSync(output))throw new Error('Choose a new report path to preserve earlier evaluations');
const cases=z.array(z.object({id:z.string(),category:z.string(),photos:z.array(z.string()).min(1),expected:z.record(z.string(),z.array(z.string()))})).min(1).parse(JSON.parse(readFileSync(path,'utf8')));
const results=[];
for(const item of cases) {
  try{const read=await readLocalPhotos(item.photos.map(p=>resolve(dirname(path),p)),{model,digest});results.push({id:item.id,category:item.category,read,metrics:evaluateRead(item.expected,read)});}
  catch(e){results.push({id:item.id,category:item.category,error:String(e)});}
}
const totals=results.reduce((sum,r)=>({correct:sum.correct+(r.metrics?.correct??0),missed:sum.missed+(r.metrics?.missed??0),unsupported:sum.unsupported+(r.metrics?.unsupported??0),failed:sum.failed+('error' in r?1:0)}),{correct:0,missed:0,unsupported:0,failed:0});
const report={at:new Date().toISOString(),model,digest,usage:'evaluation-only',caseCount:cases.length,totals,results,
  readyForReview:cases.length>=20&&new Set(cases.map(c=>c.category)).size>=3&&totals.failed===0&&totals.unsupported===0,
  note:'Review readiness is not permission to merge model output into valuations. Inspect missed fields, conflicts and original photos.'};
writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({report:resolve(output),totals,readyForReview:report.readyForReview}));if(totals.failed)process.exitCode=1;
