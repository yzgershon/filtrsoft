import {useEffect,useRef,useState,useId} from 'react';
import {requestJSON,requestMessage} from './api-client.ts';
import {useAccountRefresh} from './account-refresh.ts';
import {NAVIGATE,pushRoute,replaceRoute} from './history.ts';
import {Popup} from './popup.tsx';
import {Alert,Again,Search,Star,Cross} from './icons.tsx';
import type {MarketProduct,MarketResponse,MarketPoint,MarketRange} from '../../src/market/types.ts';

const categories:Record<string,string>={gpu:'Graphics cards',cpu:'Processors',ram:'Memory',storage:'Storage',phone:'Phones',laptop:'Laptops',tablet:'Tablets',prebuilt:'Desktops',desktop:'Desktops',psu:'Power supplies',motherboard:'Motherboards',case:'Cases',component:'Other parts',monitor:'Monitors',audio:'Audio',wearable:'Wearables',camera:'Cameras',networking:'Networking'};
const conditions:Record<string,string>={used:'Used',new:'New',open_box:'Open box',refurb:'Refurbished'};
const ranges:MarketRange[]=['1m','3m','6m','1y','3y','all'];
const money=(n:number|null)=>n===null?'—':(n/100).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:n%100?2:0});
const date=(s:string|null)=>s?new Date(s+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}):'No sales';
const shortDate=(s:string)=>new Date(s+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
type Catalog={items:Array<MarketProduct&{pinned:boolean}>;total:number;nextOffset:number|null;categories:string[]};

function ProductPicker({initialQuery,onChoose}:{initialQuery:string;onChoose:(p:MarketProduct)=>void}) {
  const [q,setQ]=useState(initialQuery),[category,setCategory]=useState(''),[pinned,setPinned]=useState(false),[data,setData]=useState<Catalog|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const controller=useRef<AbortController|null>(null);
  const load=async(offset=0)=>{
    controller.current?.abort();const ac=new AbortController();controller.current=ac;setBusy(true);setError('');
    try {
      const result=await requestJSON<Catalog>(`/v1/market/products?${new URLSearchParams({q,category,pinned:pinned?'1':'0',offset:String(offset)})}`,{signal:ac.signal},d=>Array.isArray(d?.items)&&Array.isArray(d?.categories));
      if(!ac.signal.aborted)setData(old=>offset&&old?{...result,items:[...old.items,...result.items]}:result);
    }catch(e){if(!ac.signal.aborted)setError(requestMessage(e));}finally{if(!ac.signal.aborted)setBusy(false);}
  };
  useEffect(()=>{setData(null);setBusy(true);const timer=setTimeout(()=>void load(),200);return()=>{clearTimeout(timer);controller.current?.abort();};},[q,category,pinned,retry]);
  useAccountRefresh(signal=>{
    void requestJSON<Catalog>('/v1/market/products?pinned=1',{signal}).then(result=>{
      if(signal.aborted)return;
      const ids=new Set(result.items.map(p=>p.id));
      setData(old=>{if(!old)return old;if(!pinned)return {...old,items:old.items.map(p=>({...p,pinned:ids.has(p.id)}))};
        const items=result.items.filter(p=>(!category||category===p.category)&&q.toLowerCase().split(/\s+/).every(w=>`${p.brand} ${p.model}`.toLowerCase().includes(w)));
        return {...old,items,total:items.length,nextOffset:null};
      });
    }).catch(()=>{});
  },!busy);
  return <div className="market-picker">
    <label className="market-search"><Search size={19}/><input type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search hardware, phones and more" aria-label="Search market products" maxLength={100}/>{q&&<button aria-label="Clear product search" onClick={()=>setQ('')}><Cross/></button>}</label>
    <div className="market-picker-filters"><label className="sr-only" htmlFor="market-category">Product category</label><select id="market-category" value={category} onChange={e=>setCategory(e.target.value)}><option value="">All categories</option>{(data?.categories??Object.keys(categories)).map(c=><option key={c} value={c}>{categories[c]??c}</option>)}</select><button className={pinned?'active':''} aria-pressed={pinned} onClick={()=>setPinned(v=>!v)}><Star size={16} filled={pinned}/>Pinned</button></div>
    {error?<div className="market-error" role="alert"><Alert/><p>{error}</p><button className="btn sm" onClick={()=>setRetry(v=>v+1)}>Try again</button></div>:<>
      <div className="market-catalog" aria-busy={busy}>{data?.items.map(p=><button className="market-product-row" key={p.id} onClick={()=>onChoose(p)}><span className="market-product-symbol" aria-hidden="true">{p.category==='ram'?'▥':p.category==='gpu'?'▤':'▦'}</span><span><small>{categories[p.category]??p.category} · {p.brand}</small><strong>{p.model}</strong></span>{p.pinned?<Star size={17} filled/>:<span aria-hidden="true">↗</span>}</button>)}</div>
      {busy&&<p role="status" className="market-loading">Finding products…</p>}
      {!busy&&!data?.items.length&&<div className="market-empty"><p>{pinned?'No pinned products match.':'No catalog products match this search.'}</p><small>{pinned?'Pin a product from its chart to keep it here.':'Try the model number or a broader search.'}</small></div>}
      {data?.nextOffset!==null&&data?.nextOffset!==undefined&&<button className="btn market-more" disabled={busy} onClick={()=>void load(data.nextOffset!)}>More products</button>}
      {data&&<small className="market-count">{data.total} {data.total===1?'product':'products'}</small>}
    </>}
  </div>;
}

function PriceChart({data,onBucket}:{data:MarketResponse;onBucket:(point:MarketPoint|null)=>void}) {
  const [active,setActive]=useState<number|null>(null),[width,setWidth]=useState(360),id=useId(),svg=useRef<SVGSVGElement>(null);
  // Match SVG coordinates to rendered pixels so phone labels and touch targets
  // do not shrink with a desktop-sized viewBox.
  useEffect(()=>{const el=svg.current;if(!el)return;const observer=new ResizeObserver(([entry])=>setWidth(Math.max(240,Math.round(entry.contentRect.width))));observer.observe(el);return()=>observer.disconnect();},[]);
  const {points}=data,observed=points.filter(p=>p.medianCents!==null),values=observed.flatMap(p=>[p.lowCents!,p.highCents!]);
  const low=values.length?Math.min(...values):0,high=values.length?Math.max(...values):100;
  const pad=Math.max((high-low)*.18,high*.035,100),min=Math.max(0,low-pad),max=high+pad;
  const left=56,right=width-20,plotWidth=right-left;
  const x=(i:number)=>left+i/Math.max(1,points.length-1)*plotWidth,y=(n:number)=>22+(max-n)/(max-min)*190;
  const axisDate=(s:string)=>['1y','3y','all'].includes(data.range)?new Date(s+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',year:'2-digit',timeZone:'UTC'}):shortDate(s);
  const lines:string[]=[];let segment:number[]=[];
  const finish=()=>{if(segment.length){lines.push(segment.map((i,j)=>`${j?'L':'M'}${x(i)} ${y(points[i].medianCents!)}`).join(' '));segment=[];}};
  points.forEach((p,i)=>{if(p.medianCents!==null)segment.push(i);else finish();});finish();
  const hovered=active===null?null:points[active],countMax=Math.max(1,...points.map(p=>p.count));
  const select=(index:number|null)=>{if(index===active)return;setActive(index);onBucket(index===null?null:points[index]);};
  const pointer=(event:React.PointerEvent<SVGSVGElement>)=>{const box=event.currentTarget.getBoundingClientRect();select(Math.max(0,Math.min(points.length-1,Math.round(((event.clientX-box.left)/box.width*width-left)/plotWidth*Math.max(1,points.length-1)))));};
  return <div className="market-chart-wrap">
    <div className="market-chart-readout" aria-live="polite"><span>{hovered?`${date(hovered.date)}${hovered.end!==hovered.date?' – '+shortDate(hovered.end):''}`:'Median sale in selected period'}</span><strong>{money(hovered?hovered.medianCents:data.summary.medianCents)}</strong><small>{hovered?hovered.count?`${hovered.count} recorded ${hovered.count===1?'sale':'sales'}`:'No recorded sales in this interval':`${data.totalSales.toLocaleString()} recorded sales · USD`}</small></div>
    <svg ref={svg} viewBox={`0 0 ${width} 292`} role="img" aria-labelledby={`${id}-title ${id}-description`} className="market-chart" onPointerMove={pointer} onPointerDown={pointer} onPointerLeave={e=>{if(e.pointerType==='mouse')select(null);}}>
      <title id={`${id}-title`}>Recorded sold-price history for {data.product.model}</title><desc id={`${id}-description`}>{data.interval} median and middle 50 percent price range; bars count recorded sales. Gaps have no observations. Use the range control below or the data table for keyboard access.</desc>
      {observed.length>0&&[0,1,2,3].map(t=>{const value=min+(max-min)*t/3;return <g key={t}><line className="market-gridline" x1={left} x2={right} y1={y(value)} y2={y(value)}/><text x="46" y={y(value)+4} textAnchor="end">{money(Math.round(value/100)*100)}</text></g>;})}
      {points.map((p,i)=>p.count?<g key={p.date}><line className="market-spread" x1={x(i)} x2={x(i)} y1={y(p.lowCents!)} y2={y(p.highCents!)}/><rect className="market-volume" x={x(i)-Math.max(1,Math.min(8,500/points.length))/2} width={Math.max(1,Math.min(8,500/points.length))} y={261-p.count/countMax*29} height={p.count/countMax*29} rx="1"/></g>:null)}
      {lines.map((d,i)=><path key={i} d={d} className="market-series"/>)}
      {points.map((p,i)=>p.count?<circle key={p.date} cx={x(i)} cy={y(p.medianCents!)} r={p.count<3?2.2:3.2} className="market-dot"/>:null)}
      {active!==null&&<g><line className="market-crosshair" x1={x(active)} x2={x(active)} y1="12" y2="266"/>{hovered?.medianCents!==null&&hovered?.medianCents!==undefined&&<circle className="market-active-dot" cx={x(active)} cy={y(hovered.medianCents)} r="6"/>}</g>}
      {points.length>0&&<><text x={left} y="284">{axisDate(points[0].date)}</text><text x={(left+right)/2} y="284" textAnchor="middle">{axisDate(points[Math.floor(points.length/2)].date)}</text><text x={right} y="284" textAnchor="end">{axisDate(points.at(-1)!.end)}</text></>}
      {!observed.length&&<text className="market-no-points" x={(left+right)/2} y="122" textAnchor="middle">No recorded sales</text>}
    </svg>
    <label className="market-chart-slider">Inspect {data.interval} <input type="range" min="0" max={Math.max(0,points.length-1)} value={active??points.length-1} onChange={e=>select(Number(e.target.value))} aria-label="Inspect price history interval" aria-valuetext={hovered?`${date(hovered.date)}, ${hovered.count} sales, ${money(hovered.medianCents)}`:undefined}/>{active!==null&&<button onClick={()=>select(null)}>Reset</button>}</label>
    <div className="market-legend"><span><i/>Median</span><span><i className="spread"/>Middle 50%</span><span><i className="volume"/>Recorded sales</span></div>
  </div>;
}

export default function MarketScreen() {
  const [query,setQuery]=useState(()=>new URLSearchParams(location.search)),[picker,setPicker]=useState(false),[data,setData]=useState<MarketResponse|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),[pinBusy,setPinBusy]=useState(false),[pinError,setPinError]=useState(''),[more,setMore]=useState(false),[bucket,setBucket]=useState<MarketPoint|null>(null);
  useEffect(()=>{const read=()=>setQuery(new URLSearchParams(location.search));addEventListener('popstate',read);addEventListener(NAVIGATE,read);return()=>{removeEventListener('popstate',read);removeEventListener(NAVIGATE,read);};},[]);
  const id=query.get('product'),range=ranges.includes(query.get('range') as MarketRange)?query.get('range')!:'3m',condition=conditions[query.get('condition')??'']?query.get('condition')!:'used',basis=query.get('basis')==='delivered'?'delivered':'item',cohort=query.get('cohort');
  const params=new URLSearchParams({range,condition,basis});if(cohort)params.set('cohort',cohort);
  const resource=id?`/v1/market/products/${encodeURIComponent(id)}/history?${params}`:null;
  useEffect(()=>{
    setData(null);setError('');setPinError('');setMore(false);setBucket(null);if(!resource){setBusy(false);return;}
    const ac=new AbortController();setBusy(true);
    void requestJSON<MarketResponse>(resource,{signal:ac.signal},d=>Array.isArray(d?.points)&&Array.isArray(d?.cohorts)&&Array.isArray(d?.sales)&&typeof d?.product?.model==='string').then(d=>{if(!ac.signal.aborted)setData(d);}).catch(e=>{if(!ac.signal.aborted)setError(requestMessage(e));}).finally(()=>{if(!ac.signal.aborted)setBusy(false);});
    return()=>ac.abort();
  },[resource,retry]);
  useAccountRefresh(signal=>{
    void requestJSON<Catalog>('/v1/market/products?pinned=1',{signal}).then(result=>{if(!signal.aborted)setData(d=>d?{...d,pinned:result.items.some(p=>p.id===d.product.id)}:d);}).catch(()=>{});
  },!!data&&!pinBusy&&!busy);
  const select=(changes:Record<string,string|null>,push=false)=>{const next=new URLSearchParams(location.search);for(const [key,value] of Object.entries(changes)){if(value===null)next.delete(key);else next.set(key,value);}(push?pushRoute:replaceRoute)(`/market?${next}`);};
  const choose=(p:MarketProduct)=>{setPicker(false);select({product:String(p.id),cohort:null},true);};
  const pin=async()=>{if(!data)return;setPinBusy(true);setPinError('');const target=data.product.id,wanted=!data.pinned;try{await requestJSON(`/v1/market/products/${target}/pin`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pinned:wanted})});setData(d=>d?.product.id===target?{...d,pinned:wanted}:d);}catch(e){setPinError(requestMessage(e));}finally{setPinBusy(false);}};
  const selected=data?.cohorts.find(c=>c.key===data.selected);
  const exportResource=resource+(selected&&!cohort?`&cohort=${selected.key}`:'');
  const evidence=data?.sales.filter(s=>!bucket||s.date>=bucket.date&&s.date<=bucket.end)??[];
  return <section className="market-screen">
    <header className="market-heading"><h1>Price history</h1>{id&&<button className="btn secondary market-change" aria-label="Change product" onClick={()=>setPicker(true)}><Search size={18}/><span>Change product</span></button>}</header>
    {!id?<><ProductPicker initialQuery={query.get('q')??''} onChoose={choose}/><p className="market-footnote">Explore recorded sold prices by model, configuration and condition. Coverage varies by product.</p></>:<>
      {busy&&<div className="market-skeleton" role="status"><div/><div/><div/><span>Loading recorded sales…</span></div>}
      {error&&<div className="market-error" role="alert"><Alert/><p>{error}</p><button className="btn" onClick={()=>setRetry(v=>v+1)}><Again size={17}/>Try again</button><button className="btn secondary" onClick={()=>setPicker(true)}>Choose a product</button></div>}
      {data&&<>
        <div className="market-product-heading"><div><span>{categories[data.product.category]??data.product.category} · {data.product.brand}</span><h2>{data.product.model}</h2></div><button className={`market-pin ${data.pinned?'active':''}`} onClick={()=>void pin()} disabled={pinBusy} aria-pressed={data.pinned} aria-label={data.pinned?'Unpin product':'Pin product'}><Star size={20} filled={data.pinned}/></button></div>
        {pinError&&<p className="market-error" role="alert">{pinError}</p>}
        <div className="market-panel">
          <div className="market-controls"><label>Condition<select value={condition} onChange={e=>select({condition:e.target.value,cohort:null})}>{Object.entries(conditions).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Price basis<select value={basis} onChange={e=>select({basis:e.target.value})}><option value="item">Item price</option><option value="delivered">Item + known shipping</option></select></label></div>
          {data.cohorts.length>0&&(data.cohorts.length>1||selected?.label!=='Catalog model')&&<label className="market-configuration">Configuration<select value={data.selected??''} onChange={e=>select({cohort:e.target.value})}>{data.cohorts.map(c=><option key={c.key} value={c.key}>{c.label} ({c.count} sales)</option>)}</select></label>}
          {selected&&!selected.complete&&<p className="market-caution"><Alert size={15}/><span>{selected.unknowns.join(', ')} not stated in these sale titles. This group may contain different configurations.</span></p>}
          <div className="market-ranges" aria-label="Price history range">{ranges.map(r=><button key={r} aria-pressed={range===r} className={range===r?'active':''} onClick={()=>select({range:r})}>{r==='all'?'ALL':r.toUpperCase()}</button>)}</div>
          <PriceChart key={resource} data={data} onBucket={setBucket}/>
          <div className="market-stats"><div><span>Middle 50% of sales</span><strong>{data.summary.lowCents===null?'—':`${money(data.summary.lowCents)} – ${money(data.summary.highCents)}`}</strong></div><div><span>Period change</span><strong>{data.summary.changePercent===null?'Not enough data':`${data.summary.changePercent>0?'+':''}${data.summary.changePercent.toFixed(1)}%`}</strong></div><div><span>Last recorded sale</span><strong>{date(data.coverage.last)}</strong></div></div>
        </div>
        <div className="market-coverage"><div><span className="market-coverage-dot"/> {data.summary.observedBuckets} of {data.summary.totalBuckets} {data.interval}s contain sales</div><p>{data.coverage.first?`Available history: ${date(data.coverage.first)} to ${date(data.coverage.last)}.`:'No matching sale history for this condition.'} Blank intervals contain no recorded sales. {data.coverage.missingShipping>0?`${data.coverage.missingShipping} sales omitted because shipping was not stated. `:''}{data.coverage.truncated?'Only the newest 20,000 captured records were inspected. ':''}{basis==='item'?'Shipping and tax excluded.':'Tax excluded; unstated shipping is never treated as free.'}</p></div>
        <div className="market-lower-grid"><section className="market-evidence"><div className="market-section-heading"><h3>Recorded sales</h3>{data.totalSales>0&&<a href={`${exportResource}&format=csv`} download>Export CSV <span aria-hidden="true">↓</span></a>}</div><p className="market-footnote">{bucket?`${date(bucket.date)}${bucket.end!==bucket.date?' – '+date(bucket.end):''}`:`${conditions[condition]} · ${basis==='item'?'Item price':'Item + shipping'}`} · {bucket?'Within the 100 most recent sales':'Newest first'}</p>
          {!evidence.length&&<p className="market-empty">{bucket?'No source rows in this interval among the 100 newest sales. Export CSV for all matching rows.':'No recorded sales in the selected period.'}</p>}
          {evidence.slice(0,more?100:5).map(s=><div className="market-sale" key={s.id}><div>{s.url?<a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}<span aria-hidden="true"> ↗</span></a>:<span>{s.title}</span>}<small>eBay · {date(s.date)}{basis==='item'&&s.shippingCents===null?' · Shipping not stated':''}</small></div><strong>{money(s.itemCents+(basis==='delivered'?(s.shippingCents??0):0))}</strong></div>)}
          {evidence.length>5&&<button className="market-more btn secondary" onClick={()=>setMore(v=>!v)}>{more?'Show fewer sales':`Show ${evidence.length} recent sales`}</button>}
          <details className="market-data-table"><summary>View chart data</summary><div><table><caption>{data.interval} price summary, USD</caption><thead><tr><th>From</th><th>Sales</th><th>Median</th><th>Middle 50%</th></tr></thead><tbody>{data.points.map(p=><tr key={p.date}><td>{date(p.date)}</td><td>{p.count}</td><td>{money(p.medianCents)}</td><td>{p.lowCents===null?'—':`${money(p.lowCents)} – ${money(p.highCents)}`}</td></tr>)}</tbody></table></div></details>
        </section><aside className="market-context"><h3>Keep researching</h3><a className="market-context-link" href={`/?q=${encodeURIComponent(data.product.model)}&quality=all`} onClick={e=>{if(e.button===0&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey){e.preventDefault();pushRoute(e.currentTarget.getAttribute('href')!);}}}><span>Find local listings<small>Search this model in Filtrsoft</small></span><span aria-hidden="true">↗</span></a><a className="market-context-link" href="https://pangoly.com/en/price-trends" target="_blank" rel="noopener noreferrer"><span>Retail price trends<small>Pangoly · New retail prices, separate from this chart</small></span><span aria-hidden="true">↗</span></a><a className="market-context-link" href="https://www.ebay.com/help/selling/selling-tools/terapeak-research?id=4853" target="_blank" rel="noopener noreferrer"><span>Longer sale history<small>eBay Product Research · Up to 3 years for sellers</small></span><span aria-hidden="true">↗</span></a><details className="market-method"><summary>How this chart works</summary><p>Each point is the median of recorded eBay sales in that interval. The range shows the middle 50% of prices, not a confidence interval or a guaranteed resale price. Bar height counts the captured sales, not total market volume.</p><p>Models, stated configurations and conditions are kept separate. Incomplete configurations are labeled. Missing dates are never interpolated. Period change requires at least three sales in both endpoint intervals.</p><p>{data.coverage.excluded} captured rows were excluded by sale-evidence, condition, exact-model, bundle or quantity checks. This chart does not change Filtrsoft’s valuation rules.</p></details></aside></div>
      </>}
    </>}
    {picker&&<Popup title="Choose a product" onClose={()=>setPicker(false)} className="market-picker-popup">{dismiss=><ProductPicker initialQuery={query.get('q')??''} onChoose={p=>dismiss(()=>choose(p))}/>}</Popup>}
  </section>;
}
