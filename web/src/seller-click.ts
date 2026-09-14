import type {MouseEvent} from 'react';

/** Keep the real anchor gesture intact, including keyboard and middle-click.
 * Failed tracking must never prevent someone from opening the seller's ad. */
export function sellerClick(id:number|null|undefined,event:MouseEvent<HTMLAnchorElement>) {
  if(!id || event.defaultPrevented || (event.type==='auxclick'&&event.button!==1))return;
  void fetch(`/v1/checks/${id}/seller-click`,{method:'POST',credentials:'same-origin',keepalive:true}).catch(()=>{});
}
