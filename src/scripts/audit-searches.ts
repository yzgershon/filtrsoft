/** Bounded discovery audit. Opens search pages only; never opens a database,
 * visits seller details, persists listings, runs vision or uploads results.
 * Stop the installed collector first: the same machine/profile leases apply.
 * bun run src/scripts/audit-searches.ts --source mercari --query "graphics card"
 * Add --baseline to compare the former unfiltered search on the same parser.
 */
import {runMarketWorker,parseCards,type Marketplace} from '../sources/marketplace.ts';
import {runWorker,searchUrl,parseCard} from '../sources/facebook.ts';
import {fetchSearchResults} from '../sources/craigslist.ts';
import {marketplaceSearchUrl,discoveryDecision,craigslistQuery,hasHardwareCategory} from '../crawler/search-policy.ts';
import {claimRunner} from '../agent/state.ts';

const arg=(key:string)=>{const i=process.argv.indexOf('--'+key);return i<0?undefined:process.argv[i+1];};
const source=arg('source'),query=arg('query')??'graphics card',baseline=process.argv.includes('--baseline');
if(!source||!['craigslist','facebook','offerup','mercari'].includes(source))throw new Error('Choose --source craigslist, facebook, offerup or mercari');
const release=claimRunner();
const started=Date.now();
const rows:Array<{title:string;sourceId:string}>=[];
let links=0,errors=0,blocked=false;
try {
  if(source==='craigslist') {
    const cat=arg('cat')??'vgm';
    rows.push(...await fetchSearchResults(cat,0,baseline?undefined:craigslistQuery(cat)));links=rows.length;
  } else if(source==='facebook') {
    for await(const event of runWorker('crawl',{searchUrl:searchUrl({query,location:'boston'}),scrolls:2,headless:false,detailUrls:[]})) {
      if(event.type==='error'){errors++;console.error(event.msg);}
      if(event.type==='cards'){links+=event.cards.length;for(const raw of event.cards){const card=parseCard(raw);if(card)rows.push(card);}}
    }
  } else {
    const url=new URL(marketplaceSearchUrl(source as Marketplace,query));
    if(baseline){url.searchParams.delete('cid');url.searchParams.delete('categoryIds');}
    for await(const event of runMarketWorker(source as Marketplace,{searches:[{query,url:url.href}],headless:false,scrolls:3})) {
      if(event.type==='error'){errors++;console.error(event.msg);}
      if(event.type==='cards'){links+=event.links.length;blocked ||=!!event.blocked;rows.push(...parseCards(source as Marketplace,event.links));}
    }
  }
  const unique=[...new Map(rows.map(row=>[row.sourceId,row])).values()];
  const category=source==='craigslist'?(arg('cat')??'vgm'):query;
  const decisions=unique.map(row=>({...row,...discoveryDecision(row.title,hasHardwareCategory(source,category)&&(source==='craigslist'||!baseline))}));
  console.log(JSON.stringify({at:new Date().toISOString(),source,query,category:arg('cat'),baseline,ms:Date.now()-started,links,parsed:unique.length,eligible:decisions.filter(row=>row.keep).length,rejected:decisions.filter(row=>!row.keep).length,blocked,errors,rows:decisions},null,2));
  if(errors||blocked||!links)process.exitCode=1;
} finally {release();}
