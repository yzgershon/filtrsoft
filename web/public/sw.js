/** Public resources may work offline. Account and listing API responses never
 * enter CacheStorage: their ownership/freshness cannot be inferred offline. */
const VERSION = "filtrsoft-v2";
const SHELL = `${VERSION}-shell`, IMGS = `${VERSION}-img`;
const MAX_IMGS = 160;
let shellRevision = 0;
function validAsset(url,response) {
  if(!response?.ok)return false;
  const path=new URL(url,self.location.origin).pathname,type=response.headers.get('content-type')??'';
  if(/\.m?js$/.test(path))return /(?:javascript|ecmascript)/i.test(type);
  if(/\.css$/.test(path))return /text\/css/i.test(type);
  return !/text\/html/i.test(type);
}
async function cached(name,key) {try{return await (await caches.open(name)).match(key);}catch{return undefined;}}
async function cachePublic(name,key,response) {try{await (await caches.open(name)).put(key,response);}catch{/* Storage pressure must not break a working online response. */}}
const offlineJSON = () => new Response(JSON.stringify({error:"offline",offline:true}),{
  status:503,headers:{"content-type":"application/json","cache-control":"no-store"},
});
const offlineDocument = () => new Response(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · Filtrsoft</title><body style="background:#0d1017;color:#edf1f9;font:16px system-ui;padding:32px"><h1 style="font-size:22px">Connection unavailable</h1><p>Reconnect to open Filtrsoft. Account and listing data are not available offline.</p><a style="color:#aac0ff;display:inline-block;padding:14px 0" href="/">Try again</a></body></html>`,{status:503,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});

/** Commit HTML only after its entry assets are available. The first visit can
 * load assets before worker registration; caching just index.html left a blank
 * offline launch. A later online navigation refreshes the coherent snapshot. */
async function snapshot(response) {
  const revision=++shellRevision;
  if(!response.ok || !response.headers.get("content-type")?.includes("text/html"))return;
  const html=await response.clone().text();
  const urls=[...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)]
    .map(match=>new URL(match[1],self.location.origin))
    .filter(url=>url.origin===self.location.origin && url.pathname.startsWith('/assets/'));
  if(!urls.some(url=>/\.m?js$/.test(url.pathname)))return;
  const cache=await caches.open(SHELL);
  await Promise.all([...new Set(urls.map(url=>url.href))].map(async url=>{
    if(validAsset(url,await cache.match(url)))return;
    const asset=await fetch(url,{cache:'no-store'});if(!validAsset(url,asset))throw new Error('Incomplete app shell');
    await cache.put(url,asset);
  }));
  if(revision===shellRevision)await cache.put('/index.html',response);
}
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    try{await snapshot(await fetch('/index.html',{cache:'no-store'}));}catch{/* Activate the privacy fix even if shell prefetch fails. */}
    await Promise.allSettled(['/manifest.webmanifest','/icon-192.png','/icon-512.png'].map(async url=>{const r=await fetch(url);if(validAsset(url,r))await cachePublic(SHELL,url,r);}));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    try{const keys=await caches.keys();
      await Promise.all(keys.filter(key=>key.startsWith('filtrsoft-') && key!==SHELL && key!==IMGS).map(key=>caches.delete(key)));
    }catch{/* Old caches are never read by this worker even if storage is unavailable. */}
    await self.clients.claim();
  })());
});
async function trimImages(){const cache=await caches.open(IMGS);const keys=await cache.keys();await Promise.all(keys.slice(0,Math.max(0,keys.length-MAX_IMGS)).map(key=>cache.delete(key)));}
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  // Before the GET guard: writes receive a structured offline error too, and
  // are never retried automatically or acknowledged before reaching the API.
  if(url.origin===self.location.origin && url.pathname.startsWith('/v1/')){
    event.respondWith(fetch(request,{cache:'no-store'}).catch(offlineJSON));return;
  }
  if(request.method!=='GET')return;
  if(request.mode==='navigate'){
    const network=fetch(request,{cache:'no-store'});
    event.waitUntil(network.then(response=>snapshot(response.clone())).catch(()=>{}));
    event.respondWith(network.catch(async()=>await cached(SHELL,'/index.html') ?? offlineDocument()));return;
  }
  if(request.destination==='image'){
    event.respondWith((async()=>{
      const hit=await cached(IMGS,request);if(hit)return hit;
      try{const response=await fetch(request);if(response.ok||response.type==='opaque'){await cachePublic(IMGS,request,response.clone());await trimImages().catch(()=>{});}return response;}
      catch{return Response.error();}
    })());return;
  }
  // Only public immutable app resources are cache-first. Never match an old
  // response from an unrelated cache by using global caches.match().
  if(url.origin===self.location.origin && (url.pathname.startsWith('/assets/') || ['/manifest.webmanifest','/icon-192.png','/icon-512.png'].includes(url.pathname))){
    event.respondWith((async()=>{
      const hit=await cached(SHELL,request);if(validAsset(url,hit))return hit;
      const response=await fetch(request);if(validAsset(url,response))await cachePublic(SHELL,request,response.clone());return response;
    })());
  }
});

/**
 * ---- PUSH ----------------------------------------------------------------
 *
 * A push with no `showNotification` call is a PERMISSION VIOLATION on Chrome:
 * the browser requires a user-visible notification for every push it delivers,
 * and repeatedly failing to show one gets the subscription revoked. So the
 * handler always shows something, even when the payload is unreadable.
 */
self.addEventListener("push", (e) => {
  let d = { title: "Filtrsoft", body: "A saved search matched.", url: "/" };
  try { if (e.data) d = { ...d, ...e.data.json() }; } catch { /* keep defaults */ }
  e.waitUntil(
    self.registration.showNotification(d.title, {
      body: d.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Same tag replaces rather than stacks, so ten matches while the phone is
      // in a pocket do not become ten separate lock-screen rows.
      tag: d.url,
      data: { url: d.url },
    }),
  );
});

/**
 * Focus an EXISTING tab when one is open rather than opening another.
 *
 * Without this every notification tap spawns a new window, and after a few
 * alerts the app is running in five copies with five service-worker clients.
 */
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        if ("navigate" in c) { try { await c.navigate(url); } catch { /* focus is enough */ } }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
