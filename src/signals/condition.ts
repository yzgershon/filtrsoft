/** Seller disclosures override an ordinary working-unit comp price. In the
 * September 17 live audit an explicitly untested liquidation GPU was a BUY.
 * Keep quotations and negations local so "not sold for parts" is not a defect. */
export const coordinatedDamageDenial=(before:string)=>/\b(?:no|not|without)\s+(?:any\s+)?(?:(?:bent|broken|missing|damaged|defective)\s*(?:,\s*|(?:or|and)\s+))*$/i.test(before);
// A stated DDR-generation restriction is compatibility, not a broken board.
// Do not suppress an actual failure with a supplied charger or other accessory.
export const memoryCompatibilityDenial=(match:string,after:string)=>/^does(?:n't| not) work$/i.test(match)&&/^\s+with\s+DDR[345]\b/i.test(after);
export function conditionDisclosure(text:string):{broken:string|null;untested:string|null;displayDamage:string|null} {
  let broken:string|null=null,untested:string|null=null,displayDamage:string|null=null;
  for(const clause of text.split(/[\n.!?;]+/).map(s=>s.trim()).filter(Boolean)) {
    // Live OfferUp #7579 said "fully operable - there is a crack on the
    // screen" and still borrowed an undamaged screen's price without warning.
    // Functioning and undamaged are separate claims; preserve the actual quote.
    for(const m of clause.matchAll(/\b(?:(?:cracked|shattered|broken)\s+(?:screen|display|lcd)|cracks?\s+(?:on|in|across)\s+(?:the\s+)?(?:screen|display|lcd)|(?:screen|display|lcd)\s+(?:(?:is|has|with)\s+)?(?:(?:a|small|hairline)\s+){0,2}(?:crack(?:ed|s)?|shattered|broken))\b/gi)) {
      const before=clause.slice(Math.max(0,m.index!-45),m.index),after=clause.slice(m.index!+m[0].length);
      if(/\b(?:not|no|never|isn't|is not)\s+(?:(?:a|an|any)\s+)*$/i.test(before))continue;
      if(/^\s+protector\b/i.test(after))continue;
      if(/\b(?:replaced|repaired|fixed)\s+(?:(?:the|a|an)\s+)*$/i.test(before)
        || /^\s*(?:[,:-]\s*)?(?:(?:but|which)\s+)?(?:(?:was|is|has been|is now)\s+)?(?:repaired|replaced|fixed)\b/i.test(after))continue;
      if(/\b(?:warranty|coverage|protection|covers?)\b/i.test(before))continue;
      displayDamage??=clause.slice(0,400);
    }
    const candidates=[...clause.matchAll(/\b(?:for parts(?: only)?|parts only|not working|non[- ]working|does(?:n't| not) (?:work|boot|power on)|won't (?:boot|power on)|no (?:power|display)|broken|defective|untested|not tested|unable to test|cannot test|can't test)\b/gi)];
    for(const m of candidates) {
      const before=clause.slice(Math.max(0,m.index!-35),m.index);
      if(/\b(?:not|never|isn't|is not)\s+(?:(?:being|sold|selling|a|an|as)\s+)*$/i.test(before))continue;
      // A coordinated denial shares its negation: "No bent, broken or
      // missing pin" was falsely marking the audited B860 as damaged.
      // Only damage adjectives may intervene, never "but" or another claim.
      if(/^(?:broken|defective)$/i.test(m[0]) && coordinatedDamageDenial(before))continue;
      if(memoryCompatibilityDenial(m[0],clause.slice(m.index!+m[0].length)))continue;
      if(/\b(?:warranty|warrantied|protection|coverage|against|replaced|repaired)\b/i.test(before) && /^(broken|defective)$/i.test(m[0]))continue;
      // A missing packaging/accessory does not establish a broken device.
      if(/^(?:broken|defective)$/i.test(m[0]) && /^\s+(?:box|packaging|case clip|cable|charger|screen protector)\b/i.test(clause.slice(m.index!+m[0].length)))continue;
      if(/untested|not tested|unable to test|cannot test|can't test/i.test(m[0]))untested??=clause.slice(0,400);
      else broken??=clause.slice(0,400);
    }
    if(/^condition\s*[:=]?\s*(?:poor|used - poor)\b/i.test(clause))untested??=clause.slice(0,400);
  }
  return {broken,untested,displayDamage};
}
