import {useState} from 'react';
import {requestJSON,requestMessage} from './api-client.ts';
import {toast} from './lib.tsx';
import {Trash} from './icons.tsx';
type Removed={id:number;title:string;created_at:string};
type Page={items:Removed[];nextOffset:number|null};
export function RemovedListings() {
  const [items,setItems]=useState<Removed[]|null>(null),[next,setNext]=useState<number|null>(null);
  const [loading,setLoading]=useState(false),[restoring,setRestoring]=useState<number|null>(null),[error,setError]=useState('');
  const load=async(offset=0)=>{setLoading(true);setError('');try{
    const data=await requestJSON<Page>(`/v1/dismissals?offset=${offset}`);
    setItems(old=>offset?[...(old??[]),...data.items]:data.items);setNext(data.nextOffset);
  }catch(e){setError(requestMessage(e));}finally{setLoading(false);}};
  const restore=async(id:number)=>{setRestoring(id);setError('');try{
    await requestJSON(`/v1/checks/${id}/dismiss`,{method:'DELETE'});
    // Reload from the start after deletion so offset pagination cannot skip a row.
    await load();toast('Listing restored');
  }catch(e){setError(requestMessage(e));}finally{setRestoring(null);}};
  return <details className="sgroup removed-listings" id="removed-listings" onToggle={e=>{if(e.currentTarget.open&&items===null&&!loading)void load();}}>
    <summary className="shead"><Trash size={14}/> Removed listings <span>Restore</span></summary>
    <div className="scard"><p className="snote">Listings you've hidden from your feed. Restoring keeps their existing review and saved status.</p>
      {loading&&<p className="snote" role="status">Loading removed listings…</p>}
      {items?.length===0&&!loading&&<p className="snote">No removed listings.</p>}
      {items?.map(item=><div className="removed-row" key={item.id}><a href={`/c/${item.id}`}>{item.title}</a><button className="btn2" disabled={restoring!==null||loading} onClick={()=>void restore(item.id)}>{restoring===item.id?'Restoring…':'Restore'}</button></div>)}
      {error&&<div className="snote" role="alert">{error}<button className="btn2" disabled={loading} onClick={()=>void load()}>Retry</button></div>}
      {next!==null&&<button className="show-sales" disabled={loading||restoring!==null} onClick={()=>void load(next)}>Load more</button>}
    </div>
  </details>;
}
