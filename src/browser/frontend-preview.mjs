/** Local synthetic frontend only. Does not import the API, open SQLite, log in,
 * crawl, or send a request to production. Start with Node after building web. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname, sep } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const photos = ['cl-nzxt-specs-in-pics-750/a.jpg','cl-latitude7420-295/p1.jpg','cl-iphone15-250-cambridge/a.jpg','cl-gaming-pc-650/00J0J_15C3WlVk7Fk.jpg','cl-zflip6-350/p1.jpg'];
const titles = ['NZXT gaming desktop · RTX 3070 / Ryzen 7','Dell Latitude 7420 · 16GB / 512GB','iPhone 15 · 128GB · unlocked','Custom gaming PC · ready to test','Samsung Galaxy Z Flip6 · 256GB'];
const providers = {password:true,google:false,googleClientId:null,apple:false,appleClientId:null};
const calls = ['BUY','VERIFY','FAIR','PASS','BUY','VERIFY','FAIR','PASS','VERIFY','FAIR','RISK'];
const reviewed = new Map();
export const items = Array.from({length:420},(_,k)=>({id:101+k,title:titles[k%5]+(k>=11?` · Example ${k+1}`:''),url:`https://example.test/listings/${101+k}`,source:k%3?'craigslist':'facebook',category:['prebuilt','laptop','phone','prebuilt','phone'][k%5],askingPriceCents:[75000,29500,35000,65000,40000][k%5]+Math.floor(k/11)*100,location:['Newton, MA','Cambridge, MA','Somerville, MA','Boston, MA'][k%4],postedAt:new Date(Date.now()-(k+1)*3600000).toISOString(),thumb:`/preview-assets/${k%5}`,call:calls[k%11],headline:k%11===0?'Room for a return, with comparable sales behind it.':'Read the evidence before arranging pickup.',netProfitCents:k%11===0?16500:k%11===1?6500:0,overriddenFrom:null,gone:false,currentPriceCents:null,priceDropCents:null,priceWasCents:null}));

export function detail(id) {
  const item=items.find(x=>x.id===id)??items[0], ask=item.askingPriceCents;
  const channel={channel:'facebook',grossCents:ask+18500,feesCents:0,shippingCents:0,netCents:ask+16500,available:true};
  return {checkId:id,decisionToken:'synthetic-preview-token',listing:{...item,photoUrls:[item.thumb,item.thumb]},
    verdict:{call:reviewed.get(id)??item.call,overriddenFrom:reviewed.has(id)?item.call:null,confidence:'high',headline:item.headline,reasoning:'The matching sold listings support the estimate. Ask to see it running before you arrange pickup. These are synthetic numbers for the local design preview.',questions:['Can I see it running a benchmark before pickup?','Are all the ports working, and is anything missing?'],valuation:{medianCents:ask+18500,lowCents:ask+10000,highCents:ask+25000,compCount:8,confidence:'high'},requiredProfitCents:10000,targetOfferCents:ask,netProfitCents:16500,bestChannel:channel,channels:[channel,{...channel,channel:'ebay',feesCents:9000,shippingCents:2500,netCents:ask+7000}],riskChecks:[{code:'TEST_AT_PICKUP',label:'Test at pickup',state:'inPerson',question:'Run a benchmark and check temperatures.',remote:false,evidence:'Seller offers testing.'}]},
    signals:[{code:'TESTING_AVAILABLE',severity:'low',polarity:'positive',evidence:'Seller says testing is available at pickup.'}],comps:[10000,18500,25000].map(v=>({raw_title:item.title,total:ask+v,condition_norm:'used',sold_at:new Date().toISOString(),url:null})),meta:{category:item.category,description:'Synthetic listing for frontend preview.',match:{brand:'Example',model:item.title,confidence:'high',method:'fixture'},missingValueFields:[]}};
}

export function startPreview(port=3188) {
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1'), path=url.pathname, q=url.searchParams;
    const scenario=req.headers['x-preview-scenario']??(req.headers.referer?.includes('preview=landing')?'landing':'normal');
    const json=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
    if(path==='/v1/auth/me')return json({user:scenario==='landing'?null:{id:1,name:'Design preview',email:'preview@example.test',avatarUrl:null,createdAt:new Date().toISOString()},providers});
    if(path==='/v1/pulse')return json({now:new Date().toISOString(),cursor:'preview',items:[],hasMore:false});
    if(path==='/v1/landing'||path==='/v1/health')return json({comps:32000,skus:560,listings:1200});
    if(path==='/v1/billing/status')return json({enabled:false,plan:'free',active:false,owner:false,until:null});
    if(path==='/v1/jobs/latest')return json({job:null,configured:true,agentOnline:false,agentSeenAt:null});
    if(path==='/v1/push/vapid')return json({configured:false,publicKey:null});
    if(path==='/v1/searches'||path==='/v1/purchases')return json({items:[],summary:null});
    if(path==='/v1/watchlist')return json({items:items.slice(0,3),summary:{dropped:0,gone:0},missing:[]});
    if(path==='/v1/feed'){
      let list=items.slice(0,scenario==='large'?420:11);
      const quality=q.get('quality')??'review';
      const source=q.get('source'),category=q.get('category'),search=q.get('q')?.toLowerCase(),max=Number(q.get('maxPrice'));
      list=list.filter(x=>(!source||x.source===source)&&(!category||x.category===category)&&(!search||x.title.toLowerCase().includes(search))&&(!max||x.askingPriceCents<=max));
      const segments={review:Math.min(10,list.filter(x=>x.call!=='RISK'&&!reviewed.has(x.id)).length),ready:list.filter(x=>x.call==='BUY').length,verify:list.filter(x=>x.call==='VERIFY').length,risky:list.filter(x=>x.call==='RISK').length,all:list.length};
      if(quality==='review')list=list.filter(x=>x.call!=='RISK'&&!reviewed.has(x.id)).slice(0,10);
      else if(quality!=='all')list=list.filter(x=>x.call===({ready:'BUY',verify:'VERIFY',risky:'RISK'}[quality]??x.call));
      if(q.get('sort')==='price')list.sort((a,b)=>a.askingPriceCents-b.askingPriceCents);
      else if(q.get('sort')==='newest')list.sort((a,b)=>b.id-a.id);
      else list.sort((a,b)=>calls.indexOf(a.call)-calls.indexOf(b.call));
      const offset=Number(q.get('cursor')||q.get('offset')||0),limit=Math.min(200,Number(q.get('limit')||60)),end=offset+limit;
      return json({items:list.slice(offset,end),total:list.length,nextCursor:end<list.length?String(end):null,segments,segmentsNew:{},facets:{category:{prebuilt:4,laptop:2,phone:5},source:{craigslist:7,facebook:4}},serverNow:new Date().toISOString(),lastCrawl:{started_at:new Date().toISOString()},freshCount:2,crawlEveryMs:180000});
    }
    const match=path.match(/^\/v1\/checks\/(\d+)(\/override)?$/);
    if(match){const id=Number(match[1]);if(match[2]){if(req.method==='DELETE')reviewed.delete(id);else{let body='';for await(const chunk of req)body+=chunk;reviewed.set(id,JSON.parse(body).call);}return json({ok:true});}return json(detail(id));}
    if(path.startsWith('/v1/'))return json({error:'Unmocked preview endpoint'},404);
    try{
      let file;
      if(path.startsWith('/preview-assets/'))file=resolve(root,'docs/testset',photos[Number(path.split('/').pop())]??photos[0]);
      else{const dist=resolve(root,'web/dist');file=resolve(dist,'.'+path);if(!file.startsWith(dist+sep)&&file!==dist)return json({error:'Invalid path'},400);if(!extname(file))file=resolve(dist,'index.html');}
      const data=await readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html','.css':'text/css','.js':'text/javascript','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream','cache-control':'no-store'});res.end(data);
    }catch{res.writeHead(404);res.end('Preview file not found');}
  });
  return new Promise(resolveReady=>server.listen(port,'127.0.0.1',()=>resolveReady(server)));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){await startPreview();process.stdout.write('Synthetic frontend preview: http://127.0.0.1:3188\nLanding: http://127.0.0.1:3188/?preview=landing\n');}
