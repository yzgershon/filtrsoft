import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openContext} from '../../src/browser/launch.mjs';

const [directory,chromePath]=process.argv.slice(2);
process.env.FILTRSOFT_AGENT_STATE=join(directory,'state');
process.env.FILTRSOFT_BROWSER_PROFILE_ROOT=join(directory,'profiles');
const options={profile:'shared',chromePath,background:true};
const powershell=join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
const execute=promisify(execFile);
async function processes() {
  const {stdout}=await execute(powershell,['-NoProfile','-NonInteractive','-Command',"Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress"],{windowsHide:true,timeout:15_000});
  return JSON.parse(stdout);
}
let context;
try {
  context=await openContext(options);
  const page=context.pages()[0];
  await page.setContent('<button onclick="this.textContent=\'Clicked\'">Test</button><div style="width:100px;height:100px;background:red"></div>');
  await page.getByRole('button').click();
  assert.equal(await page.getByRole('button').textContent(),'Clicked');
  assert.ok((await page.screenshot()).length>1000);
  await context.addCookies([{name:'filtrsoft_qa',value:'persisted',domain:'example.test',path:'/',expires:Math.floor(Date.now()/1000)+3600}]);
  await context.newPage();
  await context.close();context=null;
  context=await openContext(options);
  assert.equal((await context.cookies()).find(c=>c.name==='filtrsoft_qa')?.value,'persisted');
  await context.close();context=null;

  // Exercise Facebook's separate launcher without making any network requests.
  const {stdout}=await promisify(execFile)(process.execPath,[
    fileURLToPath(new URL('../../src/browser/fb-worker.mjs',import.meta.url)),
    'crawl',JSON.stringify({profileDir:join(directory,'facebook'),chromePath,background:true,detailsOnly:true,detailUrls:[]}),
  ],{windowsHide:true,timeout:20_000});
  assert.ok(stdout.split('\n').filter(Boolean).map(line=>JSON.parse(line)).some(row=>row.type==='done'));

  await assert.rejects(openContext({...options,chromePath:join(directory,'missing-chrome.exe')}),/Configured Chrome executable is missing/);
  // A failed native launch must also release the persistent-profile lease.
  context=await openContext(options);
  const snapshot=await processes();
  const host=snapshot.find(p=>p.ParentProcessId===process.pid&&/^desktop-.+\.exe$/.test(p.Name));
  assert.ok(host,'native host belongs to this fixture');
  const children=new Set([host.ProcessId]);
  for(let previous=-1;previous!==children.size;) {
    previous=children.size;
    for(const p of snapshot)if(children.has(p.ParentProcessId))children.add(p.ProcessId);
  }
  assert.ok(children.size>1,'Chrome children belong to the host');
  process.kill(host.ProcessId,'SIGKILL'); // Kill only the host, not its tree.
  await context.close().catch(()=>{});context=null;
  await new Promise(r=>setTimeout(r,500));
  assert.deepEqual((await processes()).filter(p=>children.has(p.ProcessId)),[],'job object reaps the browser tree after abrupt host termination');
  context=await openContext(options); // The profile must be reusable after a crash.
  console.log(JSON.stringify({interaction:true,persistentCookie:true,facebookLaunch:true,failedClosed:true,crashCleanup:true}));
} finally {await context?.close();}
