import {useEffect,useRef,useState} from 'react';
import {BrandMark,Wordmark} from './brand.tsx';
import {Check,Shield,Scan,Save,Trend,CompareIcon,Link,Again} from './icons.tsx';

const views=[
  {name:'The value',label:'PRICE WITH CONTEXT',title:'Asking is one thing. Selling is another.',body:'Start with completed sales for matching hardware. See the price range, sample size and original sources behind the estimate.',icon:Trend,rows:['Matching sold listings','Configuration kept intact','Fees and shipping made visible']},
  {name:'The hardware',label:'LOOK A LITTLE CLOSER',title:'The details that change the deal.',body:'Read the specifications in one place. Compare hardware side by side, with unknowns and conflicting seller claims kept visible.',icon:CompareIcon,rows:['CPU, GPU, memory and storage','Exact variants, not just a family name','Missing specifications stay unknown']},
  {name:'The risks',label:'BEFORE YOU DRIVE',title:'A good price can hide a bad purchase.',body:'Check unresolved locks, missing parts and condition questions. Take a focused checklist to the seller, then make your own call.',icon:Shield,rows:['Unresolved concerns','Questions worth asking','Your inspection notes and decision']},
];
export function LandingPage({onStart,onSignIn}:{onStart:()=>void;onSignIn:()=>void}){
  const [view,setView]=useState(0),[menu,setMenu]=useState(false),[stats,setStats]=useState<{comps?:number;skus?:number}|null>(null);
  const root=useRef<HTMLDivElement>(null),selected=views[view],Icon=selected.icon;
  useEffect(()=>{
    const ac=new AbortController();fetch('/v1/landing',{signal:ac.signal}).then(r=>r.ok?r.json():null).then(setStats).catch(()=>{});
    return()=>ac.abort();
  },[]);
  useEffect(()=>{
    const nodes=root.current?.querySelectorAll<HTMLElement>('[data-reveal]');
    if(!nodes||matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.dataset.motion==='reduce')return;
    const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.setAttribute('data-visible','true');observer.unobserve(e.target);}}),{threshold:.08});
    nodes.forEach(n=>{n.dataset.ready='true';observer.observe(n);});return()=>observer.disconnect();
  },[]);
  const brand=<span className="showcase-brand"><BrandMark size={25}/><Wordmark/></span>;
  return <div className="showcase" ref={root}>
    <a className="skip-link" href="#website-main">Skip to content</a>
    <header className="showcase-nav"><a href="#" aria-label="Filtrsoft home">{brand}</a>
      <nav aria-label="Website"><a href="#inside">Inside Filtrsoft</a><a href="#workflow">How it works</a><a href="#questions">Questions</a></nav>
      <div className="showcase-nav-actions"><button className="site-text-button" onClick={onSignIn}>Sign in</button><button className="site-button small" onClick={onStart}>Get started <span aria-hidden="true">↗</span></button><button className="site-menu" aria-label={menu?'Close navigation':'Open navigation'} aria-expanded={menu} aria-controls="site-menu" onClick={()=>setMenu(!menu)}>{menu?'Close':'Menu'}</button></div>
      {menu&&<nav className="showcase-mobile-menu" id="site-menu" aria-label="Mobile website"><a href="#inside" onClick={()=>setMenu(false)}>Inside Filtrsoft</a><a href="#workflow" onClick={()=>setMenu(false)}>How it works</a><a href="#questions" onClick={()=>setMenu(false)}>Questions</a><button onClick={onSignIn}>Sign in</button></nav>}
    </header>
    <main id="website-main">
      <section className="site-hero">
        <div className="site-hero-copy"><span className="site-overline"><i/> USED TECH. A CLEARER PICTURE.</span><h1>See the deal.<br/><span>Know the details.</span></h1><p>Real sold prices. The specs that matter. The risks worth checking. One workspace for your next tech find.</p><div className="site-hero-actions"><button className="site-button" onClick={onStart}>Open your workspace <span aria-hidden="true">↗</span></button><a href="#inside" className="site-secondary">Take a closer look <span aria-hidden="true">↓</span></a></div><small>Free to get started · Your judgment, always</small></div>
        <div className="site-hero-art"><img src="/art/hardware-studio.webp" width="1536" height="1024" fetchPriority="high" alt="Sculptural arrangement of a laptop, graphics card, memory and phone"/><div className="site-art-note"><span className="site-tiny-dot"/> A closer look at the hardware</div><div className="site-float-card"><span className="site-float-icon"><Scan size={22}/></span><span><b>Look beyond the headline.</b><small>Value. Specifications. Condition.</small></span></div></div>
      </section>
      <div className="site-platforms"><span>ONE PLACE TO RESEARCH</span><div><b>Craigslist</b><b>Facebook Marketplace</b><b>OfferUp</b><b>Mercari</b></div><small>Independent research. No marketplace affiliation.</small></div>
      <section id="inside" className="site-inside site-section" data-reveal>
        <div className="site-section-head"><span className="site-overline">01 / THE WHOLE PICTURE</span><h2>Less tab switching.<br/><span>More understanding.</span></h2><p>A listing is the starting point. Bring the evidence, hardware and questions together before you commit.</p></div>
        <div className="site-inside-grid"><div className="site-inside-media"><img src="/art/silicon-detail.webp" width="1536" height="1024" loading="lazy" alt="Close-up of a processor and two memory modules"/><span>HARDWARE IS IN THE DETAILS</span><small>Conceptual hardware artwork</small></div><div className="site-demo">
          <div className="site-demo-tabs" role="tablist" aria-label="Explore the listing report" onKeyDown={e=>{const n=e.key==='ArrowRight'?(view+1)%3:e.key==='ArrowLeft'?(view+2)%3:e.key==='Home'?0:e.key==='End'?2:-1;if(n>=0){e.preventDefault();setView(n);e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[n]?.focus();}}}>{views.map((x,i)=><button key={x.name} id={`site-tab-${i}`} role="tab" aria-selected={view===i} aria-controls="site-demo-panel" tabIndex={view===i?0:-1} onClick={()=>setView(i)}>{x.name}</button>)}</div>
          <div id="site-demo-panel" role="tabpanel" aria-labelledby={`site-tab-${view}`} tabIndex={0}><div key={view} className="site-demo-content"><span className="site-demo-icon"><Icon size={24}/></span><span className="site-overline">{selected.label}</span><h3>{selected.title}</h3><p>{selected.body}</p><ul>{selected.rows.map(x=><li key={x}><Check size={16}/>{x}</li>)}</ul></div></div><div className="site-demo-foot"><span>Explore the approach</span><span>0{view+1} / 03</span></div>
        </div></div>
      </section>
      <section className="site-workflow site-section" id="workflow" data-reveal><div className="site-section-head"><span className="site-overline">02 / FROM FIRST LOOK TO FINAL CALL</span><h2>A better way<br/><span>to buy used tech.</span></h2></div><div className="site-steps">{[{icon:Link,n:'01',title:'Find something interesting.',body:'Browse local listings or bring a listing link into your workspace.'},{icon:Scan,n:'02',title:'See what holds up.',body:'Review sold-price evidence, inspect the specifications and check unresolved concerns.'},{icon:Save,n:'03',title:'Keep the whole story.',body:'Save a prospect, record your inspection, and track the purchase and resale.'}].map(x=><article key={x.n}><div><x.icon size={22}/><span>{x.n}</span></div><h3>{x.title}</h3><p>{x.body}</p></article>)}</div></section>
      <section className="site-features site-section" data-reveal>
        <article className="site-history-feature"><span className="site-overline"><Trend size={15}/> PRICE HISTORY</span><h2>Watch the market.<br/>Not just the asking price.</h2><p>Explore recorded sales over time. Separate configurations and conditions, inspect the source listings, and export the evidence.</p><div className="site-range-art" aria-hidden="true"><span>1M</span><span>3M</span><span>6M</span><b>1Y</b><span>3Y</span><span>ALL</span></div><div className="site-history-lines" aria-hidden="true"><i/><i/><i/><span>Recorded sales → clearer context</span></div><small>Coverage varies by product. Missing history stays visible.</small></article>
        <article className="site-sync-feature"><div className="site-device-art" aria-hidden="true"><div className="site-device desktop"><div className="device-bar"/><div className="device-row"><i/><i/><i/></div><div className="device-line"/><div className="device-line short"/></div><span className="site-sync-connector"><Again size={22}/></span><div className="site-device phone"><div className="device-bar"/><div className="device-row"><i/></div><div className="device-line"/><div className="device-line short"/></div></div><span className="site-overline">YOUR WORKSPACE, EVERYWHERE</span><h2>Start at your desk.<br/>Pick up on your phone.</h2><p>Sign into the same account to carry saved listings, preferences and your research between devices. Save your notes before heading out.</p><a className="site-secondary" href="#questions">See how sync works <span aria-hidden="true">↗</span></a></article>
      </section>
      <section className="site-evidence-strip" data-reveal><p>Built around evidence.<br/><span>Comfortable saying “I can’t tell.”</span></p><div>{typeof stats?.comps==='number'&&stats.comps>0?<><b>{stats.comps.toLocaleString()}</b><span>sale records in the archive</span></>:<><Shield size={26}/><span>Uncertainty stays visible</span></>}</div>{typeof stats?.skus==='number'&&stats.skus>0&&<div><b>{stats.skus.toLocaleString()}</b><span>products in the catalog</span></div>}</section>
      <section className="site-questions site-section" id="questions" data-reveal><div className="site-section-head"><span className="site-overline">A FEW GOOD QUESTIONS</span><h2>Know what<br/><span>you’re working with.</span></h2></div><div>{[
        ['Does Filtrsoft guarantee a good purchase?','No. Sold-price evidence adds context, but a seller’s claims, condition and hidden defects still need checking. Filtrsoft keeps those unknowns visible. You make the final call.'],
        ['Will my computers and phone stay in sync?','Yes. Use the same account. Saved listings, preferences, recent history and notification history sync automatically. Reviews, saved inspection notes, purchases, market pins and searches belong to your account too. Device permissions and unsaved drafts stay on that device.'],
        ['How much price history is available?','Choose ranges from one month to three years or all recorded history. Coverage depends on the product and configuration. Some hardware has very little evidence; missing periods are never filled with invented prices.'],
        ['Does it message sellers or buy things for me?','No. You can open the original listing to contact the seller yourself. Filtrsoft helps you research and keep track of your decisions.'],
      ].map(([q,a])=><details key={q}><summary>{q}<span aria-hidden="true">+</span></summary><p>{a}</p></details>)}</div></section>
      <section className="site-finale" data-reveal><span className="site-overline">LESS GUESSING. BETTER QUESTIONS.</span><h2>Your next find.<br/><span>A clearer decision.</span></h2><button className="site-button" onClick={onStart}>Get started with Filtrsoft <span aria-hidden="true">↗</span></button><p>Built for used tech. Grounded in the evidence.</p></section>
    </main>
    <footer className="site-footer">{brand}<span>Independent used-tech research · Greater Boston</span><div><a href="/privacy">Privacy</a><button className="site-text-button" onClick={onSignIn}>Sign in ↗</button></div></footer>
  </div>;
}
