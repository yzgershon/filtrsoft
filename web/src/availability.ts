import type {Availability} from '../../src/db/availability.ts';
export function availabilityLabel(value?:Availability):string {
  if(!value || value.state==='unchecked')return 'Availability not checked';
  if(value.state==='gone')return 'No longer available';
  if(value.state==='unknown')return 'Availability unconfirmed';
  if(value.state==='stale')return 'Needs an availability check';
  return 'Recently checked at source';
}
