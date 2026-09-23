/** Read-only migration checks. Environment values and browser cookies never print. */
import {existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {runnerVersion,STATE_DIR} from '../agent/state.ts';
import {CHROME_PATH,PROFILE_DIR} from '../sources/facebook.ts';
const arg=(key:string)=>{const i=process.argv.indexOf('--'+key);return i>=0?process.argv[i+1]:undefined;};
// Match the install command's explicit state path. Previously --state was
// ignored, so a successful doctor could inspect a different installation.
const state=resolve(arg('state')??STATE_DIR);
const config=(()=>{try{return JSON.parse(readFileSync(join(state,'config.json'),'utf8'));}catch{return null;}})();
let node=false;try{execFileSync(arg('node')??config?.node??process.env.FILTRSOFT_NODE??'node',['--version'],{stdio:'pipe',windowsHide:true,timeout:5000});node=true;}catch{}
const checks={revision:runnerVersion(),platform:process.platform,arch:process.arch,bun:process.versions.bun,node,chrome:existsSync(CHROME_PATH),
  environmentFile:existsSync(arg('env-file')??config?.envFile??'.env'),database:existsSync(arg('database')??config?.database??process.env.FILTRSOFT_DB??'filtrsoft.db'),
  state,launcherPrepared:existsSync(join(state,'start.cjs')),facebookProfileExists:existsSync(PROFILE_DIR),
  profileRootExists:existsSync(join(homedir(),'.filtrsoft')),note:'Profile existence does not verify sign-in. No login or credential read performed.'};
console.log(JSON.stringify(checks,null,2));if(!node||!checks.chrome||!checks.environmentFile||!checks.database)process.exitCode=1;
