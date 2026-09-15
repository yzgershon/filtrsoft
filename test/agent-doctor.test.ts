import {test} from 'bun:test';
import {isolated} from './isolated.ts';
import {fileURLToPath} from 'node:url';
test('doctor checks the explicitly selected installation without reading private configuration',()=>isolated(`
  import {mkdirSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';
  const state=resolve('selected-state');mkdirSync(state);
  writeFileSync(state+'/config.json',JSON.stringify({node:process.execPath,envFile:resolve('private.env'),database:resolve('ingestion.db')}));
  writeFileSync(state+'/start.cjs','');writeFileSync('ingestion.db','');writeFileSync('private.env','FILTRSOFT_PUSH_TOKEN=fixture-must-never-print');
  const script=${JSON.stringify(fileURLToPath(new URL('../src/scripts/agent-doctor.ts',import.meta.url)))};
  const run=(extra=[])=>Bun.spawnSync({cmd:[process.execPath,script,'--state',state,...extra],env:{...process.env,FILTRSOFT_NODE:resolve('missing-node'),FILTRSOFT_CHROME_PATH:process.execPath,FILTRSOFT_DB:resolve('wrong.db')},stdout:'pipe',stderr:'pipe'});
  const result=run(),output=new TextDecoder().decode(result.stdout),checks=JSON.parse(output);
  assert.equal(result.exitCode,0);assert.equal(checks.state,state);assert.equal(checks.node,true);assert.equal(checks.environmentFile,true);assert.equal(checks.database,true);assert.equal(checks.launcherPrepared,true);assert.ok(!output.includes('fixture-must-never-print'));
  const missing=run(['--node',resolve('missing-node'),'--database',resolve('missing.db')]);
  assert.equal(missing.exitCode,1);const failed=JSON.parse(new TextDecoder().decode(missing.stdout));assert.equal(failed.node,false);assert.equal(failed.database,false);
`));
