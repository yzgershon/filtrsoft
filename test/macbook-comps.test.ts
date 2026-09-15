import {test} from 'bun:test';
import {isolated} from './isolated.ts';
test('MacBook family buckets cannot price generations together, including legacy comps and automatic refresh',()=>isolated(`
  import {db,insertComp,now} from '@/src/db/index.ts';import {valueSku} from '@/src/valuation/index.ts';
  import {compMatchesQuery} from '@/src/sources/ebay.ts';import {collectionPriority} from '@/src/sources/comp-priority.ts';
  const d=db(),soldAt=new Date(Date.now()-86400000).toISOString();
  for(const model of ['Macbook Air 13','MacBook Pro M1','MacBook Pro M1 Pro','Macbook Air 13 2017'])d.run("INSERT INTO skus(category,brand,model,attributes,created_at) VALUES('laptop','Apple',?,'{}',?)",[model,now()]);
  let seq=0;const put=(sku,title)=>insertComp({source:'ebay',source_item_id:String(++seq),sku_id:sku,raw_title:title,sold_price_cents:50000,sold_at:soldAt,condition_norm:'used',raw:{soldAt}});
  put(1,'Apple Macbook Air 13 2017 128GB');put(1,'Apple Macbook Air 13 M1 256GB');put(1,'Apple Macbook Air 13 M2 256GB');
  put(2,'Apple MacBook Pro M1 256GB');put(2,'Apple MacBook Pro M1 Pro 512GB');put(2,'Apple MacBook Pro M2 256GB');
  put(3,'Apple MacBook Pro M1 Pro 512GB');put(3,'Apple MacBook Pro M1 Max 512GB');
  put(4,'Apple Macbook Air 13 2017 128GB');put(4,'Apple Macbook Air 13 2015 128GB');
  assert.equal(valueSku(1).compCount,0);assert.equal(valueSku(2).compCount,1);assert.equal(valueSku(3).compCount,1);assert.equal(valueSku(4).compCount,1);
  assert.equal(compMatchesQuery('Apple Macbook Air 13 2017','Apple Macbook Air 13','laptop').ok,false);
  assert.equal(compMatchesQuery('Apple MacBook Pro M1 Pro','Apple MacBook Pro M1','laptop').ok,false);
  assert.equal(compMatchesQuery('Apple Macbook Air 13 M1 2020','Apple Macbook Air 13 2020','laptop').ok,false);
  assert.equal(compMatchesQuery('Apple Macbook Air 13 2017','Apple Macbook Air 13 2017','laptop').ok,true);
  assert.equal(compMatchesQuery('Apple Macbook Air 13 2015','Apple Macbook Air 13 2017','laptop').ok,false);
  assert.equal(collectionPriority(20).some(s=>s.id===1),false);
  assert.equal(d.query('SELECT COUNT(*) n FROM comps').get().n,10); // real history remains recoverable
`));
