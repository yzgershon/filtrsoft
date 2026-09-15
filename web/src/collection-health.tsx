import {useEffect,useState} from 'react';
import {requestJSON,requestMessage} from './api-client.ts';
type Maintenance={status:string;finishedAt?:string;note:string};
type Node={id:string;label:string;revision:string;seenAt:string;online:boolean;status:string;jobId:number|null;pending:Record<string,number>|null;maintenance?:Record<string,Maintenance>};
type Source={source:string;status:string;lastSearchAt:string|null;lastSuccessAt:string|null;newestCaptureAt:string|null;lastUploadAt:string|null;issue:string|null;activeStage:string|null};
export type CollectionHealthData={allowed:boolean;at:string;nodes:Node[];sources:Source[];policy:{preferredNode:string|null;fallbackMinutes:number};server:{enabled:boolean;backup?:Maintenance|null}};
const names:Record<string,string>={facebook:'Facebook',offerup:'OfferUp',mercari:'Mercari'};
const states:Record<string,string>={working:'Collecting',healthy:'Recent search succeeded',attention:'Needs attention',stale:'No recent successful search'};
function time(value:string|null) {return value?new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Not recorded';}
export function CollectionHealthView({data,refresh,busy,error}:{data:CollectionHealthData;refresh:()=>void;busy:boolean;error:string}) {
  const online=data.nodes.filter(n=>n.online&&n.status!=='paused');
  return <section className="collection-health workspace-card" id="collection" aria-labelledby="collection-title">
    <header className="collection-heading"><div><h2 id="collection-title">Collection</h2><p>{online.length?`${online.length} computer${online.length===1?'':'s'} connected`:'No active computer connected'}</p></div><button className="btn2" onClick={refresh} disabled={busy}>{busy?'Refreshing…':'Refresh'}</button></header>
    {error&&<p className="workspace-error" role="alert">{error} Showing the last received status.</p>}
    <div className="collection-machines">{data.nodes.length?data.nodes.map(n=><div className="collection-machine" key={n.id}><div><b>{n.label}</b><span className={`collection-state ${n.online?'healthy':'stale'}`}>{n.online?n.status==='paused'?'Paused':n.jobId?'Working':'Connected':'Offline'}</span></div><p>Last contact {time(n.seenAt)} · Version {n.revision}</p><p>{n.pending===null?'Queued uploads not reported':`${Object.values(n.pending).reduce((a,b)=>a+b,0)} queued changes${n.online?'':' at last contact'}`}</p></div>):<p className="workspace-notice">No computer has reported detailed status yet. Start an updated collector to see it here.</p>}</div>
    {data.policy&&<PrimaryComputer data={data} saved={refresh}/>}
    <div className="collection-sources">{data.sources.map(s=><article className="collection-source" key={s.source}><header><h3>{names[s.source]}</h3><span className={`collection-state ${s.status}`}>{states[s.status]}</span></header><dl><div><dt>Successful search</dt><dd>{time(s.lastSuccessAt)}</dd></div><div><dt>Newest listing captured</dt><dd>{time(s.newestCaptureAt)}</dd></div><div><dt>Successful upload</dt><dd>{time(s.lastUploadAt)}</dd></div></dl>{s.issue&&<p className="collection-issue">{s.issue}</p>}{s.activeStage&&<p>Now: {s.activeStage.replaceAll('-',' ')}</p>}</article>)}</div>
    <details className="collection-routing"><summary>Backups & sold-price updates</summary>
      {data.nodes.map(n=><div className="collection-machine" key={n.id}><b>{n.label}</b><p>Local backup: {n.maintenance?.backup?`${n.maintenance.backup.status} · ${time(n.maintenance.backup.finishedAt??null)}`:'Not reported'}</p><p>Sold-price refresh: {n.maintenance?.comps?`${n.maintenance.comps.status} · ${time(n.maintenance.comps.finishedAt??null)}`:'Not reported'}</p>{Object.entries(n.maintenance??{}).filter(([,m])=>m.status==='failed').map(([name,m])=><p key={name} className="collection-issue">{name}: {m.note}</p>)}</div>)}
      <p className="micro2">Server backup: {data.server.backup?`${data.server.backup.status} · ${time(data.server.backup.finishedAt??null)}`:'Not recorded'}. Local snapshots protect against bad changes; a separate backup location is needed for loss of the computer or volume.</p>
      {data.server.backup?.status==='failed'&&<p className="collection-issue">{data.server.backup.note}</p>}
    </details>
    <p className="workspace-notice">Craigslist runs on the server{data.server.enabled?'.':' and is currently disabled.'} Facebook, OfferUp and Mercari need an awake computer. A successful search can find zero new listings.</p>
    <p className="micro2">Status received {time(data.at)}. Queued changes describe saved uploads; an offline computer may have newer work.</p>
  </section>;
}
function PrimaryComputer({data,saved}:{data:CollectionHealthData;saved:()=>void}) {
  const [draft,setDraft]=useState<CollectionHealthData['policy']|null>(null),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const policy=draft??data.policy,preferred=policy.preferredNode??'',delay=policy.fallbackMinutes;
  // Keep the open form and focus after a save. Polls update pristine fields,
  // but cannot erase an edit while another computer changes the preference.
  useEffect(()=>{if(draft&&draft.preferredNode===data.policy.preferredNode&&draft.fallbackMinutes===data.policy.fallbackMinutes)setDraft(null);},[draft,data.policy.preferredNode,data.policy.fallbackMinutes]);
  return <details className="collection-routing"><summary>Primary computer & fallback</summary><form onSubmit={async e=>{e.preventDefault();setSaving(true);setError('');try{await requestJSON('/v1/collection/policy',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({preferredNode:preferred||null,fallbackMinutes:delay})},v=>v?.ok===true);saved();}catch(e){setError(requestMessage(e));}finally{setSaving(false);}}}>
    <div className="workspace-field"><label htmlFor="collection-primary">Primary computer</label><select id="collection-primary" value={preferred} onChange={e=>setDraft({...policy,preferredNode:e.target.value||null})} disabled={saving}><option value="">Any available computer</option>{data.nodes.map(n=><option key={n.id} value={n.id}>{n.label}</option>)}</select></div>
    <div className="workspace-field"><label htmlFor="collection-fallback">Use a backup after this many minutes offline</label><input id="collection-fallback" type="number" min="3" max="60" required value={delay} onChange={e=>setDraft({...policy,fallbackMinutes:Number(e.target.value)})} disabled={saving||!preferred}/></div>
    <p className="micro2">A backup must be connected and signed into the marketplaces. Changing the primary does not interrupt work already running. Pausing the primary allows a backup to collect.</p>
    {error&&<p role="alert" className="workspace-error">{error}</p>}<button className="btn2" disabled={saving}>{saving?'Saving…':'Save preference'}</button>
  </form></details>;
}
export function CollectionHealth() {
  const [data,setData]=useState<CollectionHealthData|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{const ac=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function read(){if(ac.signal.aborted)return;if(document.hidden){timer=setTimeout(read,30000);return;}setBusy(true);
      try{const value=await requestJSON<CollectionHealthData>('/v1/collection/health',{signal:ac.signal},v=>typeof v?.allowed==='boolean'&&(!v.allowed||Array.isArray(v.sources)&&Array.isArray(v.nodes)));
        if(!ac.signal.aborted){setData(value);setError('');}}
      catch(e){if(!ac.signal.aborted)setError(requestMessage(e));}
      finally{if(!ac.signal.aborted){setBusy(false);timer=setTimeout(read,30000);}}}
    void read();return()=>{ac.abort();clearTimeout(timer);};},[retry]);
  if(data&&!data.allowed)return null;
  if(!data)return error?<section className="workspace-card"><p role="alert">Collection status: {error}</p><button className="btn2" onClick={()=>setRetry(n=>n+1)}>Try again</button></section>:null;
  return <CollectionHealthView data={data} error={error} busy={busy} refresh={()=>setRetry(n=>n+1)}/>;
}
