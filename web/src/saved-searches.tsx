import { useEffect, useRef, useState } from "react";
import {useAccountRefresh} from './account-refresh.ts';
import { Bell, Save } from "./icons.tsx";
import { Popup } from "./popup.tsx";
import { RequestError } from "./request-state.tsx";
import { requestJSON, requestMessage } from "./api-client.ts";
import { pushRoute } from "./history.ts";
import { CATEGORIES, SOURCES, SORTS, activeFilterCount, type Filters, type Quality, type Sort } from "./nav.ts";
import { money, toast, reconcilePushSubscription, SUBKEY, urlB64ToBytes } from "./lib.tsx";

const qualities: Array<[Quality,string]> = [["review","Review"],["all","All listings"],["ready","Buy it"],["verify","Verify first"],["risky","Risky"],["browse","Fair and Pass"]];
type Search = { id:number;label:string;query:string|null;category:string|null;source:string|null;quality:Quality|null;sort:Sort;
  max_price_cents:number|null;min_profit_cents:number|null;calls:string|null;standing:number;sub_id:number|null;notifications:boolean;needsReview:boolean;openUrl:string|null };
const validList = (d:any) => Array.isArray(d?.items) && d.items.every((s:any)=>Number.isInteger(s?.id) && typeof s.label === "string" && (s.calls==null||typeof s.calls==='string'));
const summary = (s:Search) => [s.query && `“${s.query}”`, CATEGORIES.find(c=>c.id===s.category)?.label, SOURCES.find(c=>c.id===s.source)?.label,
  s.max_price_cents != null && `up to ${money(s.max_price_cents)}`, qualities.find(([q])=>q===s.quality)?.[1],
  s.calls && `Calls: ${s.calls}`, s.min_profit_cents != null && `minimum profit ${money(s.min_profit_cents)}`].filter(Boolean).join(" · ") || "No product filters recorded";

/** This function is called only from a notification action. Saving criteria
 * does not request permission or require a device delivery endpoint. */
async function enableDevice(): Promise<number> {
  const existing = await reconcilePushSubscription(); if(existing)return existing;
  if(typeof Notification === "undefined" || !("serviceWorker" in navigator))throw new Error("Notifications are unavailable in this browser. You can still save searches.");
  if(await Notification.requestPermission() !== "granted")throw new Error("Notifications are blocked. The search remains saved.");
  const keys=await requestJSON<{publicKey:string;configured:boolean}>("/v1/push/vapid");
  if(!keys.configured || !keys.publicKey)throw new Error("Notification delivery is unavailable. Try again later.");
  const registration=await navigator.serviceWorker.ready;
  const subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlB64ToBytes(keys.publicKey)});
  const result=await requestJSON<{subId:number}>("/v1/push/subscribe",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(subscription.toJSON())},d=>Number.isInteger(d?.subId));
  localStorage.setItem(SUBKEY,String(result.subId)); return result.subId;
}

function SearchEditor({ initial, filters, onSaved }: { initial?:Search;filters?:Filters;onSaved:()=>void }) {
  const [query,setQuery]=useState(initial?.query??filters?.q??"");
  const [category,setCategory]=useState(initial?.category??filters?.category??"");
  const [source,setSource]=useState(initial?.source??filters?.source??"");
  const [quality,setQuality]=useState<Quality>(initial?.quality??filters?.quality??"all");
  const [sort,setSort]=useState<Sort>(initial?.sort??filters?.sort??"best");
  const [max,setMax]=useState(()=>{const n=initial?.max_price_cents??filters?.maxPrice;return n==null?"":String(n/100);});
  const [busy,setBusy]=useState(false), [error,setError]=useState<string|null>(null);
  const sending=useRef(false);
  const save=async()=>{
    if(sending.current)return;
    const amount=max.trim();
    if(amount && (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount)<=0 || Number(amount)>1_000_000)){setError("Enter a positive maximum price with at most two decimal places.");return;}
    sending.current=true;setBusy(true);setError(null);
    try {
      await requestJSON(initial?`/v1/searches/${initial.id}`:"/v1/searches",{method:initial?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        label:query.trim() || CATEGORIES.find(c=>c.id===category)?.label || qualities.find(([q])=>q===quality)?.[1] || "Saved search",
        query:query.trim()||null,category:category||null,source:source||null,quality,sort,maxPriceCents:amount?Math.round(Number(amount)*100):null,
      })},d=>Number.isInteger(d?.id));
      onSaved();
    } catch(error){setError(requestMessage(error));}
    finally{sending.current=false;setBusy(false);}
  };
  return <form className="search-editor" onSubmit={e=>{e.preventDefault();void save();}} aria-busy={busy}>
    {initial?.needsReview && <p className="popup-copy">The old search stored {summary(initial)}. Its title may mention filters that were never stored. Check the filters below before saving. This replaces the old call and profit filters; it does not infer them from the title.</p>}
    <label className="fld"><span>Search words</span><input value={query} onChange={e=>setQuery(e.target.value)} maxLength={80} placeholder="e.g. RTX 4090" /></label>
    <div className="filtergrid">
      <label className="fld"><span>Category</span><select value={category} onChange={e=>setCategory(e.target.value)}><option value="">All categories</option>{CATEGORIES.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label className="fld"><span>Marketplace</span><select value={source} onChange={e=>setSource(e.target.value)}><option value="">All marketplaces</option>{SOURCES.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label className="fld"><span>Maximum asking price</span><input value={max} onChange={e=>setMax(e.target.value)} inputMode="decimal" placeholder="No limit" /></label>
      <label className="fld"><span>Listings</span><select value={quality} onChange={e=>setQuality(e.target.value as Quality)}>{qualities.map(([q,label])=><option key={q} value={q}>{label}</option>)}</select></label>
      <label className="fld"><span>Sort</span><select value={sort} onChange={e=>setSort(e.target.value as Sort)}>{SORTS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
    </div>
    <p className="snote">{initial?.notifications?"Notifications use these filters. Changes apply to new matches.":"Saved to your account. Notifications stay off until you turn them on."}</p>
    {error && <p className="mutation-error" role="alert">{error}</p>}
    <button className="cta popup-primary" disabled={busy}>{busy?"Saving…":initial?"Save filters":"Save search"}</button>
  </form>;
}

export function SaveSearch({ f }: {f:Filters}) {
  const [open,setOpen]=useState(false);
  if(!activeFilterCount(f))return null;
  return <div className="savedsearch"><button className="btn2" onClick={()=>setOpen(true)} aria-haspopup="dialog"><Save size={15}/> Save search</button>
    {open && <Popup title="Save search" onClose={()=>setOpen(false)}>{dismiss=><SearchEditor filters={f} onSaved={()=>dismiss(()=>toast("Search saved. Notifications are off."))}/>}</Popup>}
  </div>;
}

export function SavedSearches() {
  const [items,setItems]=useState<Search[]|null>(null), [loadError,setLoadError]=useState<string|null>(null), [note,setNote]=useState<string|null>(null);
  const [subId,setSubId]=useState<number|null>(null), [retry,setRetry]=useState(0), [pending,setPending]=useState<string|null>(null);
  const [editor,setEditor]=useState<Search|"new"|null>(null);
  useAccountRefresh(()=>setRetry(n=>n+1),editor===null&&pending===null);
  const sending=useRef(false);
  useEffect(()=>{let alive=true;reconcilePushSubscription().then(id=>{if(alive)setSubId(id);}).catch(error=>{if(alive)setNote(requestMessage(error));});return()=>{alive=false;};},[]);
  const readController=useRef<AbortController|null>(null);
  useEffect(()=>{
    const controller=new AbortController();readController.current=controller;setLoadError(null);
    requestJSON<{items:Search[]}>(`/v1/searches${subId?`?subId=${subId}`:""}`,{signal:controller.signal},validList)
      .then(d=>{if(!controller.signal.aborted)setItems(d.items);}).catch(error=>{if(!controller.signal.aborted)setLoadError(requestMessage(error));});
    return()=>controller.abort();
  },[subId,retry]);
  const mutate=async(key:string,run:()=>Promise<unknown>)=>{
    if(sending.current)return; sending.current=true;setPending(key);setNote(null);
    readController.current?.abort();
    try{await run();}catch(error){setNote(requestMessage(error));}finally{sending.current=false;setPending(null);setRetry(n=>n+1);}
  };
  return <div className="sgroup">
    <div className="shead"><Save size={14}/> Saved searches</div>
    {loadError && <RequestError message={loadError} retry={()=>setRetry(n=>n+1)}/>}
    {!items && !loadError && <div className="skel" style={{height:110}} aria-label="Loading saved searches"/>}
    {items?.filter(s=>!s.standing).length===0 && <p className="snote">Save a search from the feed, or add filters here.</p>}
    <div className="scard">
      {items?.filter(s=>!s.standing).map(s=><div className="saved-query" key={s.id}>
        <b>{s.label}</b><p>{summary(s)}</p>
        {s.needsReview && <p className="mutation-error">Review the stored filters before using this search. Notifications are paused.</p>}
        <div className="saved-query-actions">
          {s.openUrl && <button className="btn3" onClick={()=>pushRoute(s.openUrl!)}>Open search</button>}
          <button className="btn3" disabled={!!pending} onClick={()=>setEditor(s)}>{s.needsReview?"Review filters":"Edit filters"}</button>
          <button className="btn3" disabled={!!pending} onClick={()=>void mutate(`delete-${s.id}`,async()=>{
            await requestJSON(`/v1/searches/${s.id}`,{method:"DELETE"},d=>d?.deleted===1);
            setItems(old=>old?.filter(i=>i.id!==s.id)??[]);toast("Search removed");
          })}>{pending===`delete-${s.id}`?"Removing…":"Remove"}</button>
        </div>
        {!s.needsReview && <label className="srow"><span className="stext"><b>Notifications</b><span>{s.notifications?"On for this search":"Off; your search stays saved"}</span></span>
          <input type="checkbox" className="switch" checked={s.notifications} disabled={!!pending} onChange={e=>{const on=e.target.checked;void mutate(`notify-${s.id}`,async()=>{
            const id=on?await enableDevice():null;
            const updated=await requestJSON<Search>(`/v1/searches/${s.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({subId:id})},d=>Number.isInteger(d?.id));
            setItems(old=>old?.map(i=>i.id===s.id?updated:i)??[]);if(id)setSubId(id);
          });}}/></label>}
      </div>)}
    </div>
    <button className="btn2" onClick={()=>setEditor("new")}><Save size={15}/> Add search</button>
    <div className="shead space-top"><Bell size={14}/> This device</div>
    <div className="scard">
      {<div className="srow static"><span className="stext"><b>Deal notifications</b><span>Enable delivery for new Buy it and Verify first listings.</span></span><button className="btn3" disabled={!!pending} onClick={()=>void mutate('enable',async()=>{setSubId(await enableDevice());setRetry(n=>n+1);})}>{pending==='enable'?"Enabling…":subId?"Reconnect":"Enable"}</button></div>}
      {items?.filter(s=>s.standing && s.sub_id===subId).map(s=><label className="srow" key={s.id}><span className="stext"><b>Include Verify first</b><span>Buy it notifications are enabled on this device.</span></span><input type="checkbox" className="switch" checked={(s.calls??"").includes("VERIFY")} disabled={!!pending} onChange={e=>{const verify=e.target.checked;void mutate('standing',async()=>{
        const d=await requestJSON<{calls:string[]}>(`/v1/searches/standing?subId=${subId}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({verify})},d=>Array.isArray(d?.calls));
        setItems(old=>old?.map(i=>i.id===s.id?{...i,calls:d.calls.join(',')}:i)??[]);
      });}}/></label>)}
      {subId && <button className="srow" disabled={!!pending} onClick={()=>void mutate('test',async()=>{const d=await requestJSON<{sent:boolean}>(`/v1/push/test?subId=${subId}`,{method:"POST"});if(!d.sent)throw new Error("The notification was not delivered. Try enabling this device again.");toast("Test notification sent");})}><span className="stext"><b>{pending==='test'?"Sending…":"Send a test notification"}</b></span></button>}
    </div>
    {pending && <p role="status" className="snote">Saving…</p>}
    {note && <p role="alert" className="mutation-error">{note}</p>}
    {editor && <Popup title={editor==='new'?"Add search":"Edit search filters"} onClose={()=>setEditor(null)}>{dismiss=><SearchEditor initial={editor==='new'?undefined:editor} onSaved={()=>dismiss(()=>{setRetry(n=>n+1);toast("Search filters saved");})}/>}</Popup>}
  </div>;
}
