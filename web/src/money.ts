const whole=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
const cents=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
/** Shared feed, ledger and workspace amounts retain cents. Rounding $17.50 to
 * $18 hid the exact costs even though listing detail already showed them. */
export const money=(value?:number|null)=>value==null||!Number.isFinite(value)?'—':(value%100===0?whole:cents).format(value/100);
