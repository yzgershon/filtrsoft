import {test,expect} from 'bun:test';import {isolated} from './isolated.ts';
import {exactDemandQuery} from '../src/sources/comp-priority.ts';import {queryForSku,compMatchesQuery} from '../src/sources/ebay.ts';
test('storage taxonomy and demanded configurations retain capacity, suffix and quantity guards',()=>{
 expect(queryForSku({brand:'Samsung',model:'990 PRO 1TB NVMe SSD',category:'ram'})).toContain('solid state drive');
 expect(queryForSku({brand:'Samsung',model:'990 PRO 1TB NVMe SSD',category:'ram'})).not.toContain('desktop memory');
 const query=exactDemandQuery({brand:'Lenovo',model:'Legion 5',category:'laptop'},{cpu:'i7-12700H',gpu:'RTX 3070 Ti',ram_gb:32,storage_gb:1024});
 expect(query).toContain('32GB RAM 1TB SSD');expect(query).toContain('RTX 3070 Ti');
 expect(compMatchesQuery('Lenovo Legion 5 i7-12700H RTX 3070 32GB RAM 1TB SSD',query,'laptop').ok).toBe(false);
 expect(exactDemandQuery({brand:'Apple',model:'iPhone 15',category:'phone'},{storage_gb:256})).toBe('Apple iPhone 15 256GB');
});
test('one failed exact query does not block another configuration and unresolved identity is distinct from pricing',()=>isolated(`
 import {db} from '@/src/db/index.ts';import {upsertListingFacts} from '@/src/db/listings.ts';import {collectionPriority,startCollection,finishCollection} from '@/src/sources/comp-priority.ts';
 const d=db(),at=new Date().toISOString();d.run("INSERT INTO skus(category,brand,model,attributes,created_at) VALUES('laptop','Apple','MacBook Air M2','{}',?)",[at]);
 for(const [i,title] of ['Apple MacBook Air M2 256GB','Apple MacBook Air M2 512GB','Unknown gaming laptop model'].entries()){
  const id=upsertListingFacts(d,{source:'fixture',sourceId:String(i),url:'https://example.invalid/'+i,title,description:'Fully functional item.',askingPriceCents:20000,location:null,postedAt:null,photoCount:0}).id;
  d.run("INSERT INTO verdicts(listing_id,engine_version,call,payload,created_at) VALUES(?,'fixture','INSUFFICIENT_DATA','{}',?)",[id,at]);
 }
 const first=collectionPriority(10);assert.equal(first.filter(r=>r.id===1).length,2);
 const attempt=startCollection(1,first[0].demandQuery);finishCollection(attempt,{fetched:5,parsed:3,accepted:0,saved:0,rejections:{'different variant':3}});
 const second=collectionPriority(10);assert.equal(second.filter(r=>r.id===1).length,1);assert.notEqual(second[0].demandQuery,first[0].demandQuery);
 assert.equal(d.query("SELECT COUNT(*) n FROM comp_identity_demand WHERE state='identity-required'").get().n,1);
 assert.equal(d.query('SELECT count FROM comp_rejections WHERE attempt_id=?').get(attempt).count,3);
`));
