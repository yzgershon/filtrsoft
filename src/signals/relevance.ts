/**
 * What Yish trades. His call on 2026-09-24, after seeing the feed fill with
 * phone cases, iPhone 8s, i7-4770 OptiPlexes and a tower heater:
 *
 *   keep  GPUs and gaming PCs, laptops and MacBooks, PC parts
 *   drop  phones, tablets and wearables; accessories; generic Windows
 *         computers without a gaming GPU; anything older than about 2020
 *         (Intel 10th gen / Ryzen 3000 / RTX 20 and GTX 16 / RX 5000 / Apple M1)
 *
 * This is a market decision, not a valuation: the engine could price an
 * iPhone 11, Yish just does not want to buy one. Unknown age is kept, so a
 * listing is only dropped on evidence. When a listing names several parts, the
 * NEWEST one decides ("upgraded from a GTX 1060 to an RTX 3070" is kept).
 */
export type RelevanceCode='phone'|'tablet'|'wearable'|'accessory'|'not_tech'|'not_ours'|'office_pc'|'old_computer'|'old_gpu'|'old_cpu'|'old_mac'|'old_memory'|'old_platform';
export type Relevance={keep:true}|{keep:false;code:RelevanceCode;headline:string;reason:string};
export const RELEVANCE_POLICY='Yish, 2026-09-24';

const PHONE=/\b(i ?phone|galaxy\s+(?:s|note|a|z\s?(?:fold|flip))\s?\d|galaxy\s+z\s?(?:fold|flip)|pixel\s+(?:\d{1,2}|eight|nine|ten)(?:\s?a|\s?pro|\s?xl)?\b|oneplus|moto\s?g|motorola|cell\s?phone|smart\s?phone|android phone|flip phone|samsung\s+(?:galaxy\s+)?[sa]\d{2}\b|blu\s+(?:view|studio|g\d))\b/i;
const TABLET=/\b(ipad|galaxy\s+tab|surface\s+go|kindle|fire\s+hd|fire\s+tablet|tablet)\b/i;
const WEARABLE=/\b(apple\s+watch|galaxy\s+watch|pixel\s+watch|smart\s?watch|air\s?pods|pixel\s+buds|galaxy\s+buds|fitbit|earbuds|vr\s+headset|oculus|meta\s+quest|quest\s+[123]|htc\s+vive|valve\s+index|daydream)\b/i;
// Accessory nouns make the ACCESSORY the item unless the title bundles it with
// a device ("MacBook Air M2 with case and charger" is a MacBook).
const ACCESSORY=/\b(cases?|covers?|screen\s+protectors?|tempered\s+glass|stickers?|decals?|skins?|grips?|holsters?|chargers?|charging\s+(?:cables?|pads?|stands?)|cables?|adapters?|docks?|docking\s+station|stands?|mounts?|sleeves?|bags?|backpacks?|privacy\s+screens?|stylus|apple\s+pencil|pop\s?sockets?|wallets?|keyboards?|mouse|mice|mouse\s?pads?|desk\s?mats?|headsets?|headphones|webcams?|speakers?|microphones?|monitors?|superdrive)\b/i;
const ACCESSORY_MAKER=/^\s*(otterbox|spigen|dbrand|mous|speck|kate\s+spade|loopy|casetify|zagg|incase|uag|lifeproof|belkin|anker)\b/i;
const STRONG_BUNDLE=/\b(?:with|includes?|including|comes?\s+with|plus)\b|\bw\/|\+/i;
// "... Keyboard & Mouse Included" names the bundle after the accessory.
const INCLUDED=/\b(included|incl\.?|comes\s+with)\b/i;
const NOT_OURS_MEDIA=/\b(sdhc|sdxc|micro\s?sd|sd\s+cards?|memory\s+cards?|flash\s+drives?|thumb\s+drives?|usb\s+(?:stick|drive))\b/i;
const WEAK_BUNDLE=/\b(and|in|inside)\b|[&,\/|–—]|\s-\s/i;
const BUNDLE_DEVICE=/\b(pc|computer|desktop|laptop|notebook|tower|build|rtx|gtx|rx\s?\d{3,4}|ryzen|i[3579]|ddr[45]|m[1-5]|\d+\s?(?:gb|tb))\b/i;
// A box on its own ("Apple MacBook Air 13\" box"), not "in box" or "original box".
const ONLY_BOX=/\b(?:empty\s+)?box(?:es)?(?:\s+only)?\s*[.!]*$/i;
const PC_CASE=/\b(pc|computer|atx|itx|tower|chassis)\s+cases?\b/i;
const FURNITURE=/\b(desks?|chairs?|tables?|shelf|shelves|cabinet|stool)\b/i;
const NOT_TECH=/\b(heaters?|humidifier|dehumidifier|air\s+fryer|vacuum|blender|microwave|mini\s+fridge|refrigerator|trim\s+pcs|bike|bicycle|furniture|lamp|food\s+processor|jenga|radio|walkie|recorder)\b/i;

// Gaming lines, boutique builders and enthusiast desktop CPUs (a Ryzen 7950X
// ITX build is a custom PC even before its GPU is named).
const GAMING=/\b(gaming|gamer|alienware|rog|strix|tuf|legion|omen|predator|nitro|katana|raider|stealth|razer|aorus|victus|zephyrus|helios|ibuypower|cyberpower|skytech|nzxt|origin\s+pc|maingear|xotic|digital\s+storm|aurora|custom|built|build|rgb|water\s?cooled|liquid\s+cooled|workstation|ryzen\s?(?:[579]\s?)?\d{4}x3?d?|i[579][\s-]?\d{4,5}kf?s?|threadripper)\b/i;
// Titles that name a PC part as the item, whatever category "for PC" suggested.
const PART=/\b(power\s+supply|psu|cpu\s+cooler|coolers?|heatsink|aio|\w*fans?|motherboard|mobo|ram|d[dr]r[345]l?|memory|so-?dimm|dimm|pc[2345]l?-\d{4,5}\w*|solid\s+state|hard\s?(?:disk|drive)|ryzen|core\s+i[3579]|i[3579]-\d{4,5}\w*|xeon|threadripper|ripjaws|trident\s+z|vengeance|dominator|ballistix|ssd|nvme|m\.2|hdd|sn\d{3,4}|[89]\d0\s?(?:pro|evo)|mp[56]00|firecuda|graphics\s+card|video\s+card|processor|cpu|corsair\s+(?:rm|hx|rmx|sf|cx)\d{3,4}x?|\d{3,4}\s?w(?:att)?|\d{1,2}\s?tb|pc\s+parts|computer\s+parts)\b/i;
const COMPUTER=/\b(laptop|notebook|pc|computer|desktop|tower|workstation|chromebook|ultrabook|predator|zephyrus|rog|legion|omen|alienware|nitro|tuf|katana|raider|razer\s+blade|mini\s+pc|nuc)\b/i;
const APPLE=/\b(macbook|imac|mac\s?mini|mac\s?studio|mac\s?pro|apple)\b/i;
const NOT_APPLE=/\b(rtx|gtx|radeon|windows|dell|hp|lenovo|asus|acer|msi)\b/i;

type Era='new'|'old';
const newest=(eras:Era[]):Era|null=>eras.length?(eras.includes('new')?'new':'old'):null;

/** Every GPU a text names, as eras. GTX 16 and RTX 20 (2018-19) are the oldest kept. */
export function gpuEras(text:string):Era[] {
  const t=text.toLowerCase(),out:Era[]=[];
  // Every RTX card is 2018 or newer; GTX 16xx is kept, GTX 10xx and older are not.
  for(const m of t.matchAll(/\b(rtx|gtx|gt)\s?-?(\d{3,4})\b/g)){const n=Number(m[2]);out.push(m[1]==='rtx'||n>=1600&&n<2000?'new':'old');}
  for(const _ of t.matchAll(/\brtx\s?a\d{3,4}\b|\bquadro\s+rtx\b/g))out.push('new');
  for(const _ of t.matchAll(/\bquadro\s+(?:[kmp]\d{3,4}|fx|nvs)\b/g))out.push('old');
  for(const m of t.matchAll(/\b(?:rx|radeon(?:\s+rx)?)\s?(\d{3,4})\s?(?:xtx|xt|gre)?\b/g))out.push(Number(m[1])>=5000?'new':'old');
  for(const _ of t.matchAll(/\b(?:r[579]\s?\d{3}x?|hd\s?[2-8]\d{3}(?!\s?x)|vega\s?(?:56|64)|firepro)\b/g))out.push('old');
  for(const _ of t.matchAll(/\barc\s?[ab]\d{3}\b|\bradeon\s+vii\b/g))out.push('new');
  // Bare numbers are how sellers write GPUs ("Gaming PC 3060", "7900xtx").
  for(const _ of t.matchAll(/(?<![\w-])(?:1650|1660|2060|2070|2080|3050|3060|3070|3080|3090|4060|4070|4080|4090|5060|5070|5080|5090)(?:\s?ti|\s?super)?(?![\w-])/g))out.push('new');
  for(const _ of t.matchAll(/(?<![\w-])(?:6600|6650|6700|6750|6800|6900|6950|7600|7700|7800|7900|9060|9070)\s?xtx?(?![\w-])/g))out.push('new');
  return out;
}

/** Every CPU a text names, as eras. Intel 10th gen and Ryzen 3000 are the oldest kept. */
export function cpuEras(text:string):Era[] {
  const t=text.toLowerCase(),out:Era[]=[];
  // Five digits (10700) is 10th gen or newer; four-digit mobile parts 10xx-14xx
  // (1035G1, 1165G7, 1335U) are 10th-14th gen; any other four digits is older.
  for(const m of t.matchAll(/\bi[3579][\s-]?(\d{4,5})[a-z]{0,3}\d?\b/g)){const d=m[1]!;out.push(d.length===5||/^1[0-4]/.test(d)?'new':'old');}
  for(const m of t.matchAll(/\b(\d{1,2})(?:th|st|nd|rd)\s+gen(?:eration)?\b/g)){const n=Number(m[1]);if(n>=2&&n<=20)out.push(n>=10?'new':'old');}
  // Suffixes can carry digits: 7800X3D, 5800X3D.
  for(const m of t.matchAll(/\bryzen\s?(?:[3579]|threadripper)?\s?(?:pro\s+)?(\d{4})[a-z0-9]{0,4}\b/g))out.push(Number(m[1])>=3000?'new':'old');
  for(const _ of t.matchAll(/\bcore\s+ultra\b|\bapple\s+m[1-5]\b/g))out.push('new');
  for(const _ of t.matchAll(/\b(?:core\s?2\s?(?:duo|quad)|pentium|celeron|atom|athlon\s+(?:ii|64|x2)|phenom|fx[\s-]\d{4}|a(?:8|10|12)-\d{4}|xeon\s+(?:e[357]-\d{4}|x\d{4}|w35\d\d))\b/g))out.push('old');
  return out;
}

const INTEL_MAC_MODEL=/\ba(1224|1225|1278|1286|1297|1311|1312|1347|1369|1370|1398|1418|1419|1425|1465|1466|1502|1534|1706|1707|1708|1932|1989|1990|1993|2115|2116|2141|2159|2179|2251|2289)\b/i;
/** Apple: Apple Silicon is kept; Intel Macs are dropped when the listing shows it. */
export function macEra(title:string):Era|null {
  const t=title.toLowerCase();
  if(/\bm[1-5](?:\s?(?:pro|max|ultra))?\b/.test(t)&&!/\bm[1-5]\s?(?:screws?|ssd|nvme|slots?)\b/.test(t))return 'new';
  if(INTEL_MAC_MODEL.test(t)||/\b(?:intel|core\s+i[3579]|i[3579](?:\b|[\s-]\d)|touch\s?bar|(?:mid|late|early)[- ]20(?:0\d|1\d)|macintosh|powerbook|ibook|power\s?mac)/.test(t))return 'old';
  const years=[...t.matchAll(/\b(20[0-2]\d)\b/g)].map(m=>Number(m[1]));
  // There was no Apple Silicon iMac before 2021; a 2020 MacBook or Mac mini may be either.
  if(years.length){const y=Math.max(...years);if(y>=2021)return 'new';if(y<=2019||y===2020&&/\bimac\b/.test(t))return 'old';}
  return null;
}

const OLD_MEMORY=/\bddr[23]l?\b|\bpc3[l-]?\s?-?\d{4,5}\b/i;
const NEW_MEMORY=/\bddr[45]\b|\bpc[45]-\d{4,5}\b/i;
const OLD_BOARD=/\b(?:[zbhq][1-3][0-9]0|x[5-9]9|lga\s?(?:775|1150|1151|1155|1156|2011|1366)|am3\+?|fm2\+?|a320|b350|x370|990fx)\b/i;
const NEW_BOARD=/\b(?:[zbhw][4-8]\d0[em]?|x[5-8]70e?|b[5-8]50e?|a[5-6]20|trx[45]0|am[45]|lga\s?(?:1200|1700|1851))\b/i;

const drop=(code:RelevanceCode,headline:string,reason:string):Relevance=>({keep:false,code,headline,reason});
const OLDER='Filtrsoft carries hardware from about 2020 on (Intel 10th gen, Ryzen 3000, GeForce RTX 20 / GTX 16, Radeon RX 5000, Apple M1 and newer). Yish set that cutoff on 2026-09-24.';

/**
 * `category` is the engine's own detectCategory result. `description` is only
 * consulted for CPU/GPU evidence when the title names none, and the newest
 * part mentioned anywhere still wins.
 */
export function relevance(input:{title:string;description?:string|null;category:string}):Relevance {
  // Marketplace titles arrive with non-breaking and zero-width spaces
  // ("Lenovo Legion Go"); every pattern here expects plain spaces.
  const clean=(s:string)=>s.normalize('NFKC').replace(/[​-‍﻿]/g,'').replace(/\s+/g,' ').trim();
  const title=clean(input.title??''),desc=clean(input.description??''),cat=input.category;
  // A bundle keeps the device: "with/+/includes" always; "and/&/in/," only after a computer or a spec.
  const bundled=(before:string)=>STRONG_BUNDLE.test(before)||WEAK_BUNDLE.test(before)&&BUNDLE_DEVICE.test(before)||INCLUDED.test(title);
  if(NOT_OURS_MEDIA.test(title))return drop('not_ours','Not something Filtrsoft carries.','Memory cards and flash drives are not something Filtrsoft carries (Yish, 2026-09-24).');
  const furniture=FURNITURE.exec(title);
  // Furniture needs an explicit bundle: "Gaming, Computer, Work Desk" is a desk.
  if(furniture&&!STRONG_BUNDLE.test(title.slice(0,furniture.index))||NOT_TECH.test(title)&&!/\b(pc|computer|laptop|gpu|graphics)\b/i.test(title.replace(NOT_TECH,'')))
    return drop('not_tech','Not computer hardware.',`"${title.slice(0,60)}" is not something Filtrsoft carries.`);
  if(WEARABLE.test(title))return drop('wearable','Wearables and VR headsets are out of scope.','Yish does not flip watches, earbuds or VR headsets (his call on 2026-09-24).');
  // Blanked (same length) so match positions still index the title.
  const acc=ACCESSORY.exec(title.replace(/\bcables?\s+management\b|\bcase\s+fans?\b/gi,m=>' '.repeat(m.length)));
  const onlyBox=ONLY_BOX.test(title)&&!PART.test(title)&&!/\b(?:in|with|w\/|original|orig|sealed|new|retail|open|nib|no|without|w\/o|missing)\s+(?:the\s+)?(?:original\s+|retail\s+)?box(?:es)?\s*[.!]*$/i.test(title);
  if(cat!=='case'&&!PC_CASE.test(title)&&(ACCESSORY_MAKER.test(title)||acc&&!bundled(title.slice(0,acc.index))||onlyBox))
    return drop('accessory','Accessory, not the device.',`Filtrsoft carries the hardware itself, not ${acc?.[0]?.toLowerCase()??'accessories'}.`);
  // A 21-inch-plus screen with no computer named is a monitor or a TV.
  const screen=Number(/\b(\d{2}(?:\.\d)?)\s*(?:"|”|″|inch|in\b|-inch)/i.exec(title)?.[1]??0);
  if(screen>=21&&!APPLE.test(title)&&!PART.test(title)&&!BUNDLE_DEVICE.test(title)&&!/\b(pc|computer|desktop|laptop|tower|rtx|gtx|all[- ]in[- ]one)\b/i.test(title))
    return drop('not_ours','Monitors are not something Filtrsoft carries.','Filtrsoft carries GPUs and gaming PCs, laptops and MacBooks, and PC parts (Yish, 2026-09-24).');
  if(cat==='tablet'||TABLET.test(title)&&cat!=='laptop'&&cat!=='prebuilt')return drop('tablet','Tablets are out of scope.','Yish does not flip tablets (his call on 2026-09-24).');
  if(cat==='phone'||PHONE.test(title)&&!['laptop','prebuilt','gpu'].includes(cat))return drop('phone','Phones are out of scope.','Yish does not flip phones (his call on 2026-09-24).');

  // An uncategorised listing needs positive evidence of something Yish carries.
  let kind=cat;
  // A part category read from the description alone ("Synology DS720+ ... Quad
  // core CPU ... 6GB RAM" became a CPU) still needs part evidence in the title.
  if(['component','ram','storage','psu','motherboard'].includes(kind)&&!PART.test(title)&&!OLD_BOARD.test(title)&&!NEW_BOARD.test(title)&&!gpuEras(title).length&&!cpuEras(title).length)kind='unknown';
  if(kind==='unknown'||kind==='console'){
    if(gpuEras(title).length)kind='gpu';
    else if(APPLE.test(title)||COMPUTER.test(title))kind='prebuilt';
    else if(cpuEras(title).length)kind='component';
    else if(!PART.test(title))return drop('not_ours','Not something Filtrsoft carries.','Filtrsoft carries GPUs and gaming PCs, laptops and MacBooks, and PC parts (Yish, 2026-09-24).');
  }
  // "850W PSU for PC" and "CPU cooler, PC fan" are parts even when the words suggested a computer.
  // A spec line ("i5 CPU, 16GB RAM, 512GB SSD") does not make a computer a part:
  // only titles that name no computer once "for PC"-style phrases are removed.
  const withoutPcPhrases=title.replace(/\b(?:for|pc)\s+(?:pc|fans?|cases?|power\s+supply|parts|cooling)\b|\bpc\s+(?:fans?|cases?|power\s+supply|parts|cooling)\b/gi,' ');
  if(kind==='prebuilt'&&PART.test(title)&&gpuEras(title).length===0&&!COMPUTER.test(withoutPcPhrases)&&!APPLE.test(title)&&!/\b(optiplex|elitedesk|prodesk|thinkcentre|precision|vostro)\b/i.test(title))return {keep:true};
  if(kind==='ram')return OLD_MEMORY.test(title)&&!NEW_MEMORY.test(title)?drop('old_memory','DDR3 and older memory is out of scope.',OLDER):{keep:true};
  if(kind==='motherboard')return OLD_BOARD.test(title)&&!NEW_BOARD.test(title)?drop('old_platform','Motherboard platform older than the 2020 cutoff.',OLDER):{keep:true};
  if(kind==='gpu'){
    const era=newest(gpuEras(title))??newest(gpuEras(desc));
    return era==='old'?drop('old_gpu','Graphics card older than the 2020 cutoff.',OLDER):{keep:true};
  }
  if(kind==='component')return newest(cpuEras(title))==='old'?drop('old_cpu','Processor older than the 2020 cutoff.',OLDER):{keep:true};
  if(kind==='laptop'||kind==='prebuilt'||APPLE.test(title)){
    if(APPLE.test(title)&&!NOT_APPLE.test(title))
      return macEra(title)==='old'?drop('old_mac','Intel-era Mac.','Only Apple Silicon Macs (M1 and newer) are in scope; Intel Macs are older than the 2020 cutoff Yish set on 2026-09-24.'):{keep:true};
    const gpus=gpuEras(title),cpus=cpuEras(title);
    const gpu=newest(gpus.length?gpus:gpuEras(desc)),cpu=newest(cpus.length?cpus:cpuEras(desc));
    // Business laptop generations sellers name instead of a CPU: ThinkPad
    // T420-T490 / X220-X390 / W5x0 (2011-2019), Latitude E-series, Precision M.
    if(gpu!=='new'&&cpu!=='new'&&/\bthink\s?pad\s+(?:[txwl]\d{3}[a-z]?|p5[0-3]s?|p7[0-3])\b|\blatitude\s+e\d{4}\b|\bprecision\s+m\d{4}\b/i.test(title))
      return drop('old_computer','Computer older than the 2020 cutoff.',OLDER);
    if(!GAMING.test(title)&&gpu===null)
      return drop('office_pc','Office and basic Windows computers are out of scope.','No gaming GPU is listed. Yish carries gaming PCs and laptops, MacBooks and parts, not business or basic Windows machines (his call on 2026-09-24).');
    if(gpu!=='new'&&cpu!=='new'&&(gpu==='old'||cpu==='old'))return drop('old_computer','Computer older than the 2020 cutoff.',OLDER);
  }
  return {keep:true};
}
