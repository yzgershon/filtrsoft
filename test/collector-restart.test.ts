import {test} from 'bun:test';
import {isolated} from './isolated.ts';
test('supervisor recovers a crashed child with backoff and keeps one owner',()=>isolated(`
  import {spawn} from 'node:child_process';import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';import {resolve,join} from 'node:path';
  import {killChildTree} from '@/src/agent/process.ts';
  const root=resolve('runtime'),state=resolve('state');mkdirSync(join(root,'src/scripts'),{recursive:true});mkdirSync(state);
  writeFileSync(join(root,'src/scripts/agent.ts'),"import {writeFileSync} from 'node:fs';writeFileSync(process.env.FILTRSOFT_AGENT_STATE+'/child.json',JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);");
  writeFileSync('fixture.env','');writeFileSync('config.json',JSON.stringify({root,state,bun:process.execPath,node:process.execPath,envFile:resolve('fixture.env'),database:resolve('fixture.db')}));
  const supervisor=new URL('src/agent/supervisor.mjs',${JSON.stringify(new URL('../',import.meta.url).href)});
  const {fileURLToPath}=await import('node:url');const parent=spawn(process.execPath,[fileURLToPath(supervisor),resolve('config.json')],{stdio:'ignore',windowsHide:true,detached:process.platform!=='win32'});
  const exited=new Promise(r=>parent.once('exit',r));
  try {
    const deadline=Date.now()+18000;while(!existsSync(join(state,'child.json'))&&Date.now()<deadline)await Bun.sleep(50);
    const first=JSON.parse(readFileSync(join(state,'child.json'),'utf8')).pid;process.kill(first,'SIGKILL');
    let second=first;while(second===first&&Date.now()<deadline){await Bun.sleep(100);second=JSON.parse(readFileSync(join(state,'child.json'),'utf8')).pid;}
    assert.notEqual(first,second);process.kill(second,0);assert.equal(JSON.parse(readFileSync(join(state,'supervisor.json'),'utf8')).restarts,1);
    writeFileSync(join(state,'stop'),'');await Promise.race([exited,Bun.sleep(5000).then(()=>{throw new Error('stop timed out');})]);assert.throws(()=>process.kill(second,0));
  }finally{killChildTree(parent);}
`),30000);
