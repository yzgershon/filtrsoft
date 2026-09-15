import {isUnsupportedPrinter,resolveProductType} from '../signals/product-type.ts';

export const CORE_QUERIES=['graphics card','gaming pc','gaming laptop','macbook','iphone'] as const;
// The two core searches retain their original cadence. One extra, rotating
// search finds parts that those five queries never deliberately looked for.
export const PART_QUERIES=['ddr5 ram','ryzen processor','nvme ssd','computer motherboard','ddr4 ram','pc power supply','intel core processor','pc case','computer monitor','ipad','samsung galaxy','google pixel'] as const;
export const CORE_QUERIES_PER_CYCLE=2;

export function collectionQuery(source:string,cursor:number,round:number):string {
  if(round>=CORE_QUERIES_PER_CYCLE)return PART_QUERIES[(Math.floor(cursor/CORE_QUERIES_PER_CYCLE)+round-CORE_QUERIES_PER_CYCLE)%PART_QUERIES.length];
  const index=cursor+round,query=CORE_QUERIES[index%CORE_QUERIES.length];
  // Facebook's "graphics card" search visibly returned sports/gift cards.
  // Product families remove the ambiguous word while alternating both makers.
  if(source==='facebook'&&query==='graphics card')return Math.floor(index/CORE_QUERIES.length)%2?'amd radeon':'nvidia geforce';
  return query;
}

export type SearchArea='computers'|'parts'|'phones'|'electronics';
export function searchArea(query:string):SearchArea {
  if(/\b(iphone|galaxy|pixel|smartphone)\b/i.test(query))return 'phones';
  if(/\b(graphics|geforce|radeon|gpu|ryzen|processor|cpu|ddr[345]|ram|nvme|ssd|motherboard|power supply|pc case)\b/i.test(query))return 'parts';
  if(/\b(pc|computer|laptop|macbook|thinkpad|ipad|monitor)\b/i.test(query))return 'computers';
  return 'electronics';
}

export function hasHardwareCategory(source:string,query:string):boolean {
  if(source==='craigslist')return ['sya','syp','moa'].includes(query);
  const area=searchArea(query);
  return source==='offerup'?area!=='electronics':source==='mercari'&&area==='parts';
}

/** Real filter URLs observed in both sites' own UI on September 15. Never
 * invent a category ID or reuse an eBay category number on another source. */
export function marketplaceSearchUrl(source:'offerup'|'mercari',query:string,opts:{lat?:number;lon?:number;radiusMiles?:number}={}) {
  const area=searchArea(query);
  if(source==='offerup') {
    const p=new URLSearchParams({q:query,radius:String(opts.radiusMiles??30),lat:String(opts.lat??42.337),lon:String(opts.lon??-71.2092),sort:'-posted',cid:area==='phones'?'1.2':area==='electronics'?'1':'1.6'});
    return `https://offerup.com/search?${p}`;
  }
  const p=new URLSearchParams({keyword:query,sortBy:'2',itemStatuses:'1',categoryIds:area==='parts'?'775':'7'});
  return `https://www.mercari.com/search/?${p}`;
}

export const CRAIGSLIST_SEARCHES=[
  {cat:'sya',label:'computers'},
  {cat:'syp',label:'computer parts'},
  {cat:'moa',label:'cell phones'},
  {cat:'ela',label:'electronics'},
  // PCs are sometimes miscategorized as video gaming. Search for the actual
  // hardware there instead of enumerating every console/game for rejection.
  // Include bare "PC" and supported VR: the live category also contains a
  // seller's "monitor and pc" and Quest headsets, not only "gaming" titles.
  {cat:'vgm',label:'computers and VR',query:'pc|computer|laptop|gpu|cpu|monitor|geforce|radeon|rtx|gtx|ryzen|quest|"vr headset"'},
] as const;
export const craigslistQuery=(cat:string)=>{const search=CRAIGSLIST_SEARCHES.find(s=>s.cat===cat);return search&&'query'in search?search.query:undefined;};

/** Discovery is not valuation. Skip obvious non-devices before detail visits,
 * while retaining real PC bundles, repair listings and exact seller unknowns.
 * No comp, quantity, model-generation or pricing guard is changed here. */
export function discoveryDecision(title:string,hardwareCategory=false):{keep:boolean;reason:string} {
  let product=resolveProductType(title);
  // A real RX 5700 XT "For Parts No Display" was called an accessory because
  // its only product noun was explicitly absent. Keep its raw broken-state
  // evidence intact; this retry only decides whether to fetch the description.
  if(product.kind==='accessory'&&product.head==='display'&&/\bfor (?:parts|repair)\b/i.test(title)&&/\bno display\b/i.test(title))product=resolveProductType(title.replace(/\bno display\b/gi,''));
  if(isUnsupportedPrinter(title))return {keep:false,reason:'printer'};
  if(product.head&&/^(console|playstation|ps[45]|xbox|nintendo switch|steam deck)$/.test(product.head))return {keep:false,reason:'console'};
  // The general model-number heuristic can mistake a Pokemon M1S card for
  // hardware. A named physical device still wins (e.g. a Pokemon-themed PC).
  if(!product.head&&/\b(pok[eé]mon|trading card|sports card|graphic novel|dress|shirt|jewelry|earrings)\b/i.test(title))return {keep:false,reason:'unrelated-model-number'};
  // "3080" and "PowerColor 9070XT Red Devil" are real observed listings.
  // An actual hardware category permits detail discovery of unknown titles;
  // the query alone never establishes the product, specs or asking price.
  if(product.kind==='unknown'&&hardwareCategory)return {keep:true,reason:'hardware-category-needs-details'};
  if(product.kind!=='tech')return {keep:false,reason:product.kind};
  return {keep:true,reason:'tech'};
}
