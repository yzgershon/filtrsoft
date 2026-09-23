/** Generate the same per-user launcher for logon and Task Scheduler.
 * Optional names/paths let Windows regression tests use disposable artifacts. */
export const psQuote=(value:string)=>"'"+value.replaceAll("'","''")+"'";

export function windowsStartupScript(options:{state:string;powershell:string;actionArgs:string;startupPath?:string;taskName?:string}) {
  const {state,powershell,actionArgs}=options;
  return `$ErrorActionPreference='Stop'
$startup=${options.startupPath?psQuote(options.startupPath):"[Environment]::GetFolderPath('Startup')"}
$taskName=${psQuote(options.taskName??'Filtrsoft Daily Crawl')}
$stamp=Get-Date -Format 'yyyyMMddHHmmssfff'
$action=New-ScheduledTaskAction -Execute ${psQuote(powershell)} -Argument ${psQuote(actionArgs)} -WorkingDirectory ${psQuote(state)}
$task=Get-ScheduledTask -TaskPath '\\' -TaskName $taskName -ErrorAction SilentlyContinue
if($task){
  Export-ScheduledTask -TaskPath '\\' -TaskName $taskName | Set-Content -LiteralPath (Join-Path ${psQuote(state)} ('legacy-task-'+$stamp+'.xml'))
  Set-ScheduledTask -TaskPath '\\' -TaskName $taskName -Action $action | Out-Null
}else{
  $trigger=New-ScheduledTaskTrigger -Daily -At '10:00'
  $principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
  Register-ScheduledTask -TaskPath '\\' -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
}
$old=Join-Path $startup 'Filtrsoft Agent.cmd'
if(Test-Path -LiteralPath $old){Copy-Item -LiteralPath $old -Destination (Join-Path ${psQuote(state)} ('legacy-startup-'+$stamp+'.cmd'))}
$link=Join-Path $startup 'Filtrsoft Agent.lnk'
if(Test-Path -LiteralPath $link){Copy-Item -LiteralPath $link -Destination (Join-Path ${psQuote(state)} ('legacy-startup-'+$stamp+'.lnk'))}
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut($link)
$shortcut.TargetPath=${psQuote(powershell)}
$shortcut.Arguments=${psQuote(actionArgs)}
$shortcut.WorkingDirectory=${psQuote(state)}
$shortcut.WindowStyle=7
$shortcut.Save()
if(Test-Path -LiteralPath $old){Remove-Item -LiteralPath $old}
exit 0
`;
}
