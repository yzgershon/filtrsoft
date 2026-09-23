import {describe,test,expect} from 'bun:test';
import {probeVerdict} from '../src/sources/marketplace.ts';
import {detailItemText} from '../src/sources/facebook.ts';

// September 22 OMEN: 133 Facebook listings sat in failed detail reads, each
// retried for its whole 28-day window, and every recovery batch reported 0/N.
describe('Facebook detail availability',()=>{
 const item='https://www.facebook.com/marketplace/item/1058402443635371/';
 const page={url:item,finalUrl:item,heading:'iPhone 18 pro max Burgundy 256GB',actions:['Message','Save','Share'],
  text:'iPhone 18 pro max Burgundy 256GB\n$1,500\nListed 3 days ago in Cambridge, MA\nMessage\nDetails\nCondition\nNew\niPhone 18 pro max Burgundy 256GB\nCambridge, MA · Location is approximate'};

 test('a removed item redirected to the Marketplace index is gone',()=>{
  for(const finalUrl of ['https://www.facebook.com/marketplace/','https://www.facebook.com/marketplace/boston/','https://www.facebook.com/marketplace/?ref=item','https://www.facebook.com/marketplace/category/electronics/']){
   const v=probeVerdict({...page,heading:'Marketplace',finalUrl,text:"Today's picks\nBoston · 40 mi\n$50\nNikon D70"});
   expect(v?.gone).toBe(true);
  }
 });
 test('login, challenge, another item or the seller dashboard stay no-opinion',()=>{
  for(const finalUrl of ['https://www.facebook.com/login/?next=%2Fmarketplace%2F','https://www.facebook.com/checkpoint/123/',
   'https://www.facebook.com/marketplace/item/999/','https://www.facebook.com/marketplace/you/selling','https://www.messenger.com/marketplace/'])
   expect(probeVerdict({...page,finalUrl})).toBeNull();
 });
 test('OfferUp redirect to its home or search page is gone',()=>{
  const ou='https://offerup.com/item/detail/abc-123';
  expect(probeVerdict({url:ou,finalUrl:'https://offerup.com/',text:'Home\nBrowse',actions:[]})?.gone).toBe(true);
  expect(probeVerdict({url:ou,finalUrl:'https://offerup.com/search?q=rtx',text:'Results',actions:[]})?.gone).toBe(true);
 });
 test('a title-only description is still this item when the panel is scoped',()=>{
  // The heading appears twice because the seller's text is the title itself.
  expect(probeVerdict(page)).toBeNull();
  expect(probeVerdict({...page,itemText:page.text})?.gone).toBe(false);
  const lines=page.text.split('\n');
  expect(probeVerdict({...page,itemText:detailItemText({heading:page.heading,bodyLines:lines})})?.gone).toBe(false);
  expect(detailItemText({heading:page.heading,bodyLines:['Log In',...lines]})).toBeUndefined();
  expect(detailItemText({heading:'',bodyLines:lines})).toBeUndefined();
 });
});
