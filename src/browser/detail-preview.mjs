/** Synthetic detail scenarios. No database, engine, login or external API. */
import {pathToFileURL} from 'node:url';
import {startPreview, detail} from './frontend-preview.mjs';

export function detailFixture(id=101) {
  const d=detail(101);
  d.listing.photoUrls=['/preview-assets/0','/preview-assets/3','/preview-assets/1'];
  d.listing.url=`https://example.test/listings/${id}`;
  d.verdict.headline='Priced below comparable sales';
  d.verdict.reasoning='There is room for your target profit at the asking price. Confirm the configuration and test it under load before buying.';
  d.meta.match={model:'Gaming desktop · RTX 3070 / Ryzen 7',brand:'NZXT',confidence:'high',method:'fixture'};
  d.meta.daysOnMarket=3;
  d.meta.description='NZXT gaming PC. RTX 3070, Ryzen 7. Available to test at pickup in Newton.\n\nCash only. No trades. Message me with a pickup time.';
  d.verdict.riskChecks=[{code:'TEST_AT_PICKUP',label:'Stability under load',state:'unresolved',question:'Run a benchmark and check temperatures.',remote:false}];
  if(id===102) {
    d.listing={...d.listing,title:'Memory bundle with mixed specifications',askingPriceCents:null,photoUrls:[],location:null,postedAt:null};
    d.verdict={call:'INSUFFICIENT_DATA',confidence:'low',headline:'Exact kit and asking price are missing',reasoning:'Matching sold prices need the capacity, generation, speed and kit layout. The listing does not supply enough detail.',valuation:{medianCents:null,lowCents:null,highCents:null,compCount:0,confidence:'low'},questions:['What is the exact part number and price for each kit?'],channels:[],decidingUnknown:'Confirm the exact part number and kit layout.'};
    d.meta={category:'ram',missingValueFields:['asking price','memory kit layout','capacity and speed'],description:'Mixed memory available. Please ask for details.'};
    d.comps=[]; d.signals=[];
  }
  if(id===103) {
    d.listing={...d.listing,title:'iPhone 15 Pro · 256GB · activation lock disclosed',askingPriceCents:30000,photoUrls:['/preview-assets/2']};
    d.verdict={...d.verdict,call:'RISK',headline:'Activation lock prevents normal use',reasoning:'The seller explicitly states that the phone is locked. The price estimate does not remove that defect.',riskChecks:[{code:'ACTIVATION_LOCK',label:'Activation Lock',state:'failed',evidence:'Seller says: “Still linked to the previous owner’s Apple account.”',question:'Can the owner remove Activation Lock in person?',remote:true}],questions:['Can the original owner remove Activation Lock before payment?']};
    d.meta.match={model:'iPhone 15 Pro 256GB',brand:'Apple',confidence:'high',method:'fixture'};
    d.meta.category='phone';
    d.meta.description='iPhone 15 Pro. Still linked to the previous owner’s Apple account. Deposit requested before viewing.';
    d.comps=d.comps.map(c=>({...c,raw_title:'Synthetic iPhone 15 Pro 256GB sold example'}));
    d.signals=[{code:'PAYMENT_BEFORE_PICKUP',severity:'high',polarity:'negative',evidence:'Seller asks for a deposit before showing the phone.'}];
  }
  if(id===104) {
    d.listing={...d.listing,title:'RAM and cooling inventory · multiple quantities and prices',askingPriceCents:100};
    d.verdict={call:'INSUFFICIENT_DATA',confidence:'low',headline:'Individual offers need matching sold prices',reasoning:'The $1 headline is a placeholder. Each offer below keeps the seller’s quantity, price basis and exact wording.',questions:['Which items are still available?'],valuation:{medianCents:null,lowCents:null,highCents:null,compCount:0,confidence:'low'},inventory:{sellerContext:'Multiple parts; prices vary with quantity.',offers:Array.from({length:14},(_,i)=>({item:i===0?'DDR3 2GB modules':i===1?'DDR3 8GB modules with quantity discount':'Watercooling fitting · G1/4 compression',quantity:i===0?7:i===1?30:4,askingPriceCents:i===0?1750:i===1?null:50,priceBasis:i===0?'bundle':i===1?'ambiguous':'each',valuation:null,valuationNote:'No exact matching sold comps are available.',evidence:i===0?'7 x 2GB sticks, $17.50 for all seven.':i===1?'8GB sticks $15 each, $10 each if you buy 10 or more.':'Four fittings. $0.50 each.'}))}};
    d.comps=[]; d.meta={category:'ram',description:'Mixed inventory. See quantities and prices for each offer.'}; d.signals=[];
  }
  if(id===105) {
    d.listing.title='Gigabyte AORUS GeForce RTX 4090 24GB GDDR6X graphics card with original box and a very long seller title listing every accessory and condition detail';
    d.listing.askingPriceCents=175050;
    d.meta.description='Original seller wording with a long unbroken part number: '+ 'EXACT-PART-'.repeat(35);
    d.verdict.reasoning+=' '+ 'Additional written evidence retained in full. '.repeat(8);
  }
  if(id===106) { d.verdict.overriddenFrom='VERIFY'; d.verdict.call='FAIR'; }
  d.checkId=id;
  return d;
}
export function startDetailPreview(port=3197) {
  return startPreview(port,async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1'), match=url.pathname.match(/^\/v1\/checks\/(\d+)$/);
    if(match && req.method==='GET') { res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(detailFixture(Number(match[1]))));return true; }
    return false;
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  await startDetailPreview();console.log('Synthetic listing detail: http://127.0.0.1:3197/c/101 (102 unknown, 103 risk, 104 inventory, 105 long text)');
}
