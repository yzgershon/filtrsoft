import {test} from "bun:test";
import {isolated} from "./isolated.ts";

test("fresh and stored facts preserve source attributes, seller reference and exact photo URLs",()=>isolated(`
  import {db} from '@/src/db/index.ts';
  import {checkFetched,checkStored} from '@/src/engine/index.ts';
  const d=db();globalThis.fetch=async()=>{throw new Error('network forbidden');};
  const raw={source:'craigslist',sourceId:'attributes',url:'https://example.invalid/a',title:'Gaming PC',description:'Local sale',askingPriceCents:60000,location:null,postedAt:null,updatedAt:null,photoUrls:[],attributes:{cpu:'Ryzen 5 7600X3D',gpu:'RTX 4070 Ti Super',cryptocurrency:'ok'},sellerRef:'fixture-seller',raw:{}};
  const fresh=await checkFetched(raw,{persist:true,vision:false});
  const stored=checkStored(fresh.listingId);
  assert.deepEqual(stored.listing.attributes,raw.attributes);assert.equal(stored.listing.sellerRef,raw.sellerRef);
  assert.equal(stored.match.attributes.cpu,fresh.match.attributes.cpu);assert.equal(stored.match.attributes.gpu,'rtx 4070 ti super');
  assert.deepEqual(stored.signals.signals,fresh.signals.signals);
`));

test("text refresh preserves current photo evidence and never calls vision or refetches unchanged hashes",()=>isolated(`
  import {db} from '@/src/db/index.ts';
  import {checkFetched,checkStored} from '@/src/engine/index.ts';
  import {photoFingerprint,syncPhotoUrls} from '@/src/vision/merge.ts';
  import {VISION_MODEL,PROMPT_VERSION} from '@/src/vision/index.ts';
  import {upsertListingFacts} from '@/src/db/listings.ts';
  const d=db(),at=new Date().toISOString();let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('network forbidden');};
  const raw={source:'craigslist',sourceId:'vision',url:'https://example.invalid/v',title:'RTX 4090 graphics card',description:'A real card',askingPriceCents:60000,location:null,postedAt:null,updatedAt:null,photoUrls:['https://example.invalid/current'],attributes:{},raw:{}};
  const id=upsertListingFacts(d,{...raw,photoCount:1}).id;syncPhotoUrls(id,raw.photoUrls);
  d.run("UPDATE listing_photos SET phash='1234567890123456' WHERE listing_id=?",[id]);
  const vision={components:{},facts:[],specScreens:[],displayOutputsVisible:false,physicalDamage:[]};
  d.run('INSERT INTO vision_results(listing_id,model,prompt_version,photo_fingerprint,payload,created_at) VALUES(?,?,?,?,?,?)',[id,VISION_MODEL,PROMPT_VERSION,photoFingerprint(id),JSON.stringify(vision),at]);
  const fresh=await checkFetched(raw,{persist:true,vision:false});
  assert.equal(fresh.verdict.call,'RISK');assert.equal(checkStored(id).verdict.call,'RISK');assert.equal(calls,0);
  assert.deepEqual(checkStored(id).listing.photoUrls,raw.photoUrls);
  syncPhotoUrls(id,['https://example.invalid/changed']);
  assert(!checkStored(id).signals.signals.some(s=>s.code==='NO_DISPLAY_OUTPUT'));
`));

test("stale model/prompt and incomplete photo fingerprints cannot supply current evidence",()=>isolated(`
  import {db} from '@/src/db/index.ts';
  import {loadCurrentVision,photoFingerprint,syncPhotoUrls} from '@/src/vision/merge.ts';
  import {VISION_MODEL,PROMPT_VERSION} from '@/src/vision/index.ts';
  import {upsertListingFacts} from '@/src/db/listings.ts';
  const d=db(),at=new Date().toISOString();
  const id=upsertListingFacts(d,{source:'audit',sourceId:'a',url:'https://example.invalid',title:'GPU',description:'',askingPriceCents:10000,location:null,postedAt:null,photoCount:1}).id;
  syncPhotoUrls(id,['https://example.invalid/a']);d.run("UPDATE listing_photos SET phash='1234567890123456' WHERE listing_id=?",[id]);
  d.run('INSERT INTO vision_results(listing_id,model,prompt_version,photo_fingerprint,payload,created_at) VALUES(?,?,?,?,?,?)',[id,VISION_MODEL,'old',photoFingerprint(id),'{}',at]);
  assert.equal(loadCurrentVision(id,VISION_MODEL,PROMPT_VERSION),null);
  d.run('UPDATE vision_results SET prompt_version=?',[PROMPT_VERSION]);
  syncPhotoUrls(id,['https://example.invalid/a','https://example.invalid/b']);
  assert.equal(loadCurrentVision(id,VISION_MODEL,PROMPT_VERSION),null);d.close();
`));

test("price observation updates the scored ask, ignores stale replay, and survives until re-scored",()=>isolated(`
  import {db} from '@/src/db/index.ts';
  import {observePrice} from '@/src/db/price.ts';
  import {upsertListingFacts} from '@/src/db/listings.ts';
  import {checkStored} from '@/src/engine/index.ts';
  import {reverdictStale} from '@/src/api/scheduler.ts';
  const d=db();
  const id=upsertListingFacts(d,{source:'audit',sourceId:'p',url:'https://example.invalid',title:'Unknown tech',description:'',askingPriceCents:60000,location:null,postedAt:null,photoCount:0},'2026-09-01T01:00:00.000Z').id;
  assert(observePrice(d,id,40000,'2026-09-01T02:00:00.000Z'));
  assert.equal(checkStored(id).listing.askingPriceCents,40000);
  assert.equal(d.query('SELECT last_price_cents n FROM listings WHERE id=?').get(id).n,40000);
  assert(!observePrice(d,id,70000,'2026-09-01T01:30:00.000Z'));
  assert(!observePrice(d,id,0,'2026-09-01T03:00:00.000Z'));
  assert.equal(d.query('SELECT COUNT(*) n FROM listing_prices WHERE listing_id=?').get(id).n,2);
  assert.equal(d.query('SELECT COUNT(*) n FROM listing_rechecks').get().n,1);
  assert.equal(reverdictStale(),1);
  assert.equal(d.query('SELECT COUNT(*) n FROM listing_rechecks').get().n,0);
  assert.equal(checkStored(id).listing.askingPriceCents,40000);d.close();
`));
