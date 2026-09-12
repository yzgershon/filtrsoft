import {expect,test} from 'bun:test';
import {money} from '../web/src/money.ts';
test('shared financial amounts preserve cents, negatives and unknown values',()=>{
  expect(money(1750)).toBe('$17.50');expect(money(50)).toBe('$0.50');expect(money(0)).toBe('$0');
  expect(money(-7050)).toBe('-$70.50');expect(money(123456)).toBe('$1,234.56');
  expect(money(null)).toBe('—');expect(money(NaN)).toBe('—');
});
