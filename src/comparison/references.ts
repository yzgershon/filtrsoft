import type {CompareSide,PartKind} from './types.ts';
// Provider IDs observed in official indexed URLs on 2026-09-09. External
// references only: no benchmark scores are scraped or republished.
const ub:Record<string,[string,string,string?]>={
 'rtx 3070':['Nvidia-RTX-3070','4083'], 'rtx 4070':['Nvidia-RTX-4070','4148'],
 'rtx 3060':['Nvidia-RTX-3060','4105'], 'rtx 3080':['Nvidia-RTX-3080','4080'],
 'rtx 4090':['Nvidia-RTX-4090','4136'], 'rtx 5080':['Nvidia-RTX-5080','4179'],
 'ryzen 7 5800x':['AMD-Ryzen-7-5800X','4085'], 'ryzen 5 7600x3d':['AMD-Ryzen-5-7600X3D','m2342631'],
 'ryzen 7 9800x3d':['AMD-Ryzen-7-9800X3D','m2356328','https://cpu.userbenchmark.com/SpeedTest/2356328/AMD-Ryzen-7-9800X3D-8-Core-Processor'],
 'i5-12400f':['Intel-Core-i5-12400F','4121'],
};
export function externalGamingReference(sides:CompareSide[],kind:PartKind){
 if(!['cpu','gpu'].includes(kind)||!sides.length||sides.some(s=>s.hardware.state!=='identified'||s.hardware.form!=='desktop'))return null;
 const refs=sides.map(s=>ub[s.hardware.identity!.toLowerCase()]);if(refs.some(r=>!r))return null;
 // The Compare route pattern and both product IDs are observed. Never strip
 // suffixes or reuse desktop IDs for laptops to manufacture a link match.
 const url=refs.length===2?`https://${kind}.userbenchmark.com/Compare/${refs[0][0]}-vs-${refs[1][0]}/${refs[0][1]}vs${refs[1][1]}`:refs[0][2]??(!refs[0][1].startsWith('m')&&refs[0][1]!=='4179'?`https://${kind}.userbenchmark.com/${refs[0][0]}/Rating/${refs[0][1]}`:null);
 return url?{url,label:sides.length===2?'Compare on UserBenchmark':'Open UserBenchmark reference',note:kind==='gpu'?'External GPU-family comparison. Board and memory revisions may be pooled. Effective Speed is an index, not measured game FPS.':'External CPU-model comparison. Effective Speed is an index, not measured FPS on these listings.'}:null;
}
export interface ManufacturerReference {url:string;name:string;checkedAt:string;metrics:Record<string,string>;note:string}
const n30='https://www.nvidia.com/en-us/geforce/graphics-cards/30-series/rtx-3070-3070ti/';
const n40='https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4070-family/';
// Reference designs are separate from seller facts and never fill missing
// installed specifications. Every entry was checked against its primary source.
const catalog:Record<string,Omit<ManufacturerReference,'checkedAt'|'note'>>={
 'rtx 3070':{name:'NVIDIA',url:n30,metrics:{architecture:'Ampere',cores:'5,888 CUDA cores',boost:'1.73 GHz',bus:'256-bit',power:'220 W'}},
 'rtx 3070 ti':{name:'NVIDIA',url:n30,metrics:{architecture:'Ampere',cores:'6,144 CUDA cores',boost:'1.77 GHz',bus:'256-bit',power:'290 W'}},
 'rtx 4070':{name:'NVIDIA',url:n40,metrics:{architecture:'Ada Lovelace',cores:'5,888 CUDA cores',boost:'2.48 GHz',bus:'192-bit'}},
 'rtx 4070 ti':{name:'NVIDIA',url:n40,metrics:{architecture:'Ada Lovelace',cores:'7,680 CUDA cores',boost:'2.61 GHz',bus:'192-bit'}},
 'ryzen 7 5800x':{name:'AMD',url:'https://www.amd.com/en/products/processors/desktops/ryzen/5000-series/amd-ryzen-7-5800x.html',metrics:{architecture:'Zen 3',cores:'8 cores / 16 threads',boost:'Up to 4.7 GHz',cache:'32 MB',socket:'AM4',memory:'DDR4',power:'105 W TDP'}},
 'ryzen 5 7600x3d':{name:'AMD',url:'https://www.amd.com/en/products/processors/desktops/ryzen/7000-series/amd-ryzen-5-7600x3d.html',metrics:{architecture:'Zen 4',cores:'6 cores / 12 threads',boost:'Up to 4.7 GHz',cache:'96 MB',socket:'AM5',power:'65 W TDP'}},
};
export function manufacturerReference(side:CompareSide):ManufacturerReference|null{
 if(side.hardware.state!=='identified'||side.hardware.form!=='desktop')return null;
 const ref=catalog[side.hardware.identity!.toLowerCase()];return ref?{...ref,checkedAt:'2026-09-09',note:'Manufacturer reference design, not verified installed specifications. Board clocks, power settings and configuration can vary. Cores and clock speed are not cross-architecture gaming scores.'}:null;
}
