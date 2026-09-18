import {queryForSku} from './ebay.ts';
export function exactDemandQuery(s:{brand:string;model:string;category:string},a:Record<string,string|number>) {
 const query=queryForSku(s);if(!['laptop','phone','tablet','prebuilt'].includes(s.category))return query;
 const capacity=(n:string|number)=>Number(n)%1024===0?`${Number(n)/1024}TB`:`${n}GB`;
 return [query,...(['laptop','prebuilt'].includes(s.category)?[a.cpu,a.gpu,a.ram_gb?`${a.ram_gb}GB RAM`:null]:[]),a.storage_gb?`${capacity(a.storage_gb)}${['laptop','prebuilt'].includes(s.category)?' SSD':''}`:null,...(s.category==='laptop'?[a.screen_inches?`${a.screen_inches}-inch`:null,a.gpu_cores?`${a.gpu_cores}-core GPU`:null]:[])].filter(Boolean).join(' ');
}
