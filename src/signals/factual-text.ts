/** Retain original seller prose for condition/risk analysis. This narrower view
 * is only for identity/spec claims about the current item, never trade wishes. */
export function factualText(text:string):string {
  return text.split(/(?<=[.!?;])\s+|\r?\n/).map(line=>{
    line=line.replace(/\b(?:storage|ram)\s+(?:is|:)\s*either\s+\d+\s*(?:GB|TB)\s+or\s+\d+\s*(?:GB|TB)[^.;]*/gi,'');
    line=line.replace(/\b(?:upgraded|switched|changed)\s+from\s+.+?\s+to\s+/gi,'');
    line=line.replace(/\b(?:looking to trade for|will trade for|would trade for|want to trade for|looking for|wanted|compatible with|supports?|works with|used to (?:have|use)|previously (?:had|used)|originally (?:had|came with))\b[^.!?;]*/gi,'');
    line=line.replace(/\b(?:no|without|does not (?:have|include)|doesn't (?:have|include)|not including|removed)\s+(?:(?:an?|the)\s+)?(?:rtx|gtx|rx|ryzen|intel core|i[3579])\b[^,;.!?]*/gi,'');
    return line;
  }).join('\n');
}
export interface TextFact {field:string;value:string;quote:string;source:'seller-text'}
/** Quotes are retained even when mutually inconsistent; never silently choose
 * one of two distinct components to make a valuation possible. */
export function textFacts(text:string):{facts:TextFact[];conflicts:string[]} {
  const clean=factualText(text),facts:TextFact[]=[];
  const patterns:Record<string,RegExp>={
    cpu:/\b(?:i[3579][- ]\d{4,5}[a-z0-9]*|ryzen\s+[3579]\s+\d{4}[a-z0-9]*)\b/gi,
    gpu:/\b(?:rtx|gtx|rx)\s?\d{3,4}\s*(?:ti\s*super|super|ti|xtx|xt)?\b/gi,
    ram:/\b\d{1,3}\s*(?:gb|gigs?)\s*(?:of\s*)?(?:ram|memory|ddr[345])\b/gi,
    storage:/\b\d{1,4}\s*(?:gb|tb)\s*(?:ssd|hdd|nvme|storage)\b/gi,
    kitLayout:/\b\d+\s*[x×]\s*\d+\s*gb\b/gi,
    ecc:/\b(?:non[- ]ecc|ecc|registered|unbuffered|rdimm|udimm|sodimm)\b/gi,
    phoneModel:/\biphone\s*\d{1,2}(?:\s*(?:pro\s*max|pro|plus|mini))?\b/gi,
  };
  for(const [field,re] of Object.entries(patterns))for(const m of clean.matchAll(re))facts.push({field,value:m[0].trim().toLowerCase().replace(/\s+/g,' '),quote:m[0].trim(),source:'seller-text'});
  const conflicts:string[]=[];
  for(const field of ['cpu','gpu','phoneModel']){
    const values=[...new Set(facts.filter(f=>f.field===field).map(f=>f.value.replaceAll(' ','')))];
    // Base and suffixed variants are different products. A seller may have
    // shortened a title, but that is not proof that conflicting names agree.
    if(values.length>1)conflicts.push(field);
  }
  const ecc=facts.filter(f=>f.field==='ecc').map(f=>f.value);
  if(ecc.some(v=>/^non/.test(v))&&ecc.includes('ecc'))conflicts.push('ecc');
  return {facts,conflicts};
}
