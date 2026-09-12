import {useEffect,useState} from 'react';
import {requestJSON,requestMessage} from './api-client.ts';
type Health={engine:string;db:string;comps?:{usable:number;total:number;skusPriceable:number;skusTotal:number;newestSoldAt:string|null;warning:string|null};
  crawlButton?:{agentOnline:boolean;lastAgentPollAt:string|null};scoring?:{pending:number;failures:number};funnel?:{counts?:{discovered:number;scored:number}};sweep?:{lastAt:string|null}};
const date=(s?:string|null)=>s&&Number.isFinite(Date.parse(s))?new Date(s).toLocaleString():'Not recorded';
function StatusRead() {
  const [h,setH]=useState<Health|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{const ac=new AbortController();setError('');requestJSON<Health>('/v1/health',{signal:ac.signal},v=>typeof v?.engine==='string').then(v=>{if(!ac.signal.aborted)setH(v);}).catch(e=>{if(!ac.signal.aborted)setError(requestMessage(e));});return()=>ac.abort();},[retry]);
  return <div className="system-read">{error&&<p role="alert" className="workspace-error">{error}</p>}{!h&&!error&&<p role="status">Reading pipeline status…</p>}
    {h&&<><dl className="system-metrics"><div><dt>Database</dt><dd>{h.db==='ok'?'Available':'Needs attention'}</dd></div><div><dt>Laptop crawler</dt><dd>{h.crawlButton?h.crawlButton.agentOnline?'Connected':'Offline':'Unknown'}</dd></div><div><dt>Eligible sold records</dt><dd>{h.comps?.usable?.toLocaleString()??'Unknown'}</dd></div><div><dt>Models with pricing evidence</dt><dd>{h.comps?`${h.comps.skusPriceable} / ${h.comps.skusTotal}`:'Unknown'}</dd></div><div><dt>Pending re-scores</dt><dd>{h.scoring?.pending??'Unknown'}</dd></div><div><dt>Failed re-scores</dt><dd>{h.scoring?.failures??'Unknown'}</dd></div></dl>
    {h.crawlButton&&!h.crawlButton.agentOnline&&<p className="workspace-notice">Facebook, OfferUp and Mercari collection needs the laptop agent. Craigslist collection runs on the server. Last laptop contact: {date(h.crawlButton.lastAgentPollAt)}.</p>}
    {h.comps?.warning&&<p className="workspace-notice">{h.comps.warning}</p>}
    {h.funnel?.counts&&<p className="micro2">Past day: {h.funnel.counts.discovered} discovered, {h.funnel.counts.scored} scored. Counts describe pipeline activity, not the number of good deals.</p>}
    <p className="micro2">Newest recorded sale: {date(h.comps?.newestSoldAt)}<br/>Last availability sweep: {date(h.sweep?.lastAt)}<br/>Engine {h.engine}</p></>}
    <button className="btn2 workspace-wide" onClick={()=>setRetry(n=>n+1)}>Refresh status</button>
  </div>;
}
export function SystemStatus() {
  const [open,setOpen]=useState(false);
  return <details className="workspace-card system-status" onToggle={e=>setOpen(e.currentTarget.open)}><summary>Pipeline status <span>Collection and pricing health</span></summary>{open&&<StatusRead/>}</details>;
}
