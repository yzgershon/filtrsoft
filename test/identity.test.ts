import {test,expect} from "bun:test";
import {resolveCategory,resolveProductType} from "../src/signals/product-type.ts";
import {compMatchesQuery,queryForSku} from "../src/sources/ebay.ts";
import {extractAttributes} from "../src/catalog/match.ts";
import {isolated} from "./isolated.ts";

test("parts taxonomy accepts exact devices and retains whole-machine/accessory guards",()=>{
  for(const [category,brand,model] of [
    ["storage","WD","BLACK SN850X 2TB NVMe"],
    ["ram","Corsair","Vengeance 32GB (2x16GB) DDR5-6000 RAM"],
    ["psu","Corsair","RM850x 850W power supply"],
    ["motherboard","MSI","B550 Tomahawk motherboard"],
    ["case","NZXT","H510 PC case"],
  ]){
    const title=brand+" "+model;
    expect(resolveCategory(title)).toBe(category);
    expect(resolveProductType(title).kind).toBe("tech");
    expect(compMatchesQuery(title,queryForSku({category,brand,model}),category).ok).toBe(true);
  }
  expect(resolveCategory("Dell laptop 32GB RAM 2TB NVMe")).toBe("laptop");
  expect(resolveProductType("Laptop carrying case").kind).toBe("accessory");
  expect(compMatchesQuery("Gaming PC Corsair RM850x 850W power supply","Corsair RM850x 850W power supply","psu").ok).toBe(false);
  const legacy={category:"ram",brand:"WD",model:"BLACK SN850X 2TB NVMe"};
  expect(queryForSku(legacy)).not.toContain("desktop memory");
  expect(compMatchesQuery("WD BLACK SN850X 2TB NVMe",queryForSku(legacy),"ram").ok).toBe(true);
});

test("memory comp identity refuses different brand layout capacity ECC and RGB",()=>{
  const query="Corsair Vengeance 32GB (2x16GB) DDR5-6000 desktop memory";
  for(const title of ["G.SKILL Vengeance 32GB (2x16GB) DDR5-6000 RAM","Corsair Vengeance 32GB (1x32GB) DDR5-6000 RAM","Corsair Vengeance 32GB (2x16GB) DDR5-6000 ECC RAM","Corsair Vengeance RGB 32GB (2x16GB) DDR5-6000 RAM","Corsair Vengeance 64GB (2x32GB) DDR5-6000 RAM"]){
    expect(compMatchesQuery(title,query,"ram").ok).toBe(false);
  }
  expect(compMatchesQuery("Corsair Vengeance 32GB DDR5-6000","Corsair Vengeance 32GB DDR5-6000 desktop memory","ram").ok).toBe(false);
});

test("GPU extraction keeps Ti Super and XTX including closed-up model spelling",()=>{
  expect(extractAttributes("RX 7900 XTX").gpu).toBe("rx 7900 xtx");
  expect(extractAttributes("RX7900XTX").gpu).toBe("rx 7900 xtx");
  expect(extractAttributes("RTX4070TiSuper").gpu).toBe("rtx 4070 ti super");
  expect(extractAttributes("RTX 4070 Ti Super").gpu).toBe("rtx 4070 ti super");
  expect(extractAttributes("RX 7800 XT").gpu).toBe("rx 7800 xt");
});

test("aliasless catalog identities resolve without creating aliases or using another brand",()=>isolated(`
  import {db} from '@/src/db/index.ts';
  import {matchSku} from '@/src/catalog/match.ts';
  const d=db(),at=new Date().toISOString();
  d.run("INSERT INTO skus(id,category,brand,model,created_at) VALUES (1,'motherboard','MSI','B550 Tomahawk',?)",[at]);
  assert.equal(matchSku('MSI B550 Tomahawk','', 'motherboard').skuId,1);
  assert.equal(matchSku('ASUS B550 Tomahawk','', 'motherboard').skuId,null);
  assert.equal(d.query('SELECT COUNT(*) n FROM sku_aliases').get().n,0);
  d.close();
`));

test("sparse exact capacity never falls back to plentiful mismatches or unnamed capacity",()=>isolated(`
  import {db} from '@/src/db/index.ts';
  import {valueSku} from '@/src/valuation/index.ts';
  const d=db(),at=new Date().toISOString();
  d.run("INSERT INTO skus(id,category,brand,model,created_at) VALUES (1,'phone','Audit','Phone',?)",[at]);
  for(let i=0;i<11;i++)d.run("INSERT INTO comps(source,source_item_id,raw_title,sold_price_cents,condition_norm,sold_at,captured_at,sku_id,raw_json) VALUES ('ebay',?,?,?,'used',?,?,1,json_object('soldAt',?))",[String(i),i<8?'Phone 128GB':i<10?'Phone 512GB':'Phone',i<8?10000:40000,at,at,at]);
  const v=valueSku(1,{category:'phone',condition:'used',attributes:{storage_gb:512}});
  assert.equal(v.compCount,2);assert.equal(v.medianCents,40000);assert.notEqual(v.confidence,'high');
  assert.equal(valueSku(1,{category:'phone',attributes:{storage_gb:1024}}).status,'no_comps');
  d.close();
`));

test("a sparse premium board tier never inherits base-tier or unnamed cards",()=>isolated(`
  import {db} from '@/src/db/index.ts';
  import {valueSku} from '@/src/valuation/index.ts';
  import {boardTier} from '@/src/signals/board-tier.ts';
  const d=db(),at=new Date().toISOString();
  d.run("INSERT INTO skus(id,category,brand,model,created_at) VALUES (1,'gpu','NVIDIA','RTX 4090',?)",[at]);
  const premium='ASUS ROG Strix RTX 4090',base='MSI Ventus RTX 4090';
  assert.notEqual(boardTier(premium),null);assert.notEqual(boardTier(premium),boardTier(base));
  for(let i=0;i<11;i++)d.run("INSERT INTO comps(source,source_item_id,raw_title,sold_price_cents,condition_norm,sold_at,captured_at,sku_id,raw_json) VALUES ('ebay',?,?,?,'used',?,?,1,json_object('soldAt',?))",[String(i),i<8?base:i<10?premium:'RTX 4090',i<8?100000:200000,at,at,at]);
  const v=valueSku(1,{category:'gpu',condition:'used',boardTier:boardTier(premium)});
  assert.equal(v.compCount,2);assert.equal(v.medianCents,200000);assert.notEqual(v.confidence,'high');d.close();
`));
