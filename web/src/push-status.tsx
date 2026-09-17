import {useEffect,useState} from 'react';
import {requestJSON} from './api-client.ts';
import {pushRoute} from './history.ts';
type Status={configured:boolean;subscriptions:{id:number;lastAcceptedAt:string|null}[];searches:{paused:number|null};deliveries:{status:string;count:number}[]};
export function PushDeliveryStatus() {
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(false);
  useEffect(()=>{const c=new AbortController();requestJSON<Status>('/v1/push/status',{signal:c.signal}).then(setStatus).catch(()=>{if(!c.signal.aborted)setError(true);});return()=>c.abort();},[]);
  const last=status?.subscriptions.map(s=>s.lastAcceptedAt).filter((s):s is string=>Boolean(s)).sort().at(-1);
  const failed=status?.deliveries.filter(d=>d.status==='failed'||d.status==='retry').reduce((n,d)=>n+d.count,0)??0;
  return <div className="srow static"><span className="stext"><b>Push delivery</b><span>
    {error?'Could not check delivery status.':!status?'Checking registered devices…':!status.configured?'Delivery is unavailable on the server.':!status.subscriptions.length?'No device is registered for this account.':`${status.subscriptions.length} registered device${status.subscriptions.length===1?'':'s'}. ${last?`Last accepted push ${new Date(last).toLocaleString()}.`:'No push has been accepted yet.'}`}
    {!!status?.searches.paused&&` ${status.searches.paused} saved searches have notifications paused.`}
    {!!failed&&` ${failed} deliveries need attention.`}
    {' Push permission belongs to each device; open these controls on your phone to check its connection.'}
  </span></span><button className="btn3" onClick={()=>pushRoute('/saved?sub=alerts')}>Manage</button></div>;
}
