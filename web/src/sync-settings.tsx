import {useEffect,useState} from 'react';
import {onAccountData,syncStatus,syncNow,resolveSync,syncConflicts} from './account-sync.ts';
import {Check,Again,Alert} from './icons.tsx';
const fieldNames:Record<string,string>={theme:'Color theme',compact:'Denser grid',driveMinutes:'Driving time',hideGone:'Hide unavailable listings',reduceMotion:'Reduce motion',askOutcomes:'Purchase follow-ups',alerts:'Deal banners',alertVerify:'Verify alerts',showAge:'Listing age',showCall:'Verdict badges',driveVersion:'Driving preferences'};
const conflictLabel=(key:string)=>{const [kind,id]=key.split(':');return kind==='setting'?fieldNames[id]??id:kind==='saved'?`Saved listing #${id}`:kind==='history'?`Recent listing #${id}`:kind==='note'?`Notification #${id}`:kind==='asked'?`Follow-up for listing #${id}`:kind==='seen'?`New-listing marker: ${id}`:'Follow-up reminder time';};
const describe=(key:string,value:unknown)=>{
  if(value===null)return 'Removed';
  if(typeof value==='boolean')return value?'On':'Off';
  if(key==='setting:driveMinutes')return `${value} minutes`;
  if(key.startsWith('setting:'))return String(value);
  if(typeof value==='object'&&value){const v=value as {title?:string;seen?:boolean;at?:number};return `${v.title??'Listing'}${v.seen===undefined?'':v.seen?' · Read':' · Unread'}${v.at?' · '+new Date(v.at).toLocaleString():''}`;}
  if(key.startsWith('saved:'))return 'Saved';
  return new Date(value as string|number).toLocaleString();
};
export function SyncSettings(){
  const [status,setStatus]=useState(syncStatus);
  useEffect(()=>onAccountData(()=>setStatus(syncStatus())),[]);
  const good=status.phase==='synced',busy=status.phase==='syncing'||status.phase==='loading';
  const title=good?'Everything is synced':busy?'Syncing your workspace':status.phase==='conflict'?'Changes need your review':status.phase==='offline'?'Waiting for a connection':'Sync needs attention';
  return <div className="sgroup" id="sync" tabIndex={-1}>
    <div className="shead"><Again size={14}/> Account sync</div>
    <div className="scard account-sync-card">
      <div className="srow static"><span className={`sync-orb ${good?'ok':''}`}>{good?<Check size={20}/>:busy?<Again size={20}/>:<Alert size={20}/>}</span><span className="stext"><b role="status">{title}</b><span>{status.lastSync?`Last synced ${new Date(status.lastSync).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`:'Connecting this device to your account'}{status.pending?` · ${status.pending} pending`:''}</span></span><button className="btn3" disabled={busy} onClick={()=>void syncNow()}>Sync now</button></div>
      <p className="snote nolead">Saved data follows this account on every computer and phone. Bookmarks, preferences and recent activity refresh when you return and every 15 seconds while the app is open.</p>
      <div className="sync-includes"><span><Check size={14}/> Saved listings & recent history</span><span><Check size={14}/> Preferences & notification history</span><span><Check size={14}/> Reviews, notes & purchases</span><span><Check size={14}/> Market pins & saved searches</span></div>
      {status.error&&<p className="snote danger" role="alert">{status.error}</p>}
      {status.conflicts>0&&<div className="sync-conflict"><b>{status.conflicts} overlapping {status.conflicts===1?'change':'changes'}</b><p>Another device changed the same information. Your pending version is still stored here. Choose which version to keep for each change.</p>{syncConflicts().map(c=><section className="sync-choice" key={c.key} aria-label={conflictLabel(c.key)}><h3>{conflictLabel(c.key)}</h3><dl><div><dt>This device</dt><dd>{describe(c.key,c.local)}</dd></div><div><dt>Synced version</dt><dd>{describe(c.key,c.cloud)}</dd></div></dl><button className="btn2" onClick={()=>resolveSync(true,c.key)}>Keep this device</button><button className="btn3" onClick={()=>resolveSync(false,c.key)}>Use synced version</button></section>)}</div>}
      <p className="snote">Notification permission, installation, and unsaved editor drafts belong to each device. Save inspection and purchase edits to sync them. Offline changes stay queued until this device reconnects.</p>
    </div>
  </div>;
}
