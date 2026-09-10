import {test,expect} from 'bun:test';
import {specifications} from '../src/engine/specifications.ts';
const proof=(title:string,description='',attributes:Record<string,string>={},visionEvidence:any=null,category='prebuilt')=>({facts:{title,description,attributes},signals:{category},visionEvidence}) as any;
test('Specifications retain exact CPU/GPU variants, RAM layout and separate drives',()=>{
  const s=specifications(proof('Gaming PC','CPU: AMD Ryzen 5 7600X3D\nGPU: ASUS ROG Strix RTX 4070 Ti Super 16GB GDDR6X\nRAM: 32GB DDR5 6000 (2x16GB)\nStorage: 1TB NVMe SSD + 2TB HDD\nPSU: Corsair RM850x 850W'));
  const get=(key:string)=>s.fields.find(f=>f.key===key)!;
  expect(get('cpu').values.some(v=>v.value.includes('7600X3D'))).toBe(true);
  expect(get('gpu').values.some(v=>v.value.includes('ASUS ROG Strix RTX 4070 Ti Super'))).toBe(true);
  expect(get('ram').values.some(v=>v.quote.includes('2x16GB'))).toBe(true);
  expect(get('storage').values.some(v=>v.value.includes('1TB NVMe SSD + 2TB HDD'))).toBe(true);
  expect(get('psu').values[0].value).toBe('Corsair RM850x 850W');
});
test('Specifications expose contradictory sources without choosing a winner',()=>{
  const s=specifications(proof('Gaming PC 16GB RAM','32GB RAM',{}, {components:{ram:'8GB'},facts:[],unreadable:['CPU label'] }));
  const ram=s.fields.find(f=>f.key==='ram')!;expect(ram.state).toBe('multiple');expect(new Set(ram.values.map(v=>v.source)).size).toBe(3);
  expect(s.notes).toContain('Unreadable in photo: CPU label');
});
test('Missing and optional hardware cannot become installed specifications',()=>{
  const s=specifications(proof('Computer','Supports up to 128GB RAM. Can add RTX 4090. Previously had Ryzen 7 5800X. No SSD included.'));
  for(const key of ['cpu','gpu','ram','storage'])expect(s.fields.find(f=>f.key===key)!.state).toBe('unknown');
  expect(s.notes.length).toBeGreaterThan(0);expect(s.photoStatus).toBe('not_read');
});
test('Phone storage is separate from RAM, and a model never supplies invented capacity',()=>{
  const s=specifications(proof('iPhone 15 Pro 256GB','Factory unlocked. Battery health: 91%.',{},null,'phone'));
  expect(s.fields.find(f=>f.key==='model')!.values[0].value).toBe('iPhone 15 Pro');
  expect(s.fields.find(f=>f.key==='storage')!.values[0].value).toBe('256GB');
  expect(s.fields.find(f=>f.key==='battery')!.values.length).toBeGreaterThan(0);
  expect(specifications(proof('iPhone 15 Pro','',{},null,'phone')).fields.find(f=>f.key==='storage')!.state).toBe('unknown');
});

test('Flattened labelled specs stop at the next field and keep complete variants',()=>{
  const s=specifications(proof('PC RTX 3070','CPU: AMD Ryzen 5 7600X3D, GPU: NVIDIA RTX 3070 RAM: 32GB DDR5 (2x16GB) Storage: 2TB NVMe SSD'));
  expect(s.fields.find(f=>f.key==='cpu')!.values.map(v=>v.value)).toEqual(['AMD Ryzen 5 7600X3D']);
  expect(s.fields.find(f=>f.key==='ram')!.values.map(v=>v.value)).toEqual(['32GB DDR5 (2x16GB)']);
  expect(s.fields.find(f=>f.key==='gpu')!.state).toBe('reported');
  const variant=specifications(proof('RTX 4070','GPU: ASUS RTX 4070 Ti Super'));
  expect(variant.fields.find(f=>f.key==='gpu')!.state).toBe('multiple');
});
test('Phone RAM and storage in the same sentence stay distinct',()=>{
  const s=specifications(proof('Pixel 9 Pro 12GB RAM 256GB','',{},null,'phone'));
  expect(s.fields.find(f=>f.key==='storage')!.values.map(v=>v.value)).toEqual(['256GB']);
  expect(s.fields.find(f=>f.key==='ram')!.values[0].value).toBe('12GB RAM');
});

test('M2 storage is not an Apple processor',()=>{expect(specifications(proof('Gaming desktop','M2 NVMe 1TB SSD')).fields.find(f=>f.key==='cpu')!.state).toBe('unknown');});

test('Live flattened PC extras do not become Case or a computer display',()=>{
  const s=specifications(proof('High End Gaming PC RTX 5080 / Ryzen 7 9800X','FULL SPECS ---------- GPU: ASUS TUF Gaming RTX 5080 16GB GDDR7 OC CPU: AMD Ryzen 7 9800X3D (8-core / 16-thread) RAM: G.SKILL Trident Z5 Royal Neo 32GB (2x16) DDR5-6400 CL30 Storage: WD_Black SN8100 2TB NVMe (PCIe 5.0) Cooling: ASUS ROG Ryujin III 360 ARGB White AIO, 3.5" LCD PSU: Lian Li Edge 1000W 80+ Gold, ATX 3.1 / PCIe 5.1 Case: Lian Li O11 Vision Compact, back-connect, tempered glass EXTRAS ------ - Lian Li 8.8" side display panel (temps / custom graphics) - Lian Li Strimer Wireless 24-pin RGB cable - Lian Li TL LCD Wireless 120mm fan. Fully cable-managed.'));
  expect(s.fields.find(f=>f.key==='case')!.values.map(v=>v.value)).toEqual(['Lian Li O11 Vision Compact, back-connect, tempered glass']);
  expect(s.fields.find(f=>f.key==='display')).toBeUndefined();
  expect(s.fields.find(f=>f.key==='cooling')!.values[0].value).toContain('3.5" LCD');
  expect(s.notes.some(n=>n.includes('8.8" side display panel')&&n.includes('24-pin RGB cable'))).toBe(true);
  expect(s.fields.find(f=>f.key==='ram')!.values[0].value).toBe('G.SKILL Trident Z5 Royal Neo 32GB (2x16) DDR5-6400 CL30');
  expect(s.fields.find(f=>f.key==='gpu')!.values.some(v=>v.value==='ASUS TUF Gaming RTX 5080 16GB GDDR7 OC')).toBe(true);
});

test('Display extraction keeps real laptop and explicitly included monitor facts',()=>{
  expect(specifications(proof('Laptop','15.6 inch IPS 1920x1080',{},null,'laptop')).fields.find(f=>f.key==='display')!.values.map(v=>v.value)).toEqual(['15.6 inch IPS','1920x1080']);
  expect(specifications(proof('Gaming PC','Includes a 27 inch IPS monitor')).fields.find(f=>f.key==='display')!.values[0].value).toBe('27 inch IPS');
  const s=specifications(proof('Gaming PC','Case: Corsair 4000D Accessories: keyboard and mouse'));
  expect(s.fields.find(f=>f.key==='case')!.values[0].value).toBe('Corsair 4000D');
  expect(s.notes).toContain('Accessories: keyboard and mouse');
});
