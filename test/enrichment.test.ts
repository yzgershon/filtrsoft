import {test,expect} from "bun:test";
import {isolated} from "./isolated.ts";
import {mercariPhotos} from "../src/sources/marketplace.ts";
test('Mercari gallery uses exact item IDs and best available size, excluding recommendation cards',()=>{
  const photo=(id:string,slide:number,width:number)=>`https://u-mercari-images.mercdn.net/photos/${id}_${slide}.jpg?width=${width}`;
  expect(mercariPhotos([photo('m10718166618',2,640),photo('m10718166618',1,256),photo('m10718166618',1,2560),photo('m10972858917',1,2560),'https://evil.invalid/photos/m10718166618_1.jpg'],
    'https://www.mercari.com/us/item/m10718166618/')).toEqual([photo('m10718166618',1,2560),photo('m10718166618',2,640)]);
});
test('source-independent stored enrichment neither visits the item URL nor refreshes last-seen',()=>isolated(`
  import {db} from '@/src/db/index.ts';
  import {upsertListingFacts} from '@/src/db/listings.ts';
  import {checkStored,checkFetched} from '@/src/engine/index.ts';
  import {syncPhotoUrls,photoFingerprint} from '@/src/vision/merge.ts';
  import {VISION_MODEL,PROMPT_VERSION} from '@/src/vision/index.ts';
  const d=db(),at='2026-09-01T00:00:00.000Z';
  for(const source of ['facebook','offerup','mercari']) {
    const id=upsertListingFacts(d,{source,sourceId:'one',url:'https://example.invalid/item/one',title:'RTX 4090',description:'Desktop graphics card',askingPriceCents:50000,location:null,postedAt:null,photoCount:1},at).id;
    syncPhotoUrls(id,['https://example.invalid/image.jpg']);
    d.run("UPDATE listing_photos SET phash='0000000000000001' WHERE listing_id=?",[id]);
    d.run('INSERT INTO vision_results(listing_id,model,prompt_version,photo_fingerprint,payload,created_at) VALUES(?,?,?,?,?,?)',[id,VISION_MODEL,PROMPT_VERSION,photoFingerprint(id),JSON.stringify({components:{gpu:'RTX 4090'},facts:[]}),at]);
    globalThis.fetch=async()=>{throw new Error('Unexpected transport call');};
    const result=await checkFetched(checkStored(id).listing,{persist:true,storedListingId:id,vision:true});
    assert.equal(result.vision.components.gpu,'RTX 4090');
    assert.equal(d.query('SELECT last_seen FROM listings WHERE id=?').get(id).last_seen,at);
  }
`));
test('changed photos re-enter the vision queue; current evidence is excluded before limiting',()=>isolated(`
  import {db} from '@/src/db/index.ts';
  import {upsertListingFacts} from '@/src/db/listings.ts';
  import {visionCandidates} from '@/src/crawler/vision-pass.ts';
  import {syncPhotoUrls,photoFingerprint} from '@/src/vision/merge.ts';
  import {VISION_MODEL,PROMPT_VERSION} from '@/src/vision/index.ts';
  const d=db(),at='2026-09-01T00:00:00.000Z';let changed;
  for(let i=0;i<6;i++) {
    const id=upsertListingFacts(d,{source:'facebook',sourceId:String(i),url:'https://example.invalid/'+i,title:'Nvidia RTX 4090',description:'GPU',askingPriceCents:50000,location:null,postedAt:null,photoCount:1},at).id;
    syncPhotoUrls(id,['https://example.invalid/'+i+'.jpg']);
    d.run("UPDATE listing_photos SET phash='0000000000000001' WHERE listing_id=?",[id]);
    d.run('INSERT INTO vision_results(listing_id,model,prompt_version,photo_fingerprint,payload,created_at) VALUES(?,?,?,?,?,?)',[id,VISION_MODEL,PROMPT_VERSION,photoFingerprint(id),'{}',at]);
    d.run("INSERT INTO verdicts(listing_id,engine_version,call,payload,created_at) VALUES(?, 'audit', 'BUY', ?, ?)",[id,JSON.stringify({headline:'buy'}),at]);
    if(i===0) changed=id;
  }
  assert.equal(visionCandidates(1).length,0);
  syncPhotoUrls(changed,['https://example.invalid/new.jpg']);
  assert.deepEqual(visionCandidates(1).map(c=>c.id),[changed]);
`));
