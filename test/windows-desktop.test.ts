import {test,expect} from 'bun:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
// Browser automation runs in the Node fixture, never in Bun.
// @ts-ignore plain Node worker module
import {backgroundLaunchOptions,needsPrivateDesktop} from '../src/browser/windows-desktop.mjs';

test('manual sign-in, headless and non-Windows browsers keep their normal launch path',async()=>{
  expect(needsPrivateDesktop({background:true,headless:false},'win32')).toBe(true);
  expect(needsPrivateDesktop({background:true,headless:false},'linux')).toBe(false);
  expect(needsPrivateDesktop({background:true,headless:false},'darwin')).toBe(false);
  for(const options of [{background:false,headless:false},{background:true,headless:true}]) {
    expect(needsPrivateDesktop(options,'win32')).toBe(false);
    expect(await backgroundLaunchOptions({...options,executablePath:'manual-chrome'})).toEqual({executablePath:'manual-chrome'});
  }
});

test.skipIf(process.platform!=='win32')('automatic Windows launches fail closed without an explicit browser',async()=>{
  await expect(backgroundLaunchOptions({background:true,headless:false})).rejects.toThrow('explicit browser');
});

test.skipIf(process.platform!=='win32'||!process.env.FILTRSOFT_TEST_CHROME)('native desktop: Chrome pipe, rendering, profile persistence, Facebook path and failure cleanup',()=>{
  const directory=mkdtempSync(join(tmpdir(),"filtrsoft desktop's test-"));
  try {
    const output=execFileSync(process.env.FILTRSOFT_NODE??'node',[
      resolve('test/fixtures/windows-desktop-check.mjs'),directory,process.env.FILTRSOFT_TEST_CHROME!,
    ],{windowsHide:true,encoding:'utf8',timeout:75_000});
    expect(JSON.parse(output.trim())).toMatchObject({interaction:true,persistentCookie:true,facebookLaunch:true,failedClosed:true,crashCleanup:true});
  } finally {
    if(dirname(resolve(directory))!==resolve(tmpdir())||!directory.includes("filtrsoft desktop's test-"))throw new Error('Unexpected fixture directory');
    rmSync(directory,{recursive:true,force:true});
  }
},80_000);
