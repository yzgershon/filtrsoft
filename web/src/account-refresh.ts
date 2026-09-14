import {useEffect,useRef} from 'react';
/** Account-owned records already live on the server. Refresh read-only screens
 * on return/while visible, without remounting or overwriting an editor draft. */
export function useAccountRefresh(refresh:(signal:AbortSignal)=>void,enabled=true){
  const current=useRef(refresh);current.current=refresh;
  useEffect(()=>{
    if(!enabled)return;
    let controller:AbortController|null=null;
    const run=()=>{if(document.visibilityState==='visible'){controller?.abort();controller=new AbortController();current.current(controller.signal);}};
    const timer=setInterval(run,15000);
    window.addEventListener('focus',run);window.addEventListener('online',run);document.addEventListener('visibilitychange',run);
    return()=>{controller?.abort();clearInterval(timer);window.removeEventListener('focus',run);window.removeEventListener('online',run);document.removeEventListener('visibilitychange',run);};
  },[enabled]);
}
