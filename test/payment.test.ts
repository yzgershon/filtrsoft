import {test,expect} from 'bun:test';
import {exclusivePayment} from '../src/signals/payment.ts';
test('Optional crypto and alternate payment rails are not exclusive demands',()=>{
  for(const text of ['Crypto only for delivery, cash at pickup','Not only crypto accepted','Cash and Bitcoin only','cryptocurrency ok yes','Cash or crypto accepted. Pickup only.','Bitcoin accepted, cash preferred','I accept cash, Zelle or Bitcoin','Crypto payments accepted. Cash accepted at pickup.','No crypto accepted. Cash only.','Zelle is fine, so is cash.','Only selling locally. BTC accepted.','I do not accept crypto only cash']) expect(exclusivePayment(text)).toBeNull();
});
test('Explicit exclusive payment requirements retain their exact evidence',()=>{
  for(const text of ['Seller only accepts cryptocurrency','Bitcoin only','Only accepting cryptocurrency','Payment is exclusively via BTC','USDT payments only','No cash. Crypto only.','Gift cards only','PayPal friends & family only']) expect(exclusivePayment(text)).not.toBeNull();
});
