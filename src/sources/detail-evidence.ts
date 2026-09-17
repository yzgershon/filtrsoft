export interface ExtractionReceipt {complete:boolean;truncated:boolean;rawCharacters:number}
/** Partial text can disclose a defect, but cannot certify that none was omitted. */
export function detailCompleteness(text:string,receipt?:ExtractionReceipt):{complete:boolean;reason:string} {
  if(/just a moment|security verification|verify (?:you are|you're) human|log in to continue|temporarily blocked/i.test(text.slice(0,500)))return {complete:false,reason:'challenge or sign-in wall'};
  if(receipt?.truncated)return {complete:false,reason:'seller text exceeded protective size limit'};
  if(!receipt?.complete)return {complete:false,reason:'description boundary or expansion not confirmed'};
  return {complete:true,reason:text.trim()?'complete':'confirmed empty seller description'};
}
export function craigslistDescription(html:string):string {
  const body=html.match(/<section\b[^>]*\bid=["']postingbody["'][^>]*>([\s\S]*?)<\/section>/i)?.[1];
  if(body==null)throw Error('Craigslist seller description missing: incomplete page or challenge');
  const text=body.replace(/<div class="print-information[\s\S]*?<\/div>/g,'')
    .replace(/<br\s*\/?\s*>|<\/?(?:p|div|li)\b[^>]*>/gi,'\n').replace(/<[^>]+>/g,'')
    .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#(?:39|x27);/g,"'")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g,' ').replace(/^QR Code Link to This Post\s*/i,'').trim();
  if(text.length>80000)throw Error('Craigslist seller description exceeds size limit; complete read not recorded');
  return text;
}
