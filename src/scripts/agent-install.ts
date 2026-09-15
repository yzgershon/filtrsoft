/** Install a hidden per-user collector using existing Node and Bun. No
 * execution-policy changes and no secret values in shortcuts or task actions. */
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
if(process.platform!=='win32')throw new Error('This installer requires Windows.');
const arg=(key:string)=>{const i=process.argv.indexOf('--'+key);return i>=0?process.argv[i+1]:undefined;};
const root=process.cwd(),state=resolve(arg('state')??join(homedir(),'.filtrsoft','runner'));
const envFile=resolve(arg('env-file')??'.env'),database=resolve(arg('database')??process.env.FILTRSOFT_DB??'filtrsoft.db');
const node=arg('node')??process.env.FILTRSOFT_NODE??execFileSync('where.exe',['node'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0];
for(const path of [process.execPath,node,envFile,database])if(!existsSync(path))throw new Error(`Required existing file missing: ${path}`);
mkdirSync(state,{recursive:true});
const configPath=join(state,'config.json'),start=join(state,'start.cjs');
writeFileSync(configPath,JSON.stringify({root,state,bun:process.execPath,node,envFile,database,label:arg('label'),compsEnabled:!process.argv.includes('--no-comps'),visionLimit:0},null,2));
writeFileSync(start,`const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const configPath=path.join(__dirname,'config.json'),config=JSON.parse(fs.readFileSync(configPath,'utf8'));
const stop=path.join(config.state,'stop');if(fs.existsSync(stop))fs.unlinkSync(stop);
spawn(config.node,[path.join(config.root,'src/agent/supervisor.mjs'),configPath],{cwd:config.root,windowsHide:true,detached:true,stdio:'ignore'}).unref();
`);
// PowerShell runs only native shortcut/task cmdlets. The actual startup code is
// a Node module; local .ps1 execution is disabled on this Windows installation.
const quote=(s:string)=>"'"+s.replaceAll("'","''")+"'";
const launch=`Start-Process -FilePath ${quote(node)} -WorkingDirectory ${quote(state)} -WindowStyle Hidden -ArgumentList ${quote('"'+start+'"')}`;
const powershell=join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
const actionArgs='-NoProfile -NonInteractive -WindowStyle Hidden -Command "'+launch.replaceAll('"','\\"')+'"';
writeFileSync(join(state,'install-preview.json'),JSON.stringify({executable:powershell,arguments:actionArgs,start,configPath},null,2));
if(process.argv.includes('--prepare')){console.log(`Prepared ${configPath}; startup and task unchanged.`);process.exit(0);}
const install=`$ErrorActionPreference='Stop'
$startup=[Environment]::GetFolderPath('Startup')
$stamp=Get-Date -Format 'yyyyMMddHHmmss'
$old=Join-Path $startup 'Filtrsoft Agent.cmd'
if(Test-Path -LiteralPath $old){Copy-Item -LiteralPath $old -Destination (Join-Path ${quote(state)} ('legacy-startup-'+$stamp+'.cmd'))}
$link=Join-Path $startup 'Filtrsoft Agent.lnk'
if(Test-Path -LiteralPath $link){Copy-Item -LiteralPath $link -Destination (Join-Path ${quote(state)} ('legacy-startup-'+$stamp+'.lnk'))}
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut($link)
$shortcut.TargetPath=${quote(powershell)}
$shortcut.Arguments=${quote(actionArgs)}
$shortcut.WorkingDirectory=${quote(state)}
$shortcut.WindowStyle=7
$shortcut.Save()
if(Test-Path -LiteralPath $old){Remove-Item -LiteralPath $old}
$task=Get-ScheduledTask -TaskName 'Filtrsoft Daily Crawl' -ErrorAction SilentlyContinue
if($task){
Export-ScheduledTask -TaskName 'Filtrsoft Daily Crawl' | Set-Content -LiteralPath (Join-Path ${quote(state)} ('legacy-task-'+$stamp+'.xml'))
$action=New-ScheduledTaskAction -Execute ${quote(powershell)} -Argument ${quote(actionArgs)} -WorkingDirectory ${quote(state)}
Set-ScheduledTask -TaskName 'Filtrsoft Daily Crawl' -Action $action | Out-Null
}
`;
execFileSync(powershell,['-NoProfile','-NonInteractive','-Command',install],{stdio:'inherit',windowsHide:true});
console.log(`Installed hidden collector at logon. Daily recovery uses the same supervisor. Logs/status: ${state}`);
console.log(`Start now: node "${start}"`);
