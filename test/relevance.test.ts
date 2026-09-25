import {test,expect,describe} from 'bun:test';
import {relevance,gpuEras,cpuEras,macEra} from '../src/signals/relevance.ts';
import {isolated} from './isolated.ts';

// Real titles from the production feed on 2026-09-24, with the engine's category.
const code=(title:string,category:string,description?:string)=>{const r=relevance({title,category,description});return r.keep?'keep':r.code;};

describe("Yish's scope (2026-09-24)",()=>{
  test('phones, tablets, wearables and VR headsets are out',()=>{
    expect(code('iPhone 13 128Gb unlocked','phone')).toBe('phone');
    expect(code('Iphone 17 pro max','phone')).toBe('phone');
    expect(code('Samsung S25 128gb unlocked $500','unknown')).toBe('phone');
    expect(code('Ipad 8th generation 10.2inch (2020) Rose Gold','tablet')).toBe('tablet');
    expect(code('Google Pixel Buds Pro with Active Noise Cancellation','phone')).toBe('wearable');
    expect(code('Meta Quest 2 128GB VR headset-Excellent condition w/box','console')).toBe('wearable');
  });
  test('accessories and non-computer items are out, bundled accessories are not',()=>{
    expect(code('Dbrand Grip iPhone 16 pro Max with camera control','phone')).toBe('accessory');
    expect(code('OtterBox MagSafe Phone Case IPhone 16 Pro Max','phone')).toBe('accessory');
    expect(code('Magnetic Macbook Air 13.6 Privacy Screen','laptop')).toBe('accessory');
    expect(code('Pelonis 30" Ceramic Digital Tower Heater-2 for 1 price & Hot Plate.','prebuilt')).toBe('not_tech');
    expect(code('Orbi RBS850 Mesh WiFi Satellite','unknown')).toBe('not_ours');
    expect(code('MacBook Pro M1 with charger and case','laptop')).toBe('keep');
    expect(code('Gaming PC in NZXT case','prebuilt')).toBe('keep');
    expect(code('Lian li O11 Dynamic Mini PC Case','case')).toBe('keep');
  });
  test('office and basic Windows computers are out unless a gaming GPU is named',()=>{
    expect(code('Dell OptiPlex 9020 Desktop PC - Intel i7-4770, 8GB RAM, 500GB HDD','prebuilt')).toBe('office_pc');
    expect(code('Lenovo ThinkPad T14 Gen 4 Laptop — i7 / 32GB RAM / Windows 11','laptop')).toBe('office_pc');
    expect(code('Dell Optiplex 7050 Computer w/ 24” LCD - 3.4ghz i5 CPU, 16gb RAM, 512gb SSD','prebuilt')).toBe('office_pc');
    expect(code('Dell XPS 15 9530 Laptop – i7 / 32GB RAM / RTX 4050 / 512GB SSD','laptop')).toBe('keep');
    expect(code('Desktop PC','prebuilt','Ryzen 5 5600X, RTX 3060 12GB, 32GB RAM')).toBe('keep');
    expect(code('Ryzen 7950x ITX PC','prebuilt')).toBe('keep');
    expect(code('Gaming PC','prebuilt')).toBe('keep');
  });
  test('parts are never mistaken for office computers',()=>{
    expect(code('850w PSU (Power Supply) for PC - EVGA 850 GQ 80 Plus Gold','prebuilt')).toBe('keep');
    expect(code('DeepCool UD551 ARGB CPU Cooler 136mm Fan AMD AM4 AM5 Top-Flow Heatsink PC Fan','prebuilt')).toBe('keep');
    expect(code('Corsair RM850x','unknown')).toBe('keep');
    expect(code('64gb DRR5 Ripjaws G SKILL Ripjaws 5333mhz','unknown')).toBe('keep');
    expect(code('WD Blue SN580 1TB','unknown')).toBe('keep');
  });
  test('the 2020 cutoff: the newest named part decides',()=>{
    expect(code('White RGB Gaming PC – GTX 1080 Ti 11GB / i7-8700 / 32GB RAM','prebuilt')).toBe('old_computer');
    expect(code('2K Gaming PC: Core i9 10900k, factory-binned Aorus RTX 3080 XTREME','prebuilt')).toBe('keep');
    expect(code('Gaming PC i7-4770','prebuilt','Upgraded from a GTX 1060 to an RTX 3070 last year.')).toBe('keep');
    expect(code('Alienware 15 R3 Gaming Laptop – i7-7700HQ / GTX 1060 6GB / 16GB RAM','laptop')).toBe('old_computer');
    expect(code('Sapphire RX 580 8GB','gpu')).toBe('old_gpu');
    expect(code('GeForce Gtx 1660 super graphics card','gpu')).toBe('keep');
    expect(code('Intel Core i5-9400F 6-Core 2.90GHz LGA 1151 CPU Processor','component')).toBe('old_cpu');
    expect(code('Intel Core i5-10400 CPU • LGA1200','component')).toBe('keep');
    expect(code('Corsair Vengeance 16GB DDR3 1600','ram')).toBe('old_memory');
    expect(code('MSI Z390-A PRO','motherboard')).toBe('old_platform');
    expect(code('ASUS ROG Strix B550-F Gaming WiFi','motherboard')).toBe('keep');
  });
  test('Macs: Apple Silicon is in, Intel Macs are out, an unknown year is kept',()=>{
    expect(code('2020 Apple MacBook Pro 13” A2251 Core i7 2.3GHz 16GB RAM','laptop')).toBe('old_mac');
    expect(code('MacBook Pro 16 inch Retina 2019','laptop')).toBe('old_mac');
    expect(code('27 inch iMac 2020','prebuilt')).toBe('old_mac');
    expect(code('Apple Mac Pro M2 Ultra 24-core CPU and 76-Core GPU (mid 2023 4tb)','prebuilt')).toBe('keep');
    expect(code('MacBook Air 2020','laptop')).toBe('keep');
    expect(code('Mac Mini 2023 M2','prebuilt')).toBe('keep');
  });
  test('era readers',()=>{
    expect(new Set(gpuEras('RTX 3080 and a spare GTX 970'))).toEqual(new Set(['new','old']));
    expect(gpuEras('Ryzen 5 7600X')).toEqual([]);
    expect(cpuEras('i5-1335U, i7-1165G7, i7-10700K, i7-8700')).toEqual(['new','new','new','old']);
    expect(macEra('MacBook Air 13 M2 8GB')).toBe('new');
    expect(macEra('MacBook Air M.2 SSD upgrade')).toBeNull();
  });
});

test('the engine returns OUT_OF_SCOPE for out-of-scope listings before any valuation',()=>isolated(`
  import {checkFetched} from '@/src/engine/index.ts';
  globalThis.fetch=async()=>{throw new Error('network forbidden');};
  const listing=(id,title,description,ask)=>({source:'offerup',sourceId:id,url:'https://offerup.com/item/detail/'+id,title,description,askingPriceCents:ask,location:null,postedAt:null,updatedAt:null,photoUrls:[],attributes:{},raw:{}});
  for(const [title,headline] of [['iPhone 17 Pro Max 256GB','Phones are out of scope.'],['Dell OptiPlex 9020 i7-4770 8GB','Office and basic Windows computers are out of scope.'],['EVGA GTX 1080 8GB','Graphics card older than the 2020 cutoff.']]){
    const r=await checkFetched(listing(title,title,'Works great.',20000),{persist:false,vision:false});
    assert.equal(r.verdict.call,'OUT_OF_SCOPE',title);assert.equal(r.verdict.headline,headline);
  }
  const kept=await checkFetched(listing('rtx','EVGA RTX 3080 FTW3 10GB','Works great.',40000),{persist:false,vision:false});
  assert.notEqual(kept.verdict.call,'OUT_OF_SCOPE');
`));
