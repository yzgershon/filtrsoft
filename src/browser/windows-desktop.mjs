import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync,readFileSync,mkdirSync,renameSync,unlinkSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {homedir} from 'node:os';

const execute=promisify(execFile);
const source=fileURLToPath(new URL('./windows-desktop-host.cs',import.meta.url));
const psQuote=s=>"'"+s.replaceAll("'","''")+"'";
let compiling;

export function needsPrivateDesktop({background,headless},platform=process.platform) {
  return platform==='win32'&&background===true&&!headless;
}

/** Build our small native launcher with Windows' existing .NET compiler. No
 * downloads, elevation, execution-policy changes or system settings. Cache by
 * source hash; parallel workers publish complete executables via atomic rename. */
export async function desktopHost() {
  if(compiling)return compiling;
  compiling=(async()=>{
    const digest=createHash('sha256').update(readFileSync(source)).digest('hex').slice(0,20);
    const cache=join(process.env.FILTRSOFT_AGENT_STATE??join(homedir(),'.filtrsoft','runner'),'browser-host');
    mkdirSync(cache,{recursive:true});
    const target=join(cache,`desktop-${digest}.exe`);
    if(existsSync(target))return target;
    const temporary=join(cache,`${process.pid}-${randomUUID()}.exe`);
    const powershell=join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
    try {
      await execute(powershell,['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop';Add-Type -Path ${psQuote(source)} -OutputAssembly ${psQuote(temporary)} -OutputType ConsoleApplication`],{windowsHide:true,timeout:30_000});
      try{renameSync(temporary,target);}catch(error){if(!existsSync(target))throw error;}
      return target;
    } finally {try{unlinkSync(temporary);}catch{}}
  })();
  try{return await compiling;}catch(error){compiling=undefined;throw error;}
}

export async function backgroundLaunchOptions({background,headless,executablePath}) {
  if(!needsPrivateDesktop({background,headless}))return {executablePath};
  if(!executablePath)throw new Error('An explicit browser executable is required for desktop isolation');
  return {executablePath:await desktopHost(),env:{...process.env,FILTRSOFT_DESKTOP_BROWSER:executablePath}};
}
