/** A screen size is not a hardware generation. The first automatic refresh
 * exposed the old "Macbook Air 13" bucket pooling Intel and Apple Silicon.
 * Preserve those sale records, but never use the family bucket as a price.
 */
export function macbookCompIdentity(title:string,identity:string):boolean {
  if(!/\bmacbook\b/i.test(identity))return true;
  const chips=(s:string)=>[...new Set([...s.matchAll(/\bm(\d{1,2})(?:\s+(pro|max|ultra))?\b/gi)].map(m=>`m${m[1]}${m[2]?' '+m[2].toLowerCase():''}`))];
  const years=(s:string)=>[...new Set(s.match(/\b20\d{2}\b/g)??[])];
  const wantChip=chips(identity),wantYear=years(identity),gotChip=chips(title),gotYear=years(title);
  if(wantChip.length>1||wantYear.length>1)return false;
  if(wantChip.length===1) {
    if(gotChip.length!==1||gotChip[0]!==wantChip[0])return false;
  } else {
    // 2020 spans Intel and M1; later Pro models also have multiple chip tiers.
    // A modern year-only catalog name needs a more specific identity first.
    if(wantYear.length!==1||Number(wantYear[0])>=2020||gotChip.length)return false;
  }
  return !wantYear.length||gotYear.length===1&&gotYear[0]===wantYear[0];
}
