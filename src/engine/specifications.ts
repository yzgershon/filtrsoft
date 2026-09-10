import type {DecisionProvenance} from './provenance.ts';

export interface SpecEvidence { value:string; source:'title'|'description'|'attribute'|'photo'; quote:string; confidence?:string; photo?:string }
export interface Specification { key:string; label:string; state:'reported'|'multiple'|'unknown'; values:SpecEvidence[] }
export interface Specifications { fields:Specification[]; photoStatus:'recorded'|'not_read'; notes:string[]; attributes:Array<{label:string;value:string}> }
const labels:Record<string,string>={model:'Model',cpu:'Processor',gpu:'Graphics',ram:'Memory',storage:'Storage',motherboard:'Motherboard',psu:'Power supply',display:'Display',battery:'Battery health',carrier:'Carrier / SIM lock',os:'Operating system',condition:'Condition',vram:'Graphics memory',cooling:'Cooling',case:'Case',connectivity:'Connectivity'};
const expected:Record<string,string[]>={prebuilt:['cpu','gpu','ram','storage','motherboard','psu','cooling','case'],laptop:['model','cpu','gpu','ram','storage','display','battery'],phone:['model','storage','battery','carrier','display'],tablet:['model','storage','display','battery','connectivity'],gpu:['gpu','vram'],ram:['ram'],storage:['storage'],psu:['psu'],motherboard:['motherboard'],case:['case']};
const aliases:Record<string,string>={processor:'cpu','processor type':'cpu','cpu model':'cpu','graphics':'gpu','graphics card':'gpu','video card':'gpu',memory:'ram','memory size':'ram','ram size':'ram','hard drive':'storage','drive':'storage','storage capacity':'storage','storage_tier':'storage','screen':'display','screen size':'display','battery health':'battery','battery capacity':'battery','operating system':'os','make / manufacturer':'brand','model name / number':'model','model number':'model','power supply':'psu','network':'carrier','sim lock':'carrier'};
const norm=(s:string)=>s.toLowerCase().replace(/[®™]/g,'').replace(/\s+/g,' ').trim();
const identity=(key:string,value:string)=>{let n=norm(value).replace(/[.,;]+$/, '');if(key==='gpu')n=n.replace(/^(?:nvidia\s+)?(?:geforce\s+)?(?=(?:rtx|gtx)\s)/,'');return n;};
const optional=/\b(?:used to|previously|upgrad(?:e|ing|able)|up to|supports?|compatible|looking for|want(?:ed)?|trade for|optional|can add|not included|not installed|sold separately)\b/i;

/** Presentation of recorded evidence, never a second SKU resolver. All matches
 * retain their literal source. No "largest GB" fallback, catalog defaults,
 * silent first-value selection or stale vision lookup is allowed here. */
export function specifications(proof:DecisionProvenance|null|undefined):Specifications {
  const category=proof?.signals?.category??'unknown', fields=new Map<string,SpecEvidence[]>(), notes:string[]=[];
  const add=(key:string,value:string,source:SpecEvidence['source'],quote:string,extra:Partial<SpecEvidence>={})=>{
    value=value.trim();if(!value||/^(?:n\/?a|unknown|not stated|null)$/i.test(value))return;
    const list=fields.get(key)??[];
    if(!list.some(e=>norm(e.value)===norm(value)&&e.source===source&&e.quote===quote))list.push({value,source,quote,...extra});
    fields.set(key,list);
  };
  const patterns:Array<[string,RegExp]>=[
    ['model',/\b(?:iPhone\s+(?:\d{1,2}(?:\s+(?:Pro\s+Max|Pro|Plus|Mini|Air))?|SE(?:\s*\(\d{4}\))?)|(?:Samsung\s+)?Galaxy\s+(?:S\d{1,2}(?:\s+(?:Ultra|Plus|FE))?|Z\s*(?:Flip|Fold)\s*\d)|(?:Google\s+)?Pixel\s+\d{1,2}[a-z]?(?:\s+(?:Pro\s+XL|Pro|Fold))?|(?:Apple\s+)?MacBook\s+(?:Air|Pro)(?:\s+\d{2}(?:[- ]inch)?)?|(?:Dell\s+)?(?:Latitude|OptiPlex|Precision|XPS)\s+\d{2,4}|(?:Lenovo\s+)?ThinkPad\s+[A-Z]\d{1,3}(?:\s+Gen\s+\d{1,2})?)\b/gi],
    ['cpu',/\b(?:(?:Intel\s+)?(?:Core\s+)?i[3579][- ]\d{4,5}[a-z0-9]*|(?:AMD\s+)?Ryzen\s+[3579]\s+\d{4}[a-z0-9]*|AMD\s+\d{4}(?:X3D|XT|X|G|GE|F|HX|HS|H|U)?|(?:Apple\s+)?M[1-9](?:\s+(?:Pro|Max|Ultra))?|Core\s+Ultra\s+[579]\s+\d{3}[a-z]*|Xeon\s+[a-z0-9-]+)\b/gi],
    ['gpu',/\b(?:(?:(?:NVIDIA|AMD|Radeon|GeForce)\s+)*(?:RTX|GTX|RX)\s?\d{3,4}\s*(?:Ti\s*Super|Super|Ti|XTX|XT)?|Intel\s+(?:UHD|HD|Iris(?:\s+Xe)?)\s*(?:Graphics\s*)?\d{0,4}|(?:Intel\s+)?Arc\s+[AB]\d{3}|(?:Radeon\s+)?Vega\s+\d{1,2}|integrated graphics|no dedicated (?:GPU|graphics))\b/gi],
    ['ram',/\b(?:(?:\d{1,2}\s*[x×]\s*)?\d{1,3}(?:\.\d)?\s*GB\s*(?:(?:DDR[345]|LPDDR[345]X?)\s*(?:[- ]?\d{3,5})?\s*)?(?:RAM|memory)(?:\s*\(\s*\d+\s*[x×]\s*\d+\s*GB\s*\))?|(?:\d{1,2}\s*[x×]\s*)?\d{1,3}\s*GB\s+(?:DDR[345]|LPDDR[345]X?)(?:[- ]\d{3,5})?(?:\s+(?:ECC|NON-ECC|RDIMM|UDIMM|registered))?|(?:RAM|memory)\s*[:=]\s*(?:\d{1,2}\s*[x×]\s*)?\d{1,3}(?:\.\d)?\s*GB(?:\s+DDR[345])?)\b/gi],
    ['storage',/\b(?:(?:\d+\s*[x×]\s*)?\d+(?:\.\d+)?\s*(?:TB|GB)\s*(?:NVMe\s+SSD|NVMe|SSD|HDD|hard (?:drive|disk)|storage|eMMC)|(?:storage|SSD|HDD|NVMe)\s*[:=]?\s*\d+(?:\.\d+)?\s*(?:TB|GB))\b/gi],
    ['display',/\b(?:\d{1,2}(?:\.\d)?\s*(?:inch|inches|["″])(?:\s*(?:OLED|AMOLED|IPS|LCD|Retina))?|(?:\d{3,4}\s*[x×]\s*\d{3,4})(?:\s*\d{2,3}\s*Hz)?|\d{2,3}\s*Hz\s*(?:display|screen))\b/gi],
    ['battery',/\b(?:battery(?:\s+health|\s+capacity)?\s*[:=]?\s*\d{1,3}\s*%|\d{1,3}\s*%\s*battery(?:\s+health)?|\d{1,5}\s*(?:battery\s*)?cycles)\b/gi],
    ['os',/\b(?:Windows\s+(?:10|11)(?:\s+(?:Pro|Home))?|macOS\s+[a-z0-9.]+|Ubuntu\s+\d+[.\d]*|ChromeOS|iOS\s+\d+[.\d]*)\b/gi],
    ['vram',/\b(?:\d{1,2}\s*GB\s*(?:GDDR[567]X?|VRAM)|VRAM\s*[:=]\s*\d{1,2}\s*GB)\b/gi],
  ];
  for(const [source,text] of [['title',proof?.facts?.title],['description',proof?.facts?.description]] as const) {
    if(!text)continue;
    // Craigslist flattens section headings into the final component row. A real
    // PC ad's "EXTRAS ------" swallowed six accessories into Case and its AIO
    // LCD became the computer's display. Preserve these sections as evidence.
    const separated=text.replace(/\s+(?=(?:extras|accessories|included accessories|seller notes)\s*(?:[-=_]{2,}|:))/gi,'\n');
    for(const original of separated.split(/[\n;]|(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean)) {
      if(/^(?:extras|accessories|included accessories|seller notes)\s*(?:[-=_]{2,}|:)/i.test(original)){notes.push(original);continue;}
      if(optional.test(original)){notes.push(original);continue;}
      for(const line of original.split(/\s+(?=(?:CPU|GPU|processor|graphics card|RAM|memory|storage|SSD|HDD|motherboard|PSU|power supply|cooling|case|display|battery health)\s*[:=])/i).map(s=>s.replace(/[,|]\s*$/, '').trim())) {
      const labelled=line.match(/^\s*([a-z /_-]{2,24})\s*[:=]\s*(.+)$/i);
      const labelledKey=labelled?(aliases[norm(labelled[1])]??norm(labelled[1])):null;
      if(optional.test(line)) { if(patterns.some(([,re])=>{re.lastIndex=0;return re.test(line);}))notes.push(line);continue; }
      for(const [key,re] of patterns)for(const m of line.matchAll(new RegExp(re.source,re.flags))) {
        if(key===labelledKey)continue;
        if(key==='display'&&((labelledKey&&labelledKey!=='display')||(!['laptop','phone','tablet','monitor'].includes(category)&&! /\bmonitor\b/i.test(line))))continue;
        if(key==='cpu'&&/^M[1-9]/i.test(m[0])&&!/\b(?:MacBook|Mac mini|iMac|Mac Pro|iPad|Apple)\b/i.test(`${proof?.facts?.title} ${line}`))continue;
        const before=line.slice(Math.max(0,m.index!-24),m.index!);
        if(/\b(?:no|without|not|missing)\s*$/i.test(before)&&!/^(?:no dedicated)/i.test(m[0])) {notes.push(line);continue;}
        add(key,m[0],source,line);
      }
      // Explicit labelled rows retain every detail, including board brand, kit
      // layout, timings and model suffixes outside the compact token patterns.
      if(labelled) { const name=norm(labelled[1]),key=aliases[name]??name;if(labels[key])add(key,labelled[2],source,line); }
      if(['phone','tablet'].includes(category)) {
        for(const m of line.matchAll(/\b\d{1,4}\s*(?:GB|TB)\b/gi)) {
          const after=line.slice(m.index!+m[0].length),before=line.slice(0,m.index!);
          if(!/^(?:\s*(?:LP?DDR|GDDR|RAM|memory|VRAM))/i.test(after)&&!/\b(?:RAM|memory|VRAM)\s*[:=]\s*$/i.test(before)&&labelledKey!=='ram'&&labelledKey!=='storage')add('storage',m[0],source,line);
        }
        for(const m of line.matchAll(/\b(?:factory unlocked|carrier unlocked|unlocked|locked to\s+(?:AT&T|Verizon|T-Mobile)|(?:AT&T|Verizon|T-Mobile)\s+only)\b/gi)) {
          if(!/\b(?:not|isn't|is not)\s*$/i.test(line.slice(0,m.index!)))add('carrier',m[0],source,line);else notes.push(line);
        }
      }
    }
  }
  }
  const attributes:Array<{label:string;value:string}>=[];
  for(const [label,value] of Object.entries(proof?.facts?.attributes??{})) {
    const key=aliases[norm(label)]??norm(label);
    if(labels[key])add(key,value,'attribute',`${label}: ${value}`);
    else if(!/crypt|delivery|payment|seller|address|phone number/i.test(label))attributes.push({label,value});
  }
  const vision=proof?.visionEvidence;
  for(const [name,value] of Object.entries(vision?.components??{}))if(typeof value==='string') {
    const key=name==='storage_tier'?'storage':name;
    if(labels[key])add(key,value,'photo',`${labels[key]} read from the listing photos`,{confidence:'unrated'});
  }
  // Unstructured photo facts are retained in full, not silently converted to a
  // confirmed field. Their confidence and original photo references stay visible.
  for(const f of vision?.facts??[]) notes.push(`Photo ${f.photo} (${f.confidence} confidence): ${f.fact}`);
  for(const value of vision?.unreadable??[])notes.push(`Unreadable in photo: ${value}`);
  if(!proof)notes.push('No recorded specification evidence is available for this decision.');
  const keys=[...new Set([...(expected[category]??['model']),...fields.keys()])];
  return {fields:keys.map(key=>{const values=fields.get(key)??[];const distinct=new Set(values.map(e=>identity(key,e.value)));return {key,label:labels[key]??key,state:!values.length?'unknown':distinct.size>1?'multiple':'reported',values};}),photoStatus:vision?'recorded':'not_read',notes:[...new Set(notes)],attributes};
}
