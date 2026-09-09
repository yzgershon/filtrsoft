/** Separate preview entry, excluded from the production entrypoint. All state
 * is synthetic and held only in memory. No API, account, or engine writes. */
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrandMark,Wordmark} from './brand.tsx';
import {Gcard} from './feed.tsx';
import {Popup} from './popup.tsx';
import {Save,Check,Scan,Grid,Sliders} from './icons.tsx';
import {money,LABEL} from './lib.tsx';
import type {FeedItem,Call} from './types.ts';
import './styles.css';
import './feature-preview.css';

const examples:Array<FeedItem & {identity:string;value:number|null;risk:string}>=[
  {id:1,title:'NZXT gaming desktop',identity:'RTX 3070 · Ryzen 7 · RAM layout unknown',value:91500,risk:'Run a benchmark and check temperatures.',askingPriceCents:75000,call:'BUY',netProfitCents:16500,thumb:'/feature-assets/0',source:'craigslist',location:'Newton, MA',postedAt:null,url:'#',headline:null},
  {id:2,title:'Dell Latitude 7420',identity:'16GB RAM · 512GB SSD · i7 variant unconfirmed',value:null,risk:'Confirm the processor and check battery health.',askingPriceCents:29500,call:'VERIFY',netProfitCents:null,thumb:'/feature-assets/1',source:'facebook',location:'Cambridge, MA',postedAt:null,url:'#',headline:null},
  {id:3,title:'iPhone 15 · 128GB',identity:'128GB · seller says unlocked',value:43500,risk:'Verify Activation Lock, IMEI and carrier status.',askingPriceCents:35000,call:'VERIFY',netProfitCents:8500,thumb:'/feature-assets/2',source:'craigslist',location:'Somerville, MA',postedAt:null,url:'#',headline:null},
];
const inspections=['Confirm exact specifications','Check locks and account removal','Test ports, charging and thermals'];
function Preview(){
  const [tab,setTab]=useState<'compare'|'review'|'notes'>('compare'),[query,setQuery]=useState('');
  const [saved,setSaved]=useState([1,2,3]);const toggleSaved=(id:number)=>setSaved(old=>old.includes(id)?old.filter(i=>i!==id):[...old,id]);
  const [selected,setSelected]=useState<number[]>([1,2]),[compare,setCompare]=useState(false),[open,setOpen]=useState<number|null>(null);
  const [notes,setNotes]=useState<Record<number,string>>({}),[checks,setChecks]=useState<Record<number,string[]>>({});
  const [at,setAt]=useState(0),[labels,setLabels]=useState<Record<number,Call>>({}),[choose,setChoose]=useState(false);
  const row=examples[at],entry=examples.find(i=>i.id===open);
  const toggle=(id:number)=>setSelected(s=>s.includes(id)?s.filter(i=>i!==id):s.length<3?[...s,id]:s);
  return <><div className="app feature-app">
    <header className="feature-top"><span className="brand"><BrandMark/><Wordmark/></span><span className="feature-tag">Feature preview</span></header>
    <main className="feature-main">
      <p className="feature-notice">Example data. Nothing is saved to your account.</p>
      <div className="feature-tabs" role="group" aria-label="Features to try">{([['compare','Compare',Grid],['review','Next review',Check],['notes','Private notes',Scan]] as const).map(([id,label,Icon])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}><Icon size={17}/>{label}</button>)}</div>
      {tab==='compare' && <>
        <label className="feature-search"><Scan size={18}/><input type="search" aria-label="Search example listings" placeholder="Search saved listings" value={query} onChange={e=>setQuery(e.target.value)}/></label>
        <div className="feature-toolbar"><span>{selected.length} selected</span><button className="btn2" disabled={selected.length<2} onClick={()=>setCompare(true)}>Compare selected</button></div>
        <div className="feature-grid">{examples.filter(i=>i.title.toLowerCase().includes(query.toLowerCase())).map(i=><div key={i.id}><Gcard i={i} saved={saved.includes(i.id)} onSave={()=>toggleSaved(i.id)} onOpen={()=>setOpen(i.id)}/><label className="feature-select"><input type="checkbox" checked={selected.includes(i.id)} onChange={()=>toggle(i.id)}/> Compare this listing</label></div>)}</div>
      </>}
      {tab==='review' && <div className="feature-review">
        <div className="feature-toolbar"><h1>Review</h1><span>{Object.keys(labels).length} of {examples.length} reviewed</span></div>
        <progress value={Object.keys(labels).length} max={examples.length}/><p className="micro2">These three examples stay in this batch. Next never records a label.</p>
        <Gcard i={row} saved={saved.includes(row.id)} onSave={()=>toggleSaved(row.id)} onOpen={()=>setOpen(row.id)}/>
        <div className="scard feature-facts"><b>{row.identity}</b><p>{row.risk}</p></div>
        <div className="feature-toolbar"><span role="status">{labels[row.id]?`Your call: ${LABEL[labels[row.id]]}`:'No review recorded'}</span>{labels[row.id] && <button className="btn3" onClick={()=>setLabels(old=>{const copy={...old};delete copy[row.id];return copy;})}>Undo</button>}</div>
        <button className="btn2 feature-full" onClick={()=>setChoose(true)}>Your call</button>
        <div className="feature-toolbar"><button className="btn3" disabled={at===0} onClick={()=>setAt(n=>n-1)}>Previous</button><span>{at+1} / {examples.length}</span><button className="btn3" disabled={at===examples.length-1} onClick={()=>setAt(n=>n+1)}>Next listing</button></div>
      </div>}
      {tab==='notes' && <><div className="feature-toolbar"><h1>Private notes</h1><span>3 examples</span></div><div className="feature-grid">{examples.map(i=><div key={i.id}><Gcard i={i} saved={saved.includes(i.id)} onSave={()=>toggleSaved(i.id)} onOpen={()=>setOpen(i.id)}/><button className="btn3 feature-full" onClick={()=>setOpen(i.id)}>{notes[i.id]?'Open notes':'Add note'} · {checks[i.id]?.length??0}/{inspections.length} checks</button></div>)}</div><p className="micro2">Your notes and checks stay separate from the seller’s claims and engine evidence.</p></>}
      <p className="feature-footer">Current Filtrsoft styling · prototypes only · resets on reload</p>
    </main></div>
    {compare && <Popup title="Compare listings" className="feature-compare" onClose={()=>setCompare(false)}>{()=> <><p className="micro2">Synthetic estimates. Unknowns remain unknown.</p><div className="feature-comparison">{examples.filter(i=>selected.includes(i.id)).map(i=><article key={i.id}><img src={i.thumb!} alt={i.title}/><h2>{i.title}</h2><dl><dt>Asking</dt><dd>{money(i.askingPriceCents)}</dd><dt>Estimated proceeds</dt><dd>{i.value===null?'Unknown':money(i.value)}</dd><dt>Exact identity</dt><dd>{i.identity}</dd><dt>Check before pickup</dt><dd>{i.risk}</dd></dl></article>)}</div></>}</Popup>}
    {entry && <Popup title="My notes" onClose={()=>setOpen(null)}>{dismiss=><div className="feature-note"><b>{entry.title}</b><p className="micro2">Personal notes only. Checking a box does not change the engine’s call.</p><label htmlFor="personal-note">Note</label><textarea id="personal-note" rows={4} placeholder="What did the seller confirm?" value={notes[entry.id]??''} onChange={e=>setNotes(old=>({...old,[entry.id]:e.target.value}))}/><fieldset><legend>Inspection</legend>{inspections.map(text=><label key={text}><input type="checkbox" checked={checks[entry.id]?.includes(text)??false} onChange={()=>setChecks(old=>({...old,[entry.id]:(old[entry.id]??[]).includes(text)?old[entry.id].filter(t=>t!==text):[...(old[entry.id]??[]),text]}))}/>{text}</label>)}</fieldset><button className="btn2 feature-full" onClick={()=>dismiss()}>Done</button></div>}</Popup>}
    {choose && <Popup title="Your call" subtitle="Records an example review only." onClose={()=>setChoose(false)}>{dismiss=><div className="feature-choices">{(['BUY','VERIFY','FAIR','PASS','RISK'] as Call[]).map(call=><button className="btn3" key={call} onClick={()=>{setLabels(old=>({...old,[row.id]:call}));dismiss();}}>{LABEL[call]}</button>)}</div>}</Popup>}
  </>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
