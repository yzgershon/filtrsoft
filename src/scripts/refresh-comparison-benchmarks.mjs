// Separate public benchmark snapshot. Never touches listing/comps databases or
// the deployment valuation archive, and no browser or paid service is involved.
import {writeFile,rename,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source='https://opendata.blender.org/benchmarks/query/?blender_version=4.5.0&operating_system=Windows&group_by=device_name&group_by=compute_type&response_type=datatables';
const response=await fetch(source,{signal:AbortSignal.timeout(25000)});
if(!response.ok)throw Error(`Benchmark download returned ${response.status}`);
const raw=await response.text();if(raw.length>1000000)throw Error('Unexpectedly large benchmark response');
const result=JSON.parse(raw);
if(!Array.isArray(result.rows)||result.rows.length<100||result.columns?.length!==4)throw Error('Benchmark schema changed');
const rows=result.rows.map(row=>{
  const [device,backend,median,submissions]=row;
  if(typeof device!=='string'||typeof backend!=='string'||!Number.isFinite(median)||median<=0||!Number.isSafeInteger(submissions)||submissions<1)throw Error('Invalid benchmark row');
  return {device,backend,median,submissions};
});
const snapshot={version:1,revision:createHash('sha256').update(raw).digest('hex'),retrievedAt:new Date().toISOString(),
  source:{name:'Blender Open Data',url:source,license:'Public domain',licenseUrl:'https://www.blender.org/news/introducing-blender-benchmark/'},suite:'Blender 4.5.0',os:'Windows',rows};
const path=new URL('../../data/hardware-benchmarks.json',import.meta.url),tmp=new URL('../../data/hardware-benchmarks.json.tmp',import.meta.url);
await mkdir(new URL('../../data/',import.meta.url),{recursive:true});await writeFile(tmp,JSON.stringify(snapshot)+'\n');await rename(tmp,path);
console.log(JSON.stringify({rows:rows.length,revision:snapshot.revision,retrievedAt:snapshot.retrievedAt,suite:snapshot.suite,os:snapshot.os}));
