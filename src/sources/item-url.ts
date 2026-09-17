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
export function sameMarketplaceItem(a:string,b:string):boolean {
  const key=marketplaceItemKey(a);if(!key || key!==marketplaceItemKey(b))return false;
  return new URL(a).hostname.replace(/^www\./,'')===new URL(b).hostname.replace(/^www\./,'');
}
