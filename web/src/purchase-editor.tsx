import {useEffect,useId,useState} from 'react';
import {Popup,type Dismiss} from './popup.tsx';
import {requestJSON,requestMessage} from './api-client.ts';
import {money,toast} from './lib.tsx';

export type Purchase={id:number;listingId:number;title:string;source:string;thumb:string|null;askingPriceCents:number|null;
  paidCents:number|null;worthCents:number|null;marginCents:number|null;engineCall:string|null;decisionWorthCents:number|null;
  realizedProfitCents:number|null;soldPriceCents:number|null;feesCents:number|null;shippingCents:number|null;otherCostsCents:number|null;
  soldChannel:string|null;soldAt:string|null;boughtAt:string;notes:string|null;revision:number};
const amount=(n:number|null|undefined)=>n==null?'':(n/100).toFixed(2);
export function parseDollars(s:string):number|null {
  if(!s.trim())return null;
  if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(s.trim()))throw new Error('Use a dollar amount such as 250 or 17.50.');
  const [dollars,cents='']=s.trim().split('.'),value=Number(dollars)*100+Number(cents.padEnd(2,'0'));
  if(value>100000000)throw new Error('The amount must be $1,000,000 or less.');
  return value;
}
const markets:Record<string,string>={facebook:'Facebook',craigslist:'Craigslist',offerup:'OfferUp',mercari:'Mercari',ebay:'eBay',other:'Other'};
export function PurchaseEditor({purchase,onClose,onSaved}:{purchase:Purchase;onClose:()=>void;onSaved:()=>void}) {
  const id=useId();
  const initial={paidCents:amount(purchase.paidCents),soldPriceCents:amount(purchase.soldPriceCents),feesCents:amount(purchase.feesCents),
    shippingCents:amount(purchase.shippingCents),otherCostsCents:amount(purchase.otherCostsCents),soldAt:purchase.soldAt?.slice(0,10)??'',
    soldChannel:purchase.soldChannel??'',notes:purchase.notes??''};
  const key=`filtrsoft:purchase-draft:${purchase.id}`;
  const [stored]=useState(()=>{try{const v=JSON.parse(sessionStorage.getItem(key)??'null');
    return v&&typeof v.sold==='boolean'&&v.form&&Object.keys(initial).every(k=>typeof v.form[k]==='string')?v:null;
  }catch{return null;}});
  const compatible=stored?.revision===(purchase.revision??0);
  const [form,setForm]=useState<typeof initial>(compatible?stored.form:initial);
  const [sold,setSold]=useState<boolean>(compatible?stored.sold:purchase.soldPriceCents!=null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [oldDraft,setOldDraft]=useState(stored&&!compatible?stored:null);
  const dirty=JSON.stringify(form)!==JSON.stringify(initial)||sold!==(purchase.soldPriceCents!=null);
  useEffect(()=>{try{if(dirty)sessionStorage.setItem(key,JSON.stringify({revision:purchase.revision??0,form,sold}));else if(!oldDraft)sessionStorage.removeItem(key);}catch{}},[form,sold,dirty,key,oldDraft,purchase.revision]);
  useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};addEventListener('beforeunload',warn);return()=>removeEventListener('beforeunload',warn);},[dirty]);
  const discard=()=>{setForm(initial);setSold(purchase.soldPriceCents!=null);setOldDraft(null);try{sessionStorage.removeItem(key);}catch{}};
  const set=(key:keyof typeof form,value:string)=>setForm(f=>({...f,[key]:value}));
  let profit:number|null=null;
  try{const values=[form.soldPriceCents,form.paidCents,form.feesCents,form.shippingCents,form.otherCostsCents].map(parseDollars);
    if(sold&&values.every(v=>v!==null))profit=values[0]!-values[1]!-values[2]!-values[3]!-values[4]!;
  }catch{}
  const save=async(dismiss:Dismiss)=>{if(busy)return;setError('');setBusy(true);try{
    const paidCents=parseDollars(form.paidCents),soldPriceCents=sold?parseDollars(form.soldPriceCents):null;
    if(sold&&soldPriceCents===null)throw new Error('Add the actual sale amount.');
    if(sold&&(!form.soldAt||!form.soldChannel))throw new Error('Add the sale date and marketplace.');
    await requestJSON(`/v1/purchases/${purchase.id}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({
      revision:purchase.revision??0,paidCents,soldPriceCents,feesCents:parseDollars(form.feesCents),shippingCents:parseDollars(form.shippingCents),otherCostsCents:parseDollars(form.otherCostsCents),
      soldAt:sold?form.soldAt:null,soldChannel:sold?form.soldChannel:null,notes:form.notes,
    })});try{sessionStorage.removeItem(key);}catch{}toast('Purchase updated');dismiss(onSaved);
  }catch(e){setError(requestMessage(e));}finally{setBusy(false);}};
  const field=(key:keyof typeof form,label:string)=><div className="workspace-field"><label htmlFor={`${id}-${key}`}>{label}</label><div className="money-input"><span aria-hidden="true">$</span><input id={`${id}-${key}`} inputMode="decimal" autoComplete="off" value={form[key]} onChange={e=>set(key,e.target.value)} disabled={busy}/></div></div>;
  return <Popup title="Purchase record" subtitle={purchase.title} onClose={onClose} className="purchase-editor-popup">{dismiss=><form className="purchase-editor" onSubmit={e=>{e.preventDefault();void save(dismiss);}}>
    {oldDraft&&<details className="draft-recovery"><summary>Recover an earlier unsaved draft</summary><p>The saved record changed. These earlier entries were not applied.</p><pre>{Object.entries(oldDraft.form).map(([k,v])=>`${k}: ${v}`).join('\n')}</pre><button className="btn2" type="button" onClick={discard}>Discard old draft</button></details>}
    <fieldset disabled={busy}><legend className="sr-only">Transaction details</legend>
      <div className="transaction-state" role="group" aria-label="Sale status"><button type="button" aria-pressed={!sold} onClick={()=>setSold(false)}>In inventory</button><button type="button" aria-pressed={sold} onClick={()=>setSold(true)}>Sold</button></div>
      {field('paidCents','Price paid')}
      {sold&&<div className="transaction-grid">{field('soldPriceCents','Sold for')}<div className="workspace-field"><label htmlFor={`${id}-date`}>Sale date</label><input id={`${id}-date`} type="date" value={form.soldAt} onChange={e=>set('soldAt',e.target.value)}/></div>
        <div className="workspace-field transaction-full"><label htmlFor={`${id}-channel`}>Sold through</label><select id={`${id}-channel`} value={form.soldChannel} onChange={e=>set('soldChannel',e.target.value)}><option value="">Choose marketplace</option>{Object.entries(markets).map(([k,label])=><option key={k} value={k}>{label}</option>)}</select></div></div>}
      <h3>Actual costs</h3><p className="micro2">Leave unknown amounts blank. Enter 0 only when there was no cost. Other costs can include repairs, parts and travel.</p>
      <div className="transaction-grid">{field('feesCents','Selling fees')}{field('shippingCents','Shipping cost')}{field('otherCostsCents','Other costs')}</div>
      <div className="workspace-field"><label htmlFor={`${id}-notes`}>Private transaction notes</label><textarea id={`${id}-notes`} rows={3} maxLength={4000} value={form.notes} onChange={e=>set('notes',e.target.value)}/></div>
      {sold&&<div className="transaction-profit"><span>Recorded profit</span><strong className={`num ${profit!==null?(profit>=0?'pos':'neg'):''}`}>{profit===null?'Costs incomplete':money(profit)}</strong><small>Sale minus price paid, fees, shipping and other costs. Before tax; your labor is only included if you record it in other costs.</small></div>}
    </fieldset>
    {error&&<p role="alert" className="workspace-error">{error}</p>}
    <div className="transaction-footer"><button type="button" className="btn2" disabled={busy} onClick={()=>dismiss()}>Cancel</button><button className="btn" disabled={busy} type="submit">{busy?'Saving…':'Save record'}</button></div>
    <p className="micro2">Corrections keep a revision record. The original engine decision stays unchanged.</p>
    {dirty&&<p className="micro2">Closing keeps this draft in this browser tab. <button type="button" className="draft-discard" disabled={busy} onClick={discard}>Discard changes</button></p>}
  </form>}</Popup>;
}
