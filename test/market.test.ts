import {test} from 'bun:test';
import {isolated} from './isolated.ts';
const core=`
  import {marketCohorts,marketSeries,marketCsv,rangeStart} from '@/src/market/core.ts';
  const at=Date.parse('2026-09-14T12:00:00Z');
  const row=(id,title,price=20000,date='2026-08-15',extra={})=>({id,source:'ebay',source_item_id:String(id),url:'https://www.ebay.com/itm/'+(900000000000+id),raw_title:title,sold_price_cents:price,shipping_cents:0,currency:'USD',condition_norm:'used',condition_raw:'Used',sold_at:date,captured_at:'2026-09-14T00:00:00Z',raw_json:JSON.stringify({soldAt:date}),...extra});
  const p=(category,brand,model)=>({id:1,category,brand,model});
`;
test('market memory preserves layout, latency, brand, speed, RGB and ECC identity',()=>isolated(core+`
  const product=p('ram','Corsair','Vengeance 32GB DDR5-6000');
  const result=marketCohorts(product,[
    row(1,'Corsair Vengeance 32GB 2x16GB DDR5-6000 CL30',1750),
    row(2,'Corsair Vengeance 32GB (2 x 16GB) DDR5 6000 CL30',750),
    row(3,'Corsair Vengeance 32GB 1x32GB DDR5-6000 CL30'),
    row(4,'Corsair Vengeance 32GB 2x16GB DDR5-6000 CL36'),
    row(5,'Corsair Vengeance 32GB 2x16GB DDR5-6000'),
    row(6,'Corsair Vengeance 32GB 2x16GB DDR5-6000 RGB CL30'),
    row(7,'Corsair Vengeance 32GB 2x16GB DDR5-6000 ECC CL30'),
    row(8,'Kingston Vengeance 32GB 2x16GB DDR5-6000 CL30'),
    row(9,'Corsair Vengeance 32GB 2x16GB DDR5-5600 CL30'),
    row(10,'Corsair Vengeance 32GB DDR5-6000 CL30'),
  ],at);
  assert.equal(result.excluded,5);assert.equal(result.cohorts.length,4);
  assert.equal(result.cohorts[0].sales.length,2);assert.match(result.cohorts[0].label,/2 × 16GB/);
  assert.equal(result.cohorts.at(-1).complete,false);
  const series=marketSeries(product,result.cohorts,{range:'3m',condition:'used',basis:'item',at});
  assert.equal(series.summary.medianCents,1250);assert.equal(series.totalSales,2);
`));
test('market separates GPU board variants and rejects whole machines, bundles, accessories and wrong model suffixes',()=>isolated(core+`
  const product=p('gpu','NVIDIA','RTX 3080');
  const result=marketCohorts(product,[row(1,'ASUS TUF NVIDIA RTX 3080 10GB'),row(2,'ASUS ROG STRIX NVIDIA RTX 3080 10GB'),row(3,'NVIDIA RTX 3080 Founders Edition 10GB'),row(4,'NVIDIA RTX 3080 10GB'),row(5,'NVIDIA RTX 3080 Ti 12GB'),row(6,'Gaming PC Ryzen 7 5800X RTX 3080 10GB 32GB RAM 1TB SSD'),row(7,'NVIDIA RTX 3080 10GB GPU bundle'),row(8,'NVIDIA RTX 3080 10GB for parts not working')],at);
  assert.equal(result.cohorts.length,4);assert.equal(result.excluded,4);assert.equal(result.cohorts.filter(c=>c.complete).length,3);
  const unsafe=marketCohorts(product,[row(12,'NVIDIA RTX 3080 10GB',20000,'2026-08-15',{url:'javascript:alert(1)'})],at);
  assert.equal(unsafe.cohorts[0].sales[0].url,null);
  assert.equal(marketCohorts(product,[row(13,'NVIDIA RTX 3080 10GB 12GB')],at).excluded,1);
`));

test('market computer RAM cannot borrow a nearby graphics-memory figure',()=>isolated(core+`
  const product=p('laptop','Dell','Latitude 7420');
  const result=marketCohorts(product,[row(1,'Dell Latitude 7420 i7-1185G7 8GB 16GB RAM 512GB SSD')],at);
  assert.equal(result.cohorts.length,1);assert.match(result.cohorts[0].label,/RAM: 16GB/);assert.ok(!result.cohorts[0].label.includes('RAM: 8GB'));
`));
test('market conditions, seller unknowns and source dates remain explicit',()=>isolated(core+`
  const product=p('phone','Apple','iPhone 15');
  const result=marketCohorts(product,[row(1,'Apple iPhone 15 128GB Unlocked'),row(2,'Apple iPhone 15 256GB Unlocked'),row(3,'Apple iPhone 15 128GB Verizon'),row(4,'Apple iPhone 15 128GB'),row(5,'Apple iPhone 15 128GB Unlocked',25000,'2026-08-15',{condition_norm:'new',condition_raw:'New'}),row(6,'Apple iPhone 15 Pro 128GB Unlocked'),row(7,'Apple iPhone 15 128GB 256GB Unlocked'),row(8,'Apple iPhone 15 128GB Unlocked',20000,'2027-01-01'),row(9,'Apple iPhone 15 128GB Unlocked',20000,'2026-08-15',{raw_json:'{}'})],at);
  assert.equal(result.excluded,4);assert.equal(result.cohorts.length,4);
  const used=marketSeries(product,result.cohorts,{range:'3m',condition:'used',basis:'item',at});assert.equal(used.totalSales,1);
  const fresh=marketSeries(product,result.cohorts,{range:'3m',condition:'new',basis:'item',at});assert.equal(fresh.summary.medianCents,25000);
  const unknown=result.cohorts.find(c=>c.unknowns.length);assert.deepEqual(unknown.unknowns,['Network']);
`));
test('market chart leaves missing intervals empty and excludes unstated shipping from delivered prices',()=>isolated(core+`
  const product=p('cpu','AMD','Ryzen 5 5600X');
  const result=marketCohorts(product,[row(1,'AMD Ryzen 5 5600X CPU',10000,'2023-10-01'),row(2,'AMD Ryzen 5 5600X CPU',1750,'2026-09-01',{shipping_cents:null}),row(3,'AMD Ryzen 5 5600X CPU',750,'2026-09-02',{shipping_cents:250})],at);
  const series=marketSeries(product,result.cohorts,{range:'3y',condition:'used',basis:'item',at});
  assert.equal(series.points.filter(p=>p.count).length,2);assert.ok(series.points.some(p=>p.count===0&&p.medianCents===null));assert.equal(series.summary.changePercent,null);
  const delivered=marketSeries(product,result.cohorts,{range:'1m',condition:'used',basis:'delivered',at});assert.equal(delivered.summary.medianCents,1000);assert.equal(delivered.coverage.missingShipping,1);
  assert.equal(new Date(rangeStart('1m',Date.parse('2024-03-31'))).toISOString().slice(0,10),'2024-02-29');
  const old=marketSeries(product,result.cohorts,{range:'1m',condition:'used',basis:'item',at:Date.parse('2028-09-14')});assert.equal(old.totalSales,0);assert.equal(old.coverage.last,'2026-09-02');
  const csv=marketCsv([{id:1,title:'=1+1, "unsafe"',date:'2026-09-01',url:null,itemCents:1750,shippingCents:null,condition:'used'}],'delivered');
  assert.ok(csv.includes('17.50'));assert.ok(csv.includes("'=1+1"));assert.ok(csv.includes('""unsafe""'));assert.ok(!csv.includes('NaN'));
`));
