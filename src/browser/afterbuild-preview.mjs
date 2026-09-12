/** Local synthetic business concept; no Filtrsoft API or database is loaded. */
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const html=await readFile(new URL('../../docs/prototypes/afterbuild.html',import.meta.url));
const server=http.createServer((req,res)=>{if(req.url!=='/'&&req.url!=='/favicon.ico'){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(html);});
await new Promise(resolve=>server.listen(3212,'127.0.0.1',resolve));
console.log('Synthetic AfterBuild concept: http://127.0.0.1:3212/');
if(process.argv.includes('--check')){
  const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];
  try{
    await mkdir('docs/qa/afterbuild',{recursive:true});
    const context=await browser.newContext({reducedMotion:'reduce'});
    await context.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:3212'?r.continue():r.abort());
    const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
    for(const width of [360,768,1440]){
      await p.setViewportSize({width,height:900});await p.goto('http://127.0.0.1:3212/');
      assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await p.getByRole('button',{name:'Inspect source records'}).click();await p.getByRole('dialog').waitFor();assert((await p.locator('#dialog-body').textContent()).includes('"synthetic": true'));await p.keyboard.press('Escape');
      await p.getByRole('button',{name:/No display at startup/}).click();assert((await p.locator('#comparison-note').textContent()).includes('not enough evidence'));
      await p.getByRole('button',{name:'Preview support reply'}).click();assert((await p.locator('#dialog-body').textContent()).includes('No need to open the case'));await p.getByRole('button',{name:'Close preview'}).click();
      await p.getByRole('button',{name:'Customer',exact:true}).click();await p.locator('#customer').waitFor();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await p.screenshot({path:`docs/qa/afterbuild/customer-${width}.png`,fullPage:true});
      await p.getByRole('button',{name:'Builder',exact:true}).click();await p.getByRole('button',{name:/Games feel choppy/}).click();await p.screenshot({path:`docs/qa/afterbuild/builder-${width}.png`,fullPage:true});
    }
    assert.deepEqual(errors,[]);await writeFile('docs/qa/afterbuild/results.json',JSON.stringify({at:new Date().toISOString(),widths:[360,768,1440],passed:true,errors},null,2));console.log('PASS synthetic concept: both perspectives, two cases, source/draft dialogs, three widths');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
