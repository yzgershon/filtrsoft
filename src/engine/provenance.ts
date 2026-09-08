import type {VisionResult} from "../vision/index.ts";
import {createHash} from "node:crypto";
import type {RawListing,SignalReport} from "../types.ts";
import type {Match} from "../catalog/match.ts";
import type {UserEconomics} from "../valuation/index.ts";

export function evidenceHash(value:unknown):string {
  const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v && typeof v==='object'
    ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export interface DecisionProvenance {
  version:1; engineVersion:string; dataRevision:string; factsHash:string;
  economics:{version:1;hash:string;values:UserEconomics;driveMinutes:number;scope:'canonical'|'personal'};
  facts:Omit<RawListing,'raw'>; signals:SignalReport; match:Match;
  visionHash:string|null;visionEvidence:VisionResult|null;
}
