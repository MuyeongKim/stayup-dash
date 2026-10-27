import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||path.join(root,'output/playwright/regression');await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{try{const f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!f.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':'application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(f));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
 await page.goto('http://127.0.0.1:'+server.address().port+'/tests/regression.html');
 await page.waitForFunction(()=>window.__REGRESSION__,{},{timeout:240000});
 const result=await page.evaluate(()=>window.__REGRESSION__);
 await writeFile(path.join(out,'results.json'),JSON.stringify(result,null,2));
 if(result.error||result.fail){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});await writeFile(path.join(out,'failure-text.txt'),await page.locator('body').innerText());}
 console.log(JSON.stringify(result));assert.ok(!result.error&&result.fail===0,'전체 회귀 검사 실패');
}finally{await browser.close();await new Promise(r=>server.close(r));}
