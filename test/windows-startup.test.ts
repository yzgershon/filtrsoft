import {test,expect} from 'bun:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {psQuote,windowsStartupScript} from '../src/agent/windows-startup.ts';

// This executes the real Windows cmdlets, but never the installed task or real
// Startup folder. The scheduled action only writes a receipt in the temp dir.
test.skipIf(process.platform!=='win32')('fresh startup installs, launches, and preserves an existing recovery schedule',()=>{
  const directory=mkdtempSync(join(tmpdir(),'filtrsoft-startup-test-'));
  const state=join(directory,"Yish's runner state"),startup=join(directory,'Startup');
  mkdirSync(state);mkdirSync(startup);
  const taskName=`Filtrsoft Startup Test ${crypto.randomUUID()}`;
  const powershell=join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const ps=(script:string)=>execFileSync(powershell,['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:30000}).trim();
  const receipt=join(state,'launched.txt');
  const actionArgs=`-NoProfile -NonInteractive -WindowStyle Hidden -Command "Set-Content -LiteralPath ${psQuote(receipt)} -Value 'first'"`;
  const inspect=()=>JSON.parse(ps(`$t=Get-ScheduledTask -TaskPath '\\' -TaskName ${psQuote(taskName)}; $l=(New-Object -ComObject WScript.Shell).CreateShortcut(${psQuote(join(startup,'Filtrsoft Agent.lnk'))}); [pscustomobject]@{time=$t.Triggers[0].StartBoundary;logon=[string]$t.Principal.LogonType;runLevel=[string]$t.Principal.RunLevel;startWhenAvailable=$t.Settings.StartWhenAvailable;multiple=[string]$t.Settings.MultipleInstances;limit=$t.Settings.ExecutionTimeLimit;execute=$t.Actions[0].Execute;arguments=$t.Actions[0].Arguments;shortcutTarget=$l.TargetPath;shortcutArguments=$l.Arguments;shortcutDirectory=$l.WorkingDirectory} | ConvertTo-Json -Compress`));
  try {
    writeFileSync(join(startup,'Filtrsoft Agent.cmd'),'legacy launcher');
    ps(windowsStartupScript({state,startupPath:startup,taskName,powershell,actionArgs}));
    const initial=inspect();
    expect(initial).toMatchObject({logon:'Interactive',runLevel:'Limited',startWhenAvailable:true,multiple:'IgnoreNew',limit:'PT5M',execute:powershell,arguments:actionArgs,shortcutArguments:actionArgs,shortcutDirectory:state});
    expect(initial.shortcutTarget.toLowerCase()).toBe(powershell.toLowerCase());
    expect(initial.time).toContain('T10:00:00');
    expect(readdirSync(startup)).toEqual(['Filtrsoft Agent.lnk']);
    expect(readdirSync(state).some(name=>name.endsWith('.cmd'))).toBe(true);
    ps(`Start-ScheduledTask -TaskPath '\\' -TaskName ${psQuote(taskName)}; $end=(Get-Date).AddSeconds(15); while(!(Test-Path -LiteralPath ${psQuote(receipt)}) -and (Get-Date) -lt $end){Start-Sleep -Milliseconds 100}`);
    expect(readFileSync(receipt,'utf8').trim()).toBe('first');
    ps(`$trigger=New-ScheduledTaskTrigger -Daily -At '13:17'; $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 7); Set-ScheduledTask -TaskPath '\\' -TaskName ${psQuote(taskName)} -Trigger $trigger -Settings $settings | Out-Null`);
    const modified=inspect(),newArgs=actionArgs.replace("-Value 'first'","-Value 'updated'");
    ps(windowsStartupScript({state,startupPath:startup,taskName,powershell,actionArgs:newArgs}));
    expect(inspect()).toEqual({...modified,arguments:newArgs,shortcutArguments:newArgs});
    expect(readdirSync(state).some(name=>name.endsWith('.xml'))).toBe(true);
    expect(readdirSync(state).some(name=>name.endsWith('.lnk'))).toBe(true);
  } finally {
    ps(`$t=Get-ScheduledTask -TaskPath '\\' -TaskName ${psQuote(taskName)} -ErrorAction SilentlyContinue; if($t){Stop-ScheduledTask -InputObject $t; Unregister-ScheduledTask -InputObject $t -Confirm:$false}; exit 0`);
    if(dirname(resolve(directory))!==resolve(tmpdir())||!directory.includes('filtrsoft-startup-test-'))throw new Error('Unexpected fixture path');
    rmSync(directory,{recursive:true,force:true});
  }
},60000);
