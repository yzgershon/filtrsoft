import {useEffect,useId,useState,useRef} from 'react';
import {useAccountRefresh} from './account-refresh.ts';
import {requestJSON,requestMessage} from './api-client.ts';
import {money,toast} from './lib.tsx';
import {Clock,Shield} from './icons.tsx';

const date=(value:string|null)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'Not recorded';
type History={firstObservedAt:string;lastSeenAt:string|null;unavailableAt:string|null;currentAskCents:number|null;items:{id:number;priceCents:number;observedAt:string}[];nextBefore:number|null};
export function PriceHistory({id,placeholder}:{id:number;placeholder:boolean}) {
  const [data,setData]=useState<History|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[loading,setLoading]=useState(false);
  useEffect(()=>{const ac=new AbortController();setData(null);setError('');
    requestJSON<History>(`/v1/checks/${id}/price-history`,{signal:ac.signal},v=>Array.isArray(v?.items))
      .then(v=>{if(!ac.signal.aborted)setData(v);}).catch(e=>{if(!ac.signal.aborted)setError(requestMessage(e));});return()=>ac.abort();
  },[id,retry]);
  const more=async()=>{if(!data?.nextBefore||loading)return;setLoading(true);setError('');try{
    const next=await requestJSON<History>(`/v1/checks/${id}/price-history?before=${data.nextBefore}`);
    setData({...next,items:[...data.items,...next.items]});
  }catch(e){setError(requestMessage(e));}finally{setLoading(false);}};
  return <section className="workspace-card price-history"><header className="tab-section-head"><div><h2>Asking price history</h2><p>Prices recorded from this listing.</p></div><Clock size={21}/></header>
    {error&&<div role="alert" className="workspace-error">{error}<button className="btn2" onClick={()=>data?void more():setRetry(n=>n+1)}>Try again</button></div>}
    {!data&&!error&&<p role="status">Loading observations…</p>}
    {data&&<><dl className="observation-meta"><div><dt>First recorded</dt><dd>{date(data.firstObservedAt)}</dd></div><div><dt>Last seen</dt><dd>{date(data.lastSeenAt)}</dd></div></dl>
      {placeholder&&<p className="workspace-notice">The headline is a placeholder. These observations do not price individual items.</p>}
      {data.unavailableAt&&<p className="workspace-notice">Marked unavailable {date(data.unavailableAt)}. A completed sale has not been confirmed.</p>}
      {!data.items.length?<p className="micro2">No asking-price observations were recorded.</p>:<ol className="price-timeline">{data.items.map((item,i)=>{
        const previous=data.items[i+1],difference=previous?item.priceCents-previous.priceCents:null;
        return <li key={item.id}><span className="timeline-dot" aria-hidden="true"/><div><time dateTime={item.observedAt}>{date(item.observedAt)}</time><strong className="num">{money(item.priceCents)}</strong></div>
          {difference!==null&&difference!==0&&!placeholder&&<span className={`price-change ${difference<0?'pos':'neg'}`}>{difference<0?'Down':'Up'} {money(Math.abs(difference))}</span>}</li>;
      })}</ol>}
      {data.nextBefore&&<button className="btn2 workspace-wide" disabled={loading} onClick={()=>void more()}>{loading?'Loading…':'Earlier observations'}</button>}
      <p className="micro2">Observation dates show when Filtrsoft read the price, not exactly when the seller changed it.</p>
    </>}
  </section>;
}

type State='pending'|'passed'|'failed'|'not_tested';
type Inspection={ownerId:number;listingId:number;revision:number;basis:string;notes:string;updatedAt:string|null;staleAnswerCount:number;evidenceUpdating:boolean;
  checks:{id:string;label:string;question:string;evidence:string|null;engineState:string|null;state:State;note:string}[]};
type Draft=Pick<Inspection,'revision'|'basis'|'notes'|'checks'>;
const options:{value:State;label:string}[]=[{value:'pending',label:'Not checked'},{value:'passed',label:'Passed'},{value:'failed',label:'Failed'},{value:'not_tested',label:'Could not test'}];
const draftKey=(v:Inspection)=>`filtrsoft:inspection-draft:${v.ownerId}:${v.listingId}`;
const contents=(v:Draft)=>JSON.stringify([v.notes,v.checks.map(c=>[c.id,c.state,c.note])]);
export function InspectionWorkspace({id}:{id:number}) {
  const [view,setView]=useState<Inspection|null>(null),[draft,setDraft]=useState<Draft|null>(null),[recovery,setRecovery]=useState<Draft|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
  const prefix=useId(),dirty=!!view&&!!draft&&contents(view)!==contents(draft);
  const background=useRef<AbortController|null>(null);
  const latest=useRef({dirty,busy,id,view});latest.current={dirty,busy,id,view};
  useEffect(()=>()=>{background.current?.abort();},[id,dirty,busy,retry]);
  useAccountRefresh(()=>{
    if(dirty||busy||!view)return;
    background.current?.abort();const ac=new AbortController();background.current=ac;
    void requestJSON<Inspection>(`/v1/checks/${id}/inspection`,{signal:ac.signal},v=>Array.isArray(v?.checks)&&Number.isInteger(v.revision)&&typeof v.basis==='string').then(v=>{
      const current=latest.current;
      if(ac.signal.aborted||current.id!==id||current.dirty||current.busy||!current.view||v.revision<current.view.revision)return;
      if(v.revision!==current.view.revision||v.basis!==current.view.basis){setView(v);setDraft(v);}
    }).catch(()=>{});
  },!dirty&&!busy);
  useEffect(()=>{const ac=new AbortController();setView(null);setDraft(null);setError('');setRecovery(null);
    requestJSON<Inspection>(`/v1/checks/${id}/inspection`,{signal:ac.signal},v=>Array.isArray(v?.checks)&&Number.isInteger(v.revision)&&typeof v.basis==='string')
      .then(v=>{if(ac.signal.aborted)return;setView(v);setDraft(v);
        try{const local=JSON.parse(sessionStorage.getItem(draftKey(v))??'null') as Draft|null;
          if(local&&typeof local.notes==='string'&&Array.isArray(local.checks)){
            if(local.revision===v.revision&&local.basis===v.basis&&contents(local)!==contents(v))setDraft(local);
            else if(contents(local)!==contents(v))setRecovery(local);
          }
        }catch{}
      }).catch(e=>{if(!ac.signal.aborted)setError(requestMessage(e));});return()=>ac.abort();
  },[id,retry]);
  useEffect(()=>{if(!view||!draft)return;try{if(dirty)sessionStorage.setItem(draftKey(view),JSON.stringify(draft));else if(!recovery)sessionStorage.removeItem(draftKey(view));}catch{}},[view,draft,dirty,recovery]);
  useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};addEventListener('beforeunload',warn);return()=>removeEventListener('beforeunload',warn);},[dirty]);
  const save=async()=>{if(!view||!draft||busy)return;setBusy(true);setError('');try{
    const result=await requestJSON<Inspection>(`/v1/checks/${id}/inspection`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({
      revision:view.revision,basis:view.basis,notes:draft.notes,answers:draft.checks.map(({id,state,note})=>({id,state,note})),
    })});setView(result);setDraft(result);setRecovery(null);toast('Inspection saved');
  }catch(e){setError(requestMessage(e));}finally{setBusy(false);}};
  const update=(index:number,change:Partial<Draft['checks'][number]>)=>setDraft(d=>d?{...d,checks:d.checks.map((c,i)=>i===index?{...c,...change}:c)}:d);
  const answered=draft?.checks.filter(c=>c.state!=='pending').length??0,failures=draft?.checks.filter(c=>c.state==='failed').length??0;
  return <section className="workspace-card inspection-workspace"><header className="tab-section-head"><div><h2>Pickup inspection</h2><p>Your checks and notes, saved to your account.</p></div><Shield size={21}/></header>
    {!view&&!error&&<p role="status">Loading your inspection…</p>}
    {error&&<div role="alert" className="workspace-error">{error}<button className="btn2" disabled={busy} onClick={()=>setRetry(n=>n+1)}>Reload inspection</button></div>}
    {view&&draft&&<>
      <div className="inspection-progress"><span><b>{answered}</b> / {draft.checks.length} answered</span><span>{failures?`${failures} failed`:'Manual inspection'}</span><progress aria-label="Inspection questions answered" max={draft.checks.length} value={answered}/></div>
      <p className="workspace-notice">These are your observations. They do not verify ownership, clear an engine concern or guarantee condition.</p>
      {view.evidenceUpdating&&<p className="workspace-notice">The listing assessment is updating. These general checks do not replace its product-specific concerns.</p>}
      {view.staleAnswerCount>0&&<p className="workspace-notice">The listing or its evidence changed. Earlier answers stay in the revision history; check the current questions again.</p>}
      {recovery&&<details className="draft-recovery"><summary>Recover an earlier unsaved draft</summary><p>The saved inspection changed. Review these notes before using them.</p><pre>{recovery.notes}{'\n'}{recovery.checks.filter(c=>c.state!=='pending'||c.note).map(c=>`${c.label}: ${c.state}\n${c.note}`).join('\n')}</pre><button className="btn2" onClick={()=>{setRecovery(null);try{sessionStorage.removeItem(draftKey(view));}catch{}}}>Discard old draft</button></details>}
      <div className="inspection-checks">{draft.checks.map((c,i)=><div className={`inspection-check state-${c.state}`} key={c.id}>
        <div className="inspection-question"><label htmlFor={`${prefix}-${i}`}>{c.label}</label><p>{c.question}</p>{c.evidence&&<blockquote>{c.evidence}</blockquote>}
          {c.engineState==='failed'&&<small className="neg">Engine recorded a disclosed defect</small>}</div>
        <select id={`${prefix}-${i}`} disabled={busy} value={c.state} onChange={e=>update(i,{state:e.target.value as State})}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <details className="inspection-evidence"><summary>{c.note?'Edit observation':'Add observation'}</summary><label htmlFor={`${prefix}-${i}-note`}>What you observed</label><textarea id={`${prefix}-${i}-note`} maxLength={500} rows={2} value={c.note} disabled={busy} onChange={e=>update(i,{note:e.target.value})}/></details>
      </div>)}</div>
      <div className="workspace-field"><label htmlFor={`${prefix}-notes`}>Private notes</label><textarea id={`${prefix}-notes`} maxLength={4000} rows={4} placeholder="Pickup arrangements, missing parts, things to follow up…" value={draft.notes} disabled={busy} onChange={e=>setDraft({...draft,notes:e.target.value})}/></div>
      <div className="workspace-save"><span role="status">{dirty?'Unsaved changes':view.updatedAt?`Saved ${date(view.updatedAt)}`:'No inspection saved yet'}</span><button className="btn" disabled={busy||!dirty} onClick={()=>void save()}>{busy?'Saving…':'Save inspection'}</button></div>
    </>}
  </section>;
}
