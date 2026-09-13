import {test,expect} from 'bun:test';
import {feedWindow,CursorError} from '../src/api/feed-cursor.ts';

test('feed windows freeze order, enforce ownership and recheck eligibility without database writes',()=>{
  const original=[{id:1},{id:2},{id:3},{id:4}];
  const first=feedWindow(original,987,{q:'gpu'}).page(original,2);
  expect(first.items.map(x=>x.id)).toEqual([1,2]);
  expect(first.nextCursor).toBeTruthy();
  const fresh=[{id:4},{id:3},{id:1}];
  const next=feedWindow(fresh,987,{q:'gpu'},first.nextCursor!);
  expect(next.page(next.scoped,2).items.map(x=>x.id)).toEqual([3,4]);
  expect(()=>feedWindow(fresh,988,{q:'gpu'},first.nextCursor!)).toThrow(CursorError);
  expect(()=>feedWindow(fresh,987,{q:'cpu'},first.nextCursor!)).toThrow(CursorError);
  for(let i=0;i<20;i++)feedWindow(original,987,{q:'gpu'});
  expect(()=>feedWindow(fresh,987,{q:'gpu'},first.nextCursor!)).toThrow(CursorError);
});
