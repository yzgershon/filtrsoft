import type {Meta} from './types.ts';
import {Info,Check,Scan} from './icons.tsx';

type Reading=NonNullable<Meta['photoReading']>;
type Fact=Reading['agreed'][number];
const LABEL:Record<string,string>={model:'Model',partNumber:'Part number',cpu:'CPU',gpu:'GPU',ram:'RAM',storage:'Storage',vram:'Video memory',kitLayout:'Kit layout',
  memorySpeed:'Memory speed',memoryType:'Memory type',ecc:'ECC',quantity:'Quantity',brand:'Brand'};
const label=(field:string)=>LABEL[field]??field;
const photo=(i:number)=>`photo ${i+1}`;
const when=(iso:string)=>new Date(iso).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});

/**
 * Display-only photo readings. Two independent readers must report the same
 * value before a fact is shown as agreed; single-reader values stay collapsed
 * and labelled unchecked. None of this changes the call.
 */
export function PhotoReading({reading}:{reading?:Meta['photoReading']}) {
  if(!reading)return null;
  const verified=reading.status==='verified';
  const singles:(Fact&{reader:string})[]=[...reading.lunaOnly.map(f=>({...f,reader:'GPT-6 Luna'})),...reading.gemmaOnly.map(f=>({...f,reader:'Gemma 31B'}))];
  return <section className="spec-sheet photo-reading" aria-label="Read from photos">
    <header className="tab-section-head"><div><h2>Read from photos</h2><p>Unverified automated reading. It does not change the call.</p></div><Scan size={22}/></header>
    <div className="spec-coverage"><span>{verified?'Checked by two independent readers':reading.status==='gemma_failed'?'Second reader could not check these photos':'Waiting for the second reader'}</span>
      <span>{reading.photoCount} {reading.photoCount===1?'photo':'photos'} read</span></div>
    {reading.photosChanged&&<p className="spec-notice"><Info size={13}/> The seller's photos changed after this reading.</p>}
    {verified&&<>
      <h3>Both readers agree</h3>
      {reading.agreed.length?<dl className="spec-fields">{reading.agreed.map((f,i)=><div className="spec-field" key={`${f.field}-${i}`}><dt>{label(f.field)}</dt><dd>
        <strong>{f.value}</strong>
        <details className="spec-source"><summary><Check size={13}/> {photo(f.image)}</summary>
          <div><b>GPT-6 Luna · {photo(f.image)}</b><blockquote>{f.quote}</blockquote></div>
          {f.other&&<div><b>Gemma 31B · {photo(f.other.image)}</b><blockquote>{f.other.quote}</blockquote></div>}
          <p>Check the photo before relying on this value.</p>
        </details>
      </dd></div>)}</dl>:<p className="spec-notice">The two readers did not read any fact the same way.</p>}
      {!!reading.conflicts.length&&<><h3>Readers disagree</h3><dl className="spec-fields">{reading.conflicts.map(c=><div className="spec-field spec-multiple" key={c.field}><dt>{label(c.field)}</dt><dd>
        <strong>Different values read</strong><div className="spec-values">{c.luna.map(v=><span key={'l'+v}>GPT-6 Luna: {v}</span>)}{c.gemma.map(v=><span key={'g'+v}>Gemma 31B: {v}</span>)}</div>
      </dd></div>)}</dl></>}
    </>}
    {!!singles.length&&<details className="spec-extra" open={!verified}><summary>{verified?'Read by one reader only':'Read by one reader so far, unchecked'} <span>{singles.length}</span></summary>
      <ul>{singles.map((f,i)=><li key={i}><b>{label(f.field)}: {f.value}</b> · {f.reader}, {photo(f.image)} · “{f.quote}”</li>)}</ul></details>}
    <p className="spec-notice">GPT-6 Luna ({reading.luna.effort}) read these photos {when(reading.luna.readAt)}{reading.gemma?`; Gemma 31B on the collector checked them ${when(reading.gemma.readAt)}`:''}. A single reader can misread digits or report a product that is not in the photo, especially on sideways labels.</p>
  </section>;
}
