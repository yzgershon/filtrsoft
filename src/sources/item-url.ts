/** A matching /item/ route can still belong to a different seller's product. */
export function marketplaceItemKey(value:string):string|null {
  try {
    const u=new URL(value);if(u.protocol!=='https:' || u.username || u.password || u.port)return null;
    const host=u.hostname.replace(/^www\./,'');
    if(host==='facebook.com')return u.pathname.match(/^\/marketplace\/item\/(\d+)\/?$/)?.[1]??null;
    if(host==='offerup.com')return u.pathname.match(/^\/item\/detail\/([a-z0-9-]+)\/?$/i)?.[1]??null;
    if(host==='mercari.com')return u.pathname.match(/^\/us\/item\/(m\d+)\/?$/)?.[1]??null;
  }catch{}
  return null;
}
/** A requested item that lands on the same site's Marketplace, home or search
 * index was redirected away: Facebook sends a removed item to /marketplace/
 * (logged out, to login?next=/marketplace/ rather than the item), OfferUp to
 * its home page. Another item, a login or a challenge page is not evidence. */
export function redirectedToIndex(requested:string,final:string):boolean {
  if(!marketplaceItemKey(requested)||marketplaceItemKey(final))return false;
  try {
    const a=new URL(requested),b=new URL(final),host=(u:URL)=>u.hostname.replace(/^www\./,'');
    if(b.protocol!=='https:'||host(a)!==host(b))return false;
    const path=b.pathname.replace(/\/+$/,'')||'/';
    if(host(b)==='facebook.com')return /^\/marketplace(?:\/[a-z0-9-]+)?(?:\/category\/[a-z0-9-]+)?$/i.test(path)
      && !/^\/marketplace\/(?:you|inbox|create|notifications|saved|profile)\b/i.test(path);
    return path==='/'||/^\/(?:search|home)$/i.test(path)||(host(b)==='mercari.com'&&/^\/us(?:\/search)?$/i.test(path));
  }catch{return false;}
}
export function sameMarketplaceItem(a:string,b:string):boolean {
  const key=marketplaceItemKey(a);if(!key || key!==marketplaceItemKey(b))return false;
  return new URL(a).hostname.replace(/^www\./,'')===new URL(b).hostname.replace(/^www\./,'');
}
