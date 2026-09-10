import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {requestJSON,requestMessage} from './api-client.ts';
import {Popup,motionAllowed} from './popup.tsx';
import {Thumb,shareOrCopy,LABEL} from './lib.tsx';
import {NAVIGATE,replaceRoute} from './history.ts';
import {Again,Alert,Chat,Check,Cross,Info,Link,Shield,CompareIcon} from './icons.tsx';
import {PART_KINDS,type PartKind,type CompareResult,type CompareSide,type CompareCandidate} from '../../src/comparison/types.ts';

const names:Record<PartKind,string>={gpu:'Graphics',cpu:'Processors',ram:'Memory',storage:'Storage',motherboard:'Boards',psu:'Power'};
const platform:Record<string,string>={facebook:'Facebook Marketplace',craigslist:'Craigslist',offerup:'OfferUp',mercari:'Mercari'};
const money=(v:number|null)=>v==null?'Ask not stated':(v/100).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:v%100?2:0});
const number=(v:number)=>v.toLocaleString('en-US',{maximumFractionDigits:1});
function readQuery(){
  const q=new URLSearchParams(location.search),raw=q.get('ids')??'';
  return {ids:/^\d+(?:,\d+)?$/.test(raw)?[...new Set(raw.split(',').map(Number).filter(n=>Number.isSafeInteger(n)&&n>0))].slice(0,2):[],kind:PART_KINDS.includes(q.get('kind') as PartKind)?q.get('kind') as PartKind:'gpu',workload:q.get('workload')==='rendering'?'rendering' as const:'gaming' as const};
}
function PartIcon({kind,size=24}:{kind:PartKind;size?:number}){
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">{kind==='gpu'?<><rect x="3" y="8" width="26" height="16" rx="3"/><circle cx="11" cy="16" r="5"/><circle cx="22" cy="16" r="4"/><path d="M7 24v3h13v-3M1 7v19M11 12v8m-4-4h8m7-3v6"/></>:kind==='ram'?<><rect x="3" y="10" width="26" height="12" rx="2"/><path d="M7 22v4m4-4v4m4-4v4m6-4v4m4-4v4"/><rect x="7" y="13" width="6" height="6"/><rect x="19" y="13" width="6" height="6"/></>:<><rect x="7" y="7" width="18" height="18" rx="3"/><rect x="11" y="11" width="10" height="10" rx="1"/><path d="M11 3v4m5-4v4m5-4v4M11 25v4m5-4v4m5-4v4M3 11h4m-4 5h4m-4 5h4m18-10h4m-4 5h4m-4 5h4"/></>}</svg>;
}

function ListingPicker({kind,selected,onSelect,onClose}:{kind:PartKind;selected:number[];onSelect:(id:number)=>void;onClose:()=>void}){
  const [q,setQ]=useState(''),[items,setItems]=useState<CompareCandidate[]>([]),[next,setNext]=useState<number|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true),[retry,setRetry]=useState(0);
  const controller=useRef<AbortController|null>(null);
  const load=async(text:string,cursor?:number)=>{
    controller.current?.abort();const ac=new AbortController();controller.current=ac;setBusy(true);setError('');
    try{
      const d=await requestJSON<{items:CompareCandidate[];nextCursor:number|null}>(`/v1/compare/candidates?kind=${kind}&q=${encodeURIComponent(text)}${cursor?'&before='+cursor:''}`,{signal:ac.signal},d=>Array.isArray(d?.items)&&(d.nextCursor===null||Number.isSafeInteger(d.nextCursor)));
      if(ac.signal.aborted)return;
      setItems(old=>cursor?[...old,...d.items.filter(i=>!old.some(o=>o.id===i.id))]:d.items);setNext(d.nextCursor);
    }catch(e){if(!ac.signal.aborted)setError(requestMessage(e));}finally{if(!ac.signal.aborted)setBusy(false);}
  };
  useEffect(()=>{
    controller.current?.abort();setItems([]);setNext(null);setBusy(true);
    const timer=setTimeout(()=>void load(q),q?200:0);
    return()=>{clearTimeout(timer);controller.current?.abort();};
  },[q,kind,retry]);
  return <Popup title={`Choose ${names[kind].toLowerCase()}`} subtitle="Actual listings, with their recorded hardware." className="compare-picker" onClose={onClose}>{dismiss=><>
    <label className="compare-search"><span>Search model or listing</span><input type="search" value={q} maxLength={100} placeholder={kind==='gpu'?'RTX 4070, Radeon…':kind==='cpu'?'Ryzen 5800X, Core i7…':'Search specifications…'} onChange={e=>setQ(e.target.value)}/></label>
    <div className="compare-picker-list" aria-busy={busy}>
      {items.map(item=><button className="compare-candidate" key={item.id} disabled={selected.includes(item.id)} onClick={()=>dismiss(()=>onSelect(item.id))}>
        <span className="compare-candidate-photo"><Thumb src={item.thumb} fallbacks={item.photoUrls}/></span>
        <span className="compare-candidate-text"><b>{item.identity??item.title}</b><span>{item.title}</span><small>{platform[item.source]??item.source}{item.location?' · '+item.location:''}{item.wholeSystem?' · Whole system':''}</small></span>
        <span className="compare-candidate-price">{selected.includes(item.id)?<Check size={18}/>:money(item.priceCents)}</span>
      </button>)}
      {busy&&!items.length&&<p className="compare-empty" role="status">Finding listings…</p>}
      {!busy&&!error&&!items.length&&<div className="compare-empty"><PartIcon kind={kind} size={36}/><b>No matching listings</b><p>Try a shorter model name. Listings without this part’s recorded specifications are excluded.</p></div>}
      {error&&<div role="alert" className="compare-error"><p>{error}</p><button className="btn2" onClick={()=>setRetry(n=>n+1)}>Try again</button></div>}
      {next&&!error&&<button className="btn2 compare-full" disabled={busy} onClick={()=>void load(q,next)}>{busy?'Loading…':'More listings'}</button>}
    </div>
  </>}</Popup>;
}

function SideCard({side,index,kind,onChoose,onRemove,onOpen,loading}:{side?:CompareSide;index:number;kind:PartKind;onChoose:()=>void;onRemove:()=>void;onOpen:(id:number)=>void;loading:boolean}){
  return <article className={`compare-contender contender-${index}${side?' has-part':' empty-part'}`}>
    <div className="contender-top"><span className="contender-code">{index===0?'A':'B'}<i/></span>{side?<button aria-label={`Remove listing ${index===0?'A':'B'} from comparison`} className="compare-icon" onClick={onRemove}><Cross size={16}/></button>:<PartIcon kind={kind} size={18}/>}</div>
    {side?<>
      <div className="contender-image"><Thumb src={'/v1/thumb/'+side.id} fallbacks={side.photoUrls}/><div className="contender-image-wash"/><span className="contender-platform">{platform[side.source]??side.source}</span></div>
      <div className="contender-copy">
        <button data-contender={index} className="contender-model" onClick={onChoose} aria-label={`Change listing ${index===0?'A':'B'}: ${side.hardware.identity??side.title}`}>{side.hardware.identity??'Model unconfirmed'}<span aria-hidden="true">⌄</span></button>
        <button className="contender-listing" onClick={()=>onOpen(side.id)}>{side.title}</button>
        <div className="contender-ask"><b>{money(side.priceCents)}</b><span>{side.standalone?'Part asking price':'Whole listing ask'}</span></div>
        {side.status!=='active'&&<span className="compare-status"><Alert/>{side.status==='gone'?'No longer listed':side.status==='removed'?'Removed from feed':side.status==='updating'?'Assessment updating':'Older listing'}</span>}
      </div>
    </>:<button data-contender={index} className="contender-choose" onClick={onChoose} disabled={loading}><span className="contender-ghost"><PartIcon kind={kind} size={76}/><span>+</span></span><b>{loading?'Loading listing…':`Choose listing ${index===0?'A':'B'}`}</b><small>From your marketplace</small></button>}
  </article>;
}
function ReferenceCard({side,index}:{side:CompareSide;index:number}){
  const ref=side.reference;
  return <article className={`reference-card side-${index}`}><div className="compare-mini-side"><i>{index===0?'A':'B'}</i><b>{side.hardware.identity??'Unconfirmed model'}</b></div>{ref?<>
    <div className="reference-number">{number(ref.value)}<small>{ref.unit}</small></div><p>{ref.suite} · {ref.os} · {ref.backend}</p><span className="reference-count">{ref.submissions.toLocaleString()} submissions · median</span>
    {ref.scope==='family'&&<p className="reference-caveat">{ref.note}</p>}<a href={ref.sourceUrl} target="_blank" rel="noopener noreferrer">Inspect benchmark source ↗</a>
  </>:<div className="reference-missing"><span>Not scored</span><p>{side.benchmarkReason??'No exact benchmark available.'}</p></div>}</article>;
}
function ContactCard({side,index,onOpen}:{side:CompareSide;index:number;onOpen:(id:number)=>void}){
  return <article className={`compare-contact side-${index}`}>
    <div className="compare-mini-side"><i>{index===0?'A':'B'}</i><b>{side.hardware.identity??side.title}</b></div>
    <div className="compare-contact-call"><span className={`vbadge b-${side.call}`}>{LABEL[side.call as keyof typeof LABEL]??'Not assessed'}</span><span>{side.concerns.length} concern{side.concerns.length===1?'':'s'}</span></div>
    {side.concerns.length>0?<ul>{side.concerns.slice(0,3).map((c,i)=><li key={i}><Alert size={13}/><span>{c.label.toLowerCase().replace(/(^|\s)\S/g,c=>c.toUpperCase())}</span></li>)}</ul>:<p className="compare-contact-note">No specific concerns recorded. The item still needs an in-person check.</p>}
    {side.questions.length>0&&<details><summary>Questions to ask <span>{side.questions.length}</span></summary><ol>{side.questions.map((q,i)=><li key={i}>{q}</li>)}</ol></details>}
    <button className="compare-detail-link" onClick={()=>onOpen(side.id)}>Open full listing report ↗</button>
    {side.url&&side.status==='active'?<a className="compare-message" href={side.url} target="_blank" rel="noopener noreferrer"><Chat size={18}/>Message seller<span aria-hidden="true">↗</span></a>:<button className="compare-message" disabled>Contact unavailable</button>}
    <small className="compare-contact-help">{side.source==='craigslist'?'Opens Craigslist. Choose Reply on the ad.':`Opens ${platform[side.source]??'the original listing'}. You send the message there.`}</small>
  </article>;
}
function MatrixHead({sides}:{sides:CompareSide[]}){
  return <div className="compare-matrix-head" role="row"><span role="columnheader">Metric</span>{[0,1].map(i=><span role="columnheader" key={i}><i>{i===0?'A':'B'}</i>{sides[i]?.hardware.identity??`Listing ${i===0?'A':'B'}`}</span>)}</div>;
}
function ManufacturerSpecs({sides}:{sides:CompareSide[]}){
  const labels:Record<string,string>={architecture:'Architecture',cores:'Compute cores',boost:'Reference boost clock',bus:'Memory bus',power:'Reference power',cache:'L3 cache',socket:'CPU socket',memory:'Supported memory'};
  const keys=[...new Set(sides.flatMap(s=>Object.keys(s.manufacturer?.metrics??{})))];
  if(!keys.length)return null;
  return <section className="compare-manufacturer"><div className="compare-section-heading"><h2>Hardware reference</h2><span>Manufacturer specs</span></div><p>Reference designs for the identified models. These do not confirm the installed configuration, board clocks or power settings.</p>
    <div className="compare-matrix" role="table" aria-label="Manufacturer reference specifications"><MatrixHead sides={sides}/>{keys.map(key=><div className="compare-metric-row" role="row" key={key}><div role="rowheader"><b>{labels[key]??key}</b></div>{[0,1].map(i=><div role="cell" key={i} className={`side-${i}`}>{sides[i]?.manufacturer?.metrics[key]??'No reference'}</div>)}</div>)}</div>
    <div className="compare-manufacturer-sources">{sides.map((s,i)=>s.manufacturer?<a key={s.id} href={s.manufacturer.url} target="_blank" rel="noopener noreferrer">{i===0?'A':'B'} · {s.manufacturer.name} specs ↗</a>:null)}</div><p>Cores, clock speed and memory size are not cross-architecture gaming scores. Coverage is limited to individually checked reference models.</p>
  </section>;
}

export default function ComparisonScreen({onOpen}:{onOpen:(id:number)=>void}){
  const [query,setQuery]=useState(readQuery),[result,setResult]=useState<CompareResult|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),[picker,setPicker]=useState<0|1|null>(null),[reveal,setReveal]=useState(false),[replay,setReplay]=useState(0),[differences,setDifferences]=useState(false);
  const started=useRef(''),focusSide=useRef<number|null>(null);
  useEffect(()=>{const changed=()=>setQuery(readQuery());addEventListener('popstate',changed);addEventListener(NAVIGATE,changed);return()=>{removeEventListener('popstate',changed);removeEventListener(NAVIGATE,changed);};},[]);
  const update=(part:Partial<typeof query>)=>{
    const next={...query,...part},url=new URL(location.href);
    for(const [key,value] of Object.entries({ids:next.ids.join(','),kind:next.kind,workload:next.workload})){if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);}
    replaceRoute(url.pathname+url.search);setQuery(next);setReveal(false);
  };
  const idsKey=query.ids.join(',');
  useEffect(()=>{
    const ac=new AbortController();setError('');setResult(null);setReveal(false);
    if(!query.ids.length){setBusy(false);return;}setBusy(true);
    requestJSON<CompareResult>(`/v1/compare?ids=${idsKey}&kind=${query.kind}&workload=${query.workload}`,{signal:ac.signal},d=>d?.version===1&&Array.isArray(d.sides)&&Array.isArray(d.metrics)&&d.score&&d.value&&d.reference)
      .then(data=>{if(ac.signal.aborted)return;setResult(data);const key=idsKey+'|'+query.kind+'|'+query.workload;if(data.sides.length===2&&started.current!==key){started.current=key;setReplay(n=>n+1);setReveal(motionAllowed());}})
      .catch(e=>{if(!ac.signal.aborted)setError(requestMessage(e));}).finally(()=>{if(!ac.signal.aborted)setBusy(false);});
    return()=>ac.abort();
  },[idsKey,query.kind,query.workload,retry]);
  useEffect(()=>{
    if(busy||focusSide.current===null)return;
    const index=focusSide.current,frame=requestAnimationFrame(()=>{const target=document.querySelector<HTMLButtonElement>(`[data-contender="${index}"]`);if(target&&!target.disabled){target.focus({preventScroll:true});focusSide.current=null;}});
    return()=>cancelAnimationFrame(frame);
  },[busy,result]);
  useEffect(()=>{
    if(!reveal)return;const timer=setTimeout(()=>setReveal(false),2600),media=matchMedia('(prefers-reduced-motion: reduce)'),stop=()=>{if(!motionAllowed())setReveal(false);};media.addEventListener('change',stop);
    return()=>{clearTimeout(timer);media.removeEventListener('change',stop);};
  },[reveal,replay]);
  const paired=result?.sides.length===2,scored=result?.score.state==='comparable',hardwareKind=['cpu','gpu'].includes(query.kind);
  const visibleMetrics=result?.metrics.filter(m=>!differences||m.values[0]!==m.values[1])??[];
  return <section className="compare-screen" aria-busy={busy}>
    <header className="compare-heading"><div><span className="compare-eyebrow"><CompareIcon size={13}/> HARDWARE COMPARISON</span><h1>Compare</h1></div><button className="compare-share compare-icon" aria-label="Copy comparison link" disabled={!query.ids.length} onClick={()=>void shareOrCopy(location.href,'Filtrsoft hardware comparison')}><Link size={20}/></button></header>
    <nav className="compare-kinds" aria-label="Component type">{PART_KINDS.map(kind=><button key={kind} aria-pressed={query.kind===kind} onClick={()=>update({kind})}><PartIcon kind={kind} size={19}/>{names[kind]}</button>)}</nav>
    <div className={`compare-stage${reveal?' is-revealing':''}`} key={replay}>
      <div className="compare-stage-grid" aria-hidden="true"/><div className="compare-orbit" aria-hidden="true"/><span className="compare-versus" aria-hidden="true"><span>VS</span></span>
      <div className="compare-contenders">{([0,1] as const).map(index=><SideCard key={index} side={result?.sides[index]} index={index} kind={query.kind} onChoose={()=>setPicker(index)} onRemove={()=>{focusSide.current=Math.min(index,Math.max(0,query.ids.length-2));update({ids:query.ids.filter((_,i)=>i!==index)});}} onOpen={onOpen} loading={busy&&!!query.ids[index]}/>)}</div>
      <div className="compare-stage-footer"><span><i/>{busy?'Reading recorded evidence':paired?'Two listings. One clear view.':'Choose two listings to compare'}</span>{paired&&<div><button className="compare-icon" aria-label="Swap compared listings" onClick={()=>update({ids:[...query.ids].reverse()})}>⇄</button>{reveal?<button className="compare-replay" onClick={()=>setReveal(false)}>Skip animation</button>:<button className="compare-replay" onClick={()=>{setReplay(n=>n+1);setReveal(motionAllowed());}}><Again size={14}/>Replay</button>}</div>}</div>
    </div>
    {error&&<div className="compare-error" role="alert"><Alert size={20}/><p>{error}</p><button className="btn2" onClick={()=>setRetry(n=>n+1)}>Try again</button><button className="btn2" onClick={()=>update({ids:[]})}>Choose different listings</button></div>}
    {!query.ids.length&&<div className="compare-start"><PartIcon kind={query.kind} size={30}/><div><h2>Start with the listings you’re considering</h2><p>Compare exact parts, the asking prices and what still needs checking. Add either side above.</p></div></div>}
    {result&&<div className={`compare-results${reveal?' reveal-results':''}`}>
      <div className="compare-section-heading"><h2>{hardwareKind?'Performance & value':'Specifications & value'}</h2>{hardwareKind&&<div className="compare-workload" aria-label="Benchmark workload"><button aria-pressed={query.workload==='gaming'} onClick={()=>update({workload:'gaming'})}>Gaming</button><button aria-pressed={query.workload==='rendering'} onClick={()=>update({workload:'rendering'})}>Rendering</button></div>}</div>
      {hardwareKind&&<section className={`comparison-score${scored?' has-score':''}`}>
        <div className="score-heading"><span>{result.score.label}</span><span className="score-status"><i/>{scored?'Matched reference data':'Not scored'}</span></div>
        {scored?<>
          <div className="score-numbers">{result.score.indices.map((score,i)=><div className={`side-${i}`} key={i}><span>{i===0?'A':'B'}</span><strong>{number(score!)}</strong><small>relative index</small></div>)}</div>
          <div className="score-track" aria-label={`A ${result.score.indices[0]}, B ${result.score.indices[1]}, relative performance index`}>{result.score.indices.map((score,i)=><div className={`score-lane side-${i}`} key={i}><i style={{'--score-scale':score!/100} as CSSProperties}/></div>)}</div>
          <p className="score-conclusion">{result.score.leader===null?'Equal in this reference cohort.':<><b>{result.score.leader===0?'A':'B'}</b> is {number(result.score.advantagePercent!)}% faster in this rendering benchmark.</>}</p><p className="score-method">{result.score.reason}</p>
        </>:<div className="score-unavailable"><span className="score-dashes" aria-hidden="true">— <i>/</i> —</span><div><h3>{query.workload==='gaming'?'Gaming measurements unavailable':'No fair score for this pair yet'}</h3><p>{result.score.reason}</p>
          {query.workload==='gaming'&&<>{result.externalGaming&&<><a className="compare-provider" href={result.externalGaming.url} target="_blank" rel="noopener noreferrer">{result.externalGaming.label} ↗</a><p className="compare-provider-note">{result.externalGaming.note}</p></>}<a href={query.kind==='cpu'?'https://www.tomshardware.com/reviews/cpu-hierarchy,4312.html':'https://www.tomshardware.com/reviews/gpu-hierarchy,4388.html'} target="_blank" rel="noopener noreferrer">Read independent gaming tests ↗</a></>}
        </div></div>}
        {result.value.indices[0]!==null&&<div className="compare-value-result"><span>Rendering per dollar</span><strong>{result.value.leader===null?'Equal value':`${result.value.leader===0?'A':'B'} gives more throughput per dollar`}</strong><small>{result.value.reason}</small></div>}
      </section>}
      {hardwareKind&&query.workload==='rendering'&&<><div className="compare-reference-grid">{result.sides.map((side,i)=><ReferenceCard key={side.id} side={side} index={i}/>)}</div><p className="compare-source-line"><a href="https://opendata.blender.org/about/" target="_blank" rel="noopener noreferrer">Blender Open Data</a> · {result.reference.suite} · {result.reference.os} · retrieved {new Date(result.reference.retrievedAt).toLocaleDateString('en-US')}<span>Reference hardware submissions, not a test of the seller’s item. Rendering throughput does not predict game FPS.</span></p></>}
      <section className="compare-metrics-section"><div className="compare-section-heading"><h2>The details</h2><button className="compare-differences" aria-pressed={differences} onClick={()=>setDifferences(v=>!v)}><span className="compare-toggle"><i/></span>Differences only</button></div>
        <div className="compare-matrix" role="table" aria-label="Listing specification and price comparison"><MatrixHead sides={result.sides}/>{visibleMetrics.map(metric=><div className="compare-metric-row" role="row" key={metric.key}><div role="rowheader"><b>{metric.label}</b>{metric.note&&<small>{metric.note}</small>}</div>{metric.values.map((v,i)=><div role="cell" className={`side-${i}${v===null?' unknown':''}`} key={i}>{v??'Not reported'}</div>)}</div>)}{!visibleMetrics.length&&<p className="compare-empty">No differences in the available metrics.</p>}</div>
      </section>
      <ManufacturerSpecs sides={result.sides}/>
      <div className="compare-proof-grid">{result.sides.map((side,i)=><details className={`compare-proof side-${i}`} key={side.id}><summary><span><i>{i===0?'A':'B'}</i>Specification sources</span><Info size={16}/></summary><p>{side.hardware.reason??'Literal seller claims and recorded photo reads. This does not verify the physical item.'}</p>{side.hardware.evidence.map((e,j)=><blockquote key={j}><b>{e.source==='photo'?'Recorded photo read':e.source==='title'?'Seller title':e.source==='attribute'?'Listing attribute':'Seller description'}</b><p>{e.quote}</p></blockquote>)}{side.specs.notes.length>0&&<details><summary>Additional evidence</summary><ul>{side.specs.notes.map((n,j)=><li key={j}>{n}</li>)}</ul></details>}</details>)}</div>
      <div className="compare-section-heading"><h2>Before you buy</h2><Shield size={18}/></div><div className="compare-contact-grid">{result.sides.map((side,i)=><ContactCard side={side} index={i} key={side.id} onOpen={onOpen}/>)}</div>
      <p className="compare-bottom-note">Performance, resale value and condition answer different questions. A faster part is not automatically the better buy.</p>
    </div>}
    {picker!==null&&<ListingPicker kind={query.kind} selected={query.ids} onClose={()=>setPicker(null)} onSelect={id=>{focusSide.current=query.ids.length===0?0:picker;const ids=[...query.ids];ids[picker]=id;update({ids:ids.filter(Boolean)});}}/>}
  </section>;
}
