/**
 * Milliseconds since the last keyboard or mouse input in this Windows session,
 * or null when it cannot be measured. The OMEN is also Yish's gaming PC: local
 * model work may start only after he has stepped away, and stops when he is
 * back. Unknown is treated as "present" by callers.
 */
import {execFileSync} from 'node:child_process';

const SCRIPT=`Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class FiltrsoftIdle{[StructLayout(LayoutKind.Sequential)]struct L{public uint cb;public uint t;}[DllImport("user32.dll")]static extern bool GetLastInputInfo(ref L l);public static long Ms(){L l=new L();l.cb=(uint)Marshal.SizeOf(typeof(L));if(!GetLastInputInfo(ref l))return -1;return (long)unchecked((uint)Environment.TickCount-l.t);}}';[FiltrsoftIdle]::Ms()`;
const encoded=Buffer.from(SCRIPT,'utf16le').toString('base64');

export function userIdleMs(run=()=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{encoding:'utf8',windowsHide:true,timeout:20_000,stdio:['ignore','pipe','ignore']})):number|null {
  if(process.platform!=='win32')return null;
  try{const n=Number(String(run()).trim());return Number.isSafeInteger(n)&&n>=0?n:null;}catch{return null;}
}
