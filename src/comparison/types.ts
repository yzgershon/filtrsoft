import type {Specifications,SpecEvidence} from '../engine/specifications.ts';
import type {ManufacturerReference} from './references.ts';

export const PART_KINDS=['gpu','cpu','ram','storage','motherboard','psu'] as const;
export type PartKind=typeof PART_KINDS[number];
export type Workload='gaming'|'rendering';
export interface BenchmarkRow {device:string;backend:string;median:number;submissions:number}
export interface BenchmarkSnapshot {version:1;revision:string;retrievedAt:string;source:{name:string;url:string;license:string;licenseUrl:string};suite:string;os:string;rows:BenchmarkRow[]}
export interface HardwareMatch {identity:string|null;state:'identified'|'ambiguous'|'unknown';form:'desktop'|'laptop'|'unknown';evidence:SpecEvidence[];reason:string|null}
export interface ReferenceScore {value:number;unit:string;submissions:number;device:string;backend:string;suite:string;os:string;sourceUrl:string;scope:'model'|'family';note:string}
export interface CompareSide {
  id:number;title:string;url:string|null;source:string;priceCents:number|null;location:string|null;photoUrls:string[];
  status:'active'|'gone'|'stale'|'removed'|'missing'|'updating';observedAt:string|null;assessedAt:string|null;category:string;
  call:string|null;worthCents:number|null;concerns:Array<{label:string;detail:string}>;questions:string[];
  specs:Specifications;hardware:HardwareMatch;reference:ReferenceScore|null;benchmarkReason:string|null;standalone:boolean;
  manufacturer:ManufacturerReference|null;
}
export interface CompareMetric {key:string;label:string;values:[string|null,string|null];note?:string;direction:'higher'|'lower'|null;numeric?:[number|null,number|null]}
export interface CompareResult {
  version:1;kind:PartKind;workload:Workload;sides:CompareSide[];metrics:CompareMetric[];
  score:{state:'comparable'|'unavailable';indices:[number|null,number|null];advantagePercent:number|null;leader:0|1|null;reason:string;label:string};
  value:{indices:[number|null,number|null];leader:0|1|null;reason:string};
  reference:{revision:string;retrievedAt:string;suite:string;os:string;name:string;url:string;license:string;licenseUrl:string};
  externalGaming:{url:string;label:string;note:string}|null;
}
export interface CompareCandidate {id:number;title:string;priceCents:number|null;source:string;location:string|null;thumb:string|null;photoUrls:string[];identity:string|null;state:HardwareMatch['state'];call:string|null;wholeSystem:boolean}
