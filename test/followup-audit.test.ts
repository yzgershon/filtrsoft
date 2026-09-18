import {test,expect} from 'bun:test';
import {conditionDisclosure} from '../src/signals/condition.ts';
import {textFacts} from '../src/signals/factual-text.ts';
import {extractAttributes} from '../src/catalog/match.ts';
import {isolated} from './isolated.ts';
test('coordinated negated pin damage is not a defect; later asserted damage still is',()=>{
 expect(conditionDisclosure('No bent, broken or missing pin as photo #2, #3 shown.').broken).toBeNull();
 expect(conditionDisclosure('No broken pins. Fully tested.').broken).toBeNull();
 expect(conditionDisclosure('No bent pins, but broken socket.').broken).not.toBeNull();
 expect(conditionDisclosure('Broken pins.').broken).not.toBeNull();
});
test('a compact manufacturer GPU suffix conflicts with the unsuffixed chip name',()=>{
 expect(textFacts('Asus GeForce GTX 1650 4GB GDDR6 TUF-GTX1650S-O4G-GAMING').conflicts).toContain('gpu');
 expect(textFacts('GTX 1650 TUF-GTX1650-O4G-GAMING').conflicts).not.toContain('gpu');
});
test('GPU price retains stated board maker and memory generation even with sparse exact sales',()=>isolated(`
 import {db} from '@/src/db/index.ts';import {extractAttributes,matchSku} from '@/src/catalog/match.ts';import {valueSku} from '@/src/valuation/index.ts';
 const d=db(),at=new Date(Date.now()-86400000).toISOString();
 d.run("INSERT INTO skus(id,category,brand,model,created_at) VALUES (1,'gpu','NVIDIA','GTX 1650',?)",[at]);
 for(const [i,title] of ['ASUS GTX 1650 4GB GDDR6','ASUS GTX 1650 4GB GDDR5','MSI GTX 1650 4GB GDDR6','GTX 1650 4GB GDDR6','ASUS GTX 1650 4GB','ASUS GTX 1650 4GB GDDR6'].entries())d.run("INSERT INTO comps(source,source_item_id,raw_title,sold_price_cents,condition_norm,sold_at,captured_at,sku_id,raw_json) VALUES ('ebay',?,?,10000,'used',?,?,1,json_object('soldAt',?))",[String(i),title,at,at,at]);
 const attrs=extractAttributes('ASUS GTX 1650 4GB GDDR6 graphics card','gpu');
 assert.equal(attrs.board_brand,'asus');assert.equal(attrs.vram_type,'gddr6');
 assert.equal(matchSku('ASUS GTX 1650 4GB GDDR6 graphics card','','gpu').attributes.board_brand,'asus');
 assert.equal(valueSku(1,{category:'gpu',condition:'used',attributes:attrs}).compCount,2);
`));
test('availability observation acquires the write transaction before reading across competing writers',()=>isolated(`
 import {db,DB_PATH} from '@/src/db/index.ts';import {Database} from 'bun:sqlite';import {recordProbe} from '@/src/db/probes.ts';
 const d=db(),at=new Date().toISOString();d.run("INSERT INTO listings(id,source,source_id,url,title,captured_at) VALUES(1,'facebook','test','https://example.invalid','GPU',?)",[at]);
 const other=new Database(DB_PATH);other.exec('PRAGMA busy_timeout=1');const query=d.query.bind(d);let competed=false;
 d.query=(sql)=>{const statement=query(sql);if(!sql.includes('SELECT l.probe_failures'))return statement;return {get(...args){const row=statement.get(...args);try{other.run("UPDATE listings SET title='GPU observed' WHERE id=1");}catch(e){assert.match(String(e),/locked|BUSY/i);}competed=true;return row;}};};
 recordProbe(1,'alive');assert.equal(competed,true);assert.equal(query('SELECT outcome FROM listing_availability WHERE listing_id=1').get().outcome,'alive');other.close();
`));
