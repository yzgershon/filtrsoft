import type {VisionResult} from './index.ts';
/** Legacy vision sometimes encoded "not visible from this angle" as false.
 * Absence needs a positive observation, not a boolean that contradicts its
 * own evidence. Keep the original cached result; interpret uncertainty here. */
export function confirmedNoDisplayOutputs(v:VisionResult):boolean {
  if(v.displayOutputsVisible!==false)return false;
  const text=[v.portCondition,...(v.facts??[]).map(f=>f.fact)].filter(Boolean).join(' ');
  if(/\b(?:not (?:fully |clearly )?(?:visible|shown)|not clear|unclear|cannot see|can.t see|appears?|typical|obscured)\b/i.test(text))return false;
  return /\b(?:no|without)\s+(?:display\s+)?(?:connectors|outputs|ports)\b/i.test(text);
}
