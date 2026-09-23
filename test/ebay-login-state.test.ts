import {test,expect} from 'bun:test';
import {PassThrough} from 'node:stream';
import {signedInFromHeader,waitForManualSignIn} from '../src/browser/ebay-login-state.mjs';

const header={url:'https://www.ebay.com/',title:'Electronics, Cars, Fashion | eBay',greeting:'Hi Yish!',signInVisible:false,signOutVisible:false};
test('a generic eBay greeting or My eBay navigation cannot prove sign-in',()=>{
  expect(signedInFromHeader({...header,greeting:'Hi! Sign in or register'})).toBe(false);
  expect(signedInFromHeader({...header,greeting:'My eBay'})).toBe(false);
  expect(signedInFromHeader({...header,greeting:'Hi!'})).toBe(false);
  expect(signedInFromHeader({...header,greeting:'Hi, !'})).toBe(false);
  expect(signedInFromHeader(header)).toBe(true);
  expect(signedInFromHeader({...header,greeting:'',signOutVisible:true})).toBe(true);
});
test('explicit sign-in and challenge evidence override a personalized greeting',()=>{
  expect(signedInFromHeader({...header,signInVisible:true})).toBe(false);
  expect(signedInFromHeader({...header,url:'https://signin.ebay.com/ws/eBayISAPI.dll'})).toBe(false);
  expect(signedInFromHeader({...header,url:'https://www.ebay.com/signin/'})).toBe(false);
  expect(signedInFromHeader({...header,title:'Security Measure | eBay'})).toBe(false);
  expect(signedInFromHeader({...header,url:'https://ebay.com.example.invalid/'})).toBe(false);
  expect(signedInFromHeader({...header,greeting:'Hi guest!'})).toBe(false);
});
test('closed stdin cannot finish a manual sign-in; passive detection still works',async()=>{
  const input=new PassThrough();let probes=0,complete=false;
  const waiting=waitForManualSignIn({input,readSignedIn:async()=>++probes>=3,pollMs:10,maxWaitMs:500}).then(reason=>{complete=true;return reason;});
  input.end();await Bun.sleep(5);expect(complete).toBe(false);
  expect(await waiting).toBe('detected');
  const atCompletion=probes;await Bun.sleep(30);expect(probes).toBe(atCompletion);
});
test('Enter and timeout finish cleanly without claiming authentication',async()=>{
  const input=new PassThrough();let probes=0;
  const waiting=waitForManualSignIn({input,readSignedIn:async()=>{probes++;return false;},pollMs:10,maxWaitMs:500});
  input.write('\n');expect(await waiting).toBe('enter');await Bun.sleep(30);expect(probes).toBe(0);input.end();
  const ended=new PassThrough();ended.end();
  expect(await waitForManualSignIn({input:ended,readSignedIn:async()=>false,pollMs:5,maxWaitMs:20})).toBe('timeout');
});
