import {test} from 'bun:test';
import {isolated} from './isolated.ts';
test('Google script load survives two auth forms, retries failures and reuses the loaded API',()=>isolated(`
  import {loadGoogleIdentity} from '@/web/src/google-identity.ts';
  const scripts=[];let appended=0;
  class Script extends EventTarget {remove(){const i=scripts.indexOf(this);if(i>=0)scripts.splice(i,1);}}
  globalThis.window={};globalThis.document={getElementById:()=>scripts[0]??null,createElement:()=>new Script(),head:{appendChild:s=>{scripts.push(s);appended++;}}};
  const first=loadGoogleIdentity(),second=loadGoogleIdentity();assert.equal(first,second);assert.equal(appended,1);
  scripts[0].dispatchEvent(new Event('error'));await assert.rejects(first,/could not load/);await assert.rejects(second,/could not load/);
  const retry=loadGoogleIdentity();assert.equal(appended,2);const api={initialize(){},renderButton(){}};window.google={accounts:{id:api}};
  scripts[0].dispatchEvent(new Event('load'));assert.equal(await retry,api);assert.equal(await loadGoogleIdentity(),api);assert.equal(appended,2);
`));
