/** Synthetic listings + the checked-in real benchmark snapshot. No database,
 * network, account mutation, crawl or production login. Node only. */
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {startPreview} from './frontend-preview.mjs';
import {comparisonSide,compareSides} from '../comparison/core.ts';
import {detailFixture} from './detail-preview.mjs';
const data=JSON.parse(await readFile(new URL('../../data/hardware-benchmarks.json',import.meta.url),'utf8'));
const facts=[
  [201,'ASUS TUF RTX 3070 8GB','gpu',25000,'GPU: ASUS TUF RTX 3070 8GB GDDR6','craigslist'],
  [202,'Gigabyte RTX 4070 12GB','gpu',37500,'GPU: Gigabyte RTX 4070 12GB GDDR6X','facebook'],
  [203,'Ryzen 7 5800X','component',15000,'CPU: AMD Ryzen 7 5800X','craigslist'],
  [204,'Ryzen 5 7600X3D','component',20000,'CPU: AMD Ryzen 5 7600X3D','facebook'],
  [205,'Gaming PC · RTX 3070 / Ryzen 7','prebuilt',75000,'CPU: AMD Ryzen 7 5800X; GPU: RTX 3070 8GB GDDR6; RAM: 32GB DDR4-3200 (2x16GB); Storage: 1TB NVMe SSD; PSU: Corsair RM750x 750W','craigslist'],
  [206,'RTX 3060 12GB','gpu',18000,'GPU: RTX 3060 12GB GDDR6','craigslist'],
  [207,'RTX 4070 · conflicting seller specifications','gpu',30000,'GPU: RTX 4070 Ti Super 16GB','facebook'],
  [208,'DDR5 memory kit','ram',8000,'RAM: G.Skill 32GB DDR5-6000 CL30 (2x16GB)','craigslist'],
];
export const comparisonRows=facts.map(([id,title,category,price,description,source],i)=>{
  const at=new Date().toISOString(),proof={facts:{title,description,attributes:{},photoUrls:[`/preview-assets/${i%2?3:0}`]},signals:{category,signals:[]},visionEvidence:null};
  return {id,title,source,url:source==='facebook'?`https://www.facebook.com/marketplace/item/${900000000000+id}/`:`https://boston.craigslist.org/gbs/sop/d/synthetic-preview/${7000000000+id}.html`,asking_price_cents:price,location:'Newton, MA',posted_at:at,last_seen:at,captured_at:at,delisted_at:null,assessed_at:at,payload:JSON.stringify({provenance:proof,call:'VERIFY',valuation:{medianCents:price+5000},questions:['Can I test the part under load before paying?','Any repairs, crashes or missing accessories?']})};
});
export function startComparisonPreview(port=3204){return startPreview(port,async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1'),kind=url.searchParams.get('kind')??'gpu';
  const write=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));return true;};
  if(url.pathname==='/v1/compare/candidates'){
    const q=(url.searchParams.get('q')??'').toLowerCase();
    const items=comparisonRows.map(r=>comparisonSide(r,kind,data)).filter(s=>s.hardware.evidence.length&&`${s.title} ${s.hardware.identity}`.toLowerCase().includes(q)).map(s=>({id:s.id,title:s.title,priceCents:s.priceCents,source:s.source,location:s.location,thumb:s.photoUrls[0],photoUrls:s.photoUrls,identity:s.hardware.identity,state:s.hardware.state,call:s.call,wholeSystem:!s.standalone}));
    return write({items,nextCursor:null,kind});
  }
  if(url.pathname==='/v1/compare'){
    const rows=(url.searchParams.get('ids')??'').split(',').map(id=>comparisonRows.find(r=>r.id===Number(id)));
    if(rows.some(r=>!r))return write({error:'Preview listing not found'},404);
    return write(compareSides(rows.map(r=>comparisonSide(r,kind,data)),kind,url.searchParams.get('workload')??'gaming',data));
  }
  const id=Number(url.pathname.match(/^\/v1\/checks\/(\d+)$/)?.[1]),row=comparisonRows.find(r=>r.id===id);
  if(row){const detail=detailFixture(101),s=comparisonSide(row,'gpu',data);detail.checkId=id;detail.listing={...detail.listing,id,title:row.title,url:row.url,source:row.source,askingPriceCents:row.asking_price_cents,photoUrls:s.photoUrls};detail.meta.specifications=s.specs;detail.meta.category=s.category;return write(detail);}
  return false;
});}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){await startComparisonPreview();console.log('Synthetic comparison: http://127.0.0.1:3204/compare?ids=201,202');}
