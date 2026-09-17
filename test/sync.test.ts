import { test } from "bun:test";
import { isolated } from "./isolated.ts";
const setup=`
import {db} from '@/src/db/index.ts';
import {upsertListingFacts} from '@/src/db/listings.ts';
import {captureChanges,pendingBatch,acknowledge,contentHash,snapshotSchema} from '@/src/sync/outbox.ts';
import {receiveChanges} from '@/src/sync/receive.ts';
const d=db(),target='https://example.invalid';
const base={source:'facebook',sourceId:'one',url:'https://facebook.com/marketplace/item/one',title:'GPU',description:'Detailed model evidence',askingPriceCents:50000,location:null,postedAt:null,photoCount:0,raw:{attributes:{condition:'used'}}};
const at='2026-09-01T00:00:00.000Z';
const id=upsertListingFacts(d,base,at).id;
`;
test('outbox includes old null-date and retired rows and survives missing or wrong acknowledgements',()=>isolated(setup+`
  assert.equal(captureChanges(d,target,'facebook'),1);
  const first=pendingBatch(d,target,'facebook');
  assert.equal(acknowledge(d,target,first,[]),0);
  assert.equal(acknowledge(d,target,first,[{sequence:first.changes[0].sequence,hash:'wrong',status:'applied'}]),0);
  d.run("UPDATE listings SET delisted_at=?,delist_reason='gone' WHERE id=?",['2026-09-02T00:00:00.000Z',id]);
  assert.equal(captureChanges(d,target,'facebook'),1);
  assert.equal(captureChanges(d,target,'facebook'),0);
  assert.equal(pendingBatch(d,target,'facebook').changes.length,2);
  const result=receiveChanges(first); // Simulate a lost HTTP response, then retry.
  assert.equal(receiveChanges(first).acks[0].status,'duplicate');
  assert.equal(acknowledge(d,target,first,result.acks),1);
  const second=pendingBatch(d,target,'facebook');
  assert.ok(second.changes[0].listing.retiredAt);
  assert.equal(acknowledge(d,'https://staging.invalid',second,receiveChanges(second).acks),0);
  assert.equal(acknowledge(d,target,second,receiveChanges(second).acks),1);
  assert.equal(pendingBatch(d,target,'facebook').changes.length,0);
  assert.equal(d.query('SELECT COUNT(*) n FROM listing_rechecks').get().n,1);
`));
test('out-of-order sync and a stale observation cannot resurrect or overwrite newer facts',()=>isolated(setup+`
  captureChanges(d,target,'facebook');const first=pendingBatch(d,target,'facebook');
  upsertListingFacts(d,{...base,askingPriceCents:40000},'2026-09-03T00:00:00.000Z');
  d.run("UPDATE listings SET delisted_at=?,delist_reason='repeated_appliance' WHERE id=?",['2026-09-04T00:00:00.000Z',id]);
  captureChanges(d,target,'facebook');const all=pendingBatch(d,target,'facebook');
  assert.equal(receiveChanges({...all,changes:[all.changes[1]]}).acks[0].status,'applied');
  assert.equal(receiveChanges(first).acks[0].status,'stale');
  upsertListingFacts(d,{...base,askingPriceCents:10000},'2026-08-01T00:00:00.000Z');
  let row=d.query('SELECT * FROM listings WHERE id=?').get(id);
  assert.equal(row.asking_price_cents,40000);assert.equal(row.delist_reason,'repeated_appliance');
  upsertListingFacts(d,base,'2026-09-05T00:00:00.000Z');
  assert.equal(d.query('SELECT delist_reason FROM listings WHERE id=?').get(id).delist_reason,'repeated_appliance');
`));
test('sync keeps detail evidence and matching portable vision through card refreshes',()=>isolated(setup+`
  import {syncPhotoUrls,photoFingerprint,loadCurrentVision} from '@/src/vision/merge.ts';
  import {VISION_MODEL,PROMPT_VERSION} from '@/src/vision/index.ts';
  syncPhotoUrls(id,['https://cdn.invalid/gallery.jpg']);
  d.run("UPDATE listing_photos SET phash='0000000000000001'");
  d.run('INSERT INTO vision_results(listing_id,model,prompt_version,photo_fingerprint,payload,created_at) VALUES(?,?,?,?,?,?)',[id,VISION_MODEL,PROMPT_VERSION,photoFingerprint(id),JSON.stringify({components:{gpu:'RTX 4090'}}),at]);
  captureChanges(d,target,'facebook');const batch=pendingBatch(d,target,'facebook');
  d.run('DELETE FROM vision_results');d.run('UPDATE listing_photos SET phash=NULL');
  receiveChanges(batch);assert.equal(loadCurrentVision(id,VISION_MODEL,PROMPT_VERSION).components.gpu,'RTX 4090');
  const l={...batch.changes[0].listing,description:'',raw:{},observedAt:'2026-09-02T00:00:00.000Z',photos:[],vision:null};
  receiveChanges({...batch,changes:[{sequence:999,hash:contentHash(l),listing:l}]});
  assert.equal(d.query('SELECT description FROM listings WHERE id=?').get(id).description,base.description);
  assert.equal(d.query('SELECT COUNT(*) n FROM listing_photos').get().n,1);
  assert.equal(loadCurrentVision(id,VISION_MODEL,PROMPT_VERSION).components.gpu,'RTX 4090');
  assert.equal(JSON.parse(d.query('SELECT raw_json FROM listings WHERE id=?').get(id).raw_json).attributes.condition,'used');
`));
test('invalid sync envelope or reused revision rolls back the whole batch',()=>isolated(setup+`
  captureChanges(d,target,'facebook');const batch=pendingBatch(d,target,'facebook');
  assert.throws(()=>receiveChanges({...batch,changes:[{...batch.changes[0],hash:'0'.repeat(64)}]}));
  assert.equal(d.query('SELECT COUNT(*) n FROM sync_receipts').get().n,0);
  receiveChanges(batch);
  const l={...batch.changes[0].listing,title:'Different title'};
  assert.throws(()=>receiveChanges({...batch,changes:[{...batch.changes[0],listing:l,hash:contentHash(l)}]}));
  assert.equal(d.query('SELECT title FROM listings WHERE id=?').get(id).title,'GPU');
`));

test('detail and availability clocks converge without overwriting a newer card price',()=>isolated(setup+`
  captureChanges(d,target,'facebook');const original=pendingBatch(d,target,'facebook');
  upsertListingFacts(d,{...base,description:'Original description',updatedAt:'2026-09-01T00:00:00.000Z',askingPriceCents:40000},'2026-09-05T00:00:00.000Z');
  const newer=snapshotSchema.parse({...original.changes[0].listing,description:'Untested sold as is for parts.',detailAt:'2026-09-04T00:00:00.000Z',photos:[{url:'https://cdn.invalid/detail.jpg',phash:null}],
    availability:{observedAt:'2026-09-06T00:00:00.000Z',outcome:'unknown',nextAt:'2026-09-06T01:00:00.000Z',failures:2},
    enrichment:{attemptedAt:'2026-09-06T00:00:00.000Z',nextAt:'2026-09-06T01:00:00.000Z',outcome:'failed',failures:2}});
  const batch={...original,changes:[{sequence:10,hash:contentHash(newer),listing:newer}]};
  assert.equal(receiveChanges(batch).acks[0].status,'applied');
  const row=d.query('SELECT * FROM listings WHERE id=?').get(id);
  assert.equal(row.description,newer.description);assert.equal(row.asking_price_cents,40000);assert.equal(row.last_seen,'2026-09-05T00:00:00.000Z');assert.equal(row.photo_count,1);
  assert.equal(d.query('SELECT outcome FROM listing_availability WHERE listing_id=?').get(id).outcome,'unknown');
  assert.equal(d.query('SELECT failures FROM listing_enrichment WHERE listing_id=?').get(id).failures,2);
  const old={...newer,description:'Old clean text',detailAt:at,availability:{...newer.availability,observedAt:at,outcome:'alive'}};
  receiveChanges({...batch,changes:[{sequence:11,hash:contentHash(old),listing:old}]});
  assert.equal(d.query('SELECT description FROM listings WHERE id=?').get(id).description,newer.description);
  assert.equal(d.query('SELECT outcome FROM listing_availability WHERE listing_id=?').get(id).outcome,'unknown');
  assert.equal(receiveChanges(batch).acks[0].status,'duplicate');
  const newCardOldDetail={...old,observedAt:'2026-09-07T00:00:00.000Z',askingPriceCents:39000};
  receiveChanges({...batch,changes:[{sequence:12,hash:contentHash(newCardOldDetail),listing:newCardOldDetail}]});
  const preserved=d.query('SELECT * FROM listings WHERE id=?').get(id);
  assert.equal(preserved.description,newer.description);assert.equal(preserved.updated_at,newer.detailAt);assert.equal(preserved.asking_price_cents,39000);
`));
test('a newer retirement observation survives stale descriptive facts',()=>isolated(setup+`
  captureChanges(d,target,'facebook');const batch=pendingBatch(d,target,'facebook');
  upsertListingFacts(d,{...base,description:'Newer detail',askingPriceCents:40000},'2026-09-03T00:00:00.000Z');
  const l={...batch.changes[0].listing,retiredAt:'2026-09-04T00:00:00.000Z',retireReason:'gone'};
  assert.equal(receiveChanges({...batch,changes:[{...batch.changes[0],listing:l,hash:contentHash(l)}]}).acks[0].status,'applied');
  const row=d.query('SELECT * FROM listings WHERE id=?').get(id);
  assert.equal(row.description,'Newer detail');assert.equal(row.asking_price_cents,40000);assert.equal(row.delist_reason,'gone');
`));

test('independent photo and recovery clocks survive stale cards, retries and newer prose',()=>isolated(setup+`
 import {ensurePhotoClock,syncPhotoUrls} from '@/src/vision/merge.ts';
 captureChanges(d,target,'facebook');const original=pendingBatch(d,target,'facebook');
 upsertListingFacts(d,{...base,description:'New prose',updatedAt:'2026-09-07T00:00:00.000Z',askingPriceCents:40000},'2026-09-08T00:00:00.000Z');
 syncPhotoUrls(id,['https://cdn.invalid/old.jpg'],'2026-09-02T00:00:00.000Z');
 const receipt={fingerprint:'a'.repeat(64),complete:true,unchanged:2,observedAt:'2026-09-06T00:00:00.000Z',durationMs:8000,reason:'complete'};
 const photoUpdate=snapshotSchema.parse({...original.changes[0].listing,photosAt:'2026-09-09T00:00:00.000Z',photos:[{url:'https://cdn.invalid/new.jpg',phash:null}],recovery:receipt});
 const batch={...original,changes:[{sequence:8,listing:photoUpdate,hash:contentHash(photoUpdate)}]};
 assert.equal(receiveChanges(batch).acks[0].status,'applied');
 assert.equal(d.query('SELECT description FROM listings WHERE id=?').get(id).description,'New prose');
 assert.equal(d.query('SELECT url FROM listing_photos WHERE listing_id=?').get(id).url,'https://cdn.invalid/new.jpg');
 assert.equal(JSON.parse(d.query('SELECT payload FROM listing_recovery WHERE listing_id=?').get(id).payload).unchanged,2);
 assert.equal(receiveChanges(batch).acks[0].status,'duplicate');
 const older={...photoUpdate,photosAt:at,photos:[],recovery:{...receipt,observedAt:at,complete:false}};
 receiveChanges({...batch,changes:[{sequence:9,listing:older,hash:contentHash(older)}]});
 assert.equal(d.query('SELECT COUNT(*) n FROM listing_photos WHERE listing_id=?').get(id).n,1);
 assert.equal(JSON.parse(d.query('SELECT payload FROM listing_recovery WHERE listing_id=?').get(id).payload).complete,true);
 d.run('DELETE FROM listing_rechecks WHERE listing_id=?',[id]);
 const receiptOnly={...photoUpdate,photosAt:at,recovery:{...receipt,observedAt:'2026-09-10T00:00:00.000Z'}};
 const receiptBatch={...batch,changes:[{sequence:10,listing:receiptOnly,hash:contentHash(receiptOnly)}]};
 assert.equal(receiveChanges(receiptBatch).acks[0].status,'applied');
 assert.equal(d.query('SELECT reason FROM listing_rechecks WHERE listing_id=?').get(id).reason,'recovery');
 d.run('DELETE FROM listing_rechecks WHERE listing_id=?',[id]);
 assert.equal(receiveChanges(receiptBatch).acks[0].status,'duplicate');
 assert.equal(d.query('SELECT * FROM listing_rechecks WHERE listing_id=?').get(id),null);
`));
