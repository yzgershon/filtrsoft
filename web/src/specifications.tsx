import type {Meta} from './types.ts';
import {Info,Check,Scan} from './icons.tsx';
const names={title:'Listing title',description:'Seller description',attribute:'Seller attribute',photo:'Photo read'};
export function SpecificationSheet({specs,inventory}:{specs:Meta['specifications'];inventory?:boolean}) {
  if(inventory)return <div className="spec-empty"><Info size={22}/><h2>Multiple items</h2><p>This ad has separate offers. Each item keeps its own specifications and seller quote in the Decision tab.</p></div>;
  const fields=specs?.fields??[],missing=fields.filter(f=>f.state==='unknown').length,multiple=fields.filter(f=>f.state==='multiple').length;
  return <section className="spec-sheet">
    <header className="tab-section-head"><div><h2>Specifications</h2><p>From the seller's text and recorded photo reads.</p></div><Scan size={22}/></header>
    <div className="spec-coverage"><span>{fields.length-missing} of {fields.length} fields reported</span><span>{multiple?`${multiple} need confirmation`:missing?`${missing} not stated`:'Source details below'}</span></div>
    {!fields.length && <p className="spec-notice">No specification evidence was recorded for this check.</p>}
    <dl className="spec-fields">{fields.map(field=><div className={`spec-field spec-${field.state}`} key={field.key}>
      <dt>{field.label}</dt><dd>
        {field.state==='unknown'?<span className="spec-unknown">Not stated</span>:<>
          <strong>{field.state==='multiple'?'Multiple values reported':[...field.values].sort((a,b)=>b.value.length-a.value.length)[0].value}</strong>
          {field.state==='multiple' && <div className="spec-values">{[...new Set(field.values.map(e=>e.value))].map(v=><span key={v}>{v}</span>)}</div>}
          <details className="spec-source"><summary>{field.state==='multiple'?<Info size={13}/>:<Check size={13}/>} {field.state==='multiple'?'Check source details':names[field.values[0].source]}</summary>
            {field.values.map((e,i)=><div key={i}><b>{names[e.source]}{e.source==='photo'?' · automated read':''}</b><blockquote>{e.quote}</blockquote>{e.source==='photo'&&<p>Read value: {e.value}. Check the original photo before relying on it.</p>}</div>)}
          </details>
        </>}
      </dd>
    </div>)}</dl>
    <p className="spec-notice">{specs?.photoStatus==='recorded'?'Recorded photo reads are included. Unreadable labels and conflicting values still need checking.':'No current photo read is recorded. Specifications that appear only in photos may be missing.'}</p>
    {!!specs?.attributes?.length && <details className="spec-extra"><summary>Other seller attributes <span>{specs.attributes.length}</span></summary><dl className="detail-facts">{specs.attributes.map((a,i)=><div key={i}><dt>{a.label}</dt><dd>{a.value}</dd></div>)}</dl></details>}
    {!!specs?.notes?.length && <details className="spec-extra"><summary>Additional evidence <span>{specs.notes.length}</span></summary><ul>{specs.notes.map((note,i)=><li key={i}>{note}</li>)}</ul></details>}
  </section>;
}
