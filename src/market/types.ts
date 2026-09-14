export type MarketRange='1m'|'3m'|'6m'|'1y'|'3y'|'all';
export type MarketCondition='used'|'new'|'open_box'|'refurb';
export type PriceBasis='item'|'delivered';
export interface MarketProduct {id:number;brand:string;model:string;category:string;}
export interface MarketSale {id:number;title:string;url:string|null;date:string;itemCents:number;shippingCents:number|null;condition:MarketCondition;}
export interface MarketCohort {key:string;label:string;complete:boolean;unknowns:string[];sales:MarketSale[];}
export interface MarketPoint {date:string;end:string;count:number;medianCents:number|null;lowCents:number|null;highCents:number|null;}
export interface MarketResponse {
  pinned:boolean;
  product:MarketProduct;range:MarketRange;condition:MarketCondition;basis:PriceBasis;generatedAt:string;
  cohorts:Array<Omit<MarketCohort,'sales'> & {count:number}>;selected:string|null;
  interval:'day'|'week'|'month';points:MarketPoint[];sales:MarketSale[];totalSales:number;
  coverage:{first:string|null;last:string|null;rangeFirst:string|null;rangeLast:string|null;excluded:number;missingShipping:number;truncated:boolean};
  summary:{medianCents:number|null;lowCents:number|null;highCents:number|null;changePercent:number|null;observedBuckets:number;totalBuckets:number};
}
