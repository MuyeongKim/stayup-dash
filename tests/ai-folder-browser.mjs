/* Actual OS folder -> native Chrome FileSystemDirectoryHandle -> app polling.
 * CDP simulates a user dropping a directory, which grants a real read handle.
 * Only the picker return is substituted; directory entries/getFile/text and
 * permission checks are native. Nothing is served from the watched directory.
 * node tests/ai-folder-browser.mjs --modules /absolute/node_modules
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, readFile, writeFile, rename, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const i=process.argv.indexOf('--modules'),modules=i<0?null:process.argv[i+1];
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const temp=await mkdtemp(path.join(tmpdir(),'stayup-ai-folder-')),folder=path.join(temp,'현장 후보');
await mkdir(folder);
const sourceIndex=process.argv.indexOf('--source');
const fixture=JSON.parse(await readFile(sourceIndex<0?path.join(root,'tests/fixtures/stayup-photo-candidates-v1.json'):process.argv[sourceIndex+1],'utf8'));
const expectedCount=fixture.candidates.length;
const filename='stayup-ai-candidates-'+fixture.run.id+'.json',target=path.join(folder,filename);
async function publish(value){const partial=target+'.tmp';await writeFile(partial,JSON.stringify(value));await rename(partial,target);}
const server=createServer(async(req,res)=>{
  try{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep))throw Error();
    res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'application/json');
    res.setHeader('Cache-Control','no-store');res.end(await readFile(file));
  }catch(_){res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=process.argv.includes('--file')?pathToFileURL(path.join(root,'stayup-dash.html')).href:'http://127.0.0.1:'+server.address().port+'/stayup-dash.html';
const browser=await chromium.launch({channel:'chrome',headless:true});let passed=0;
const pass=name=>{passed++;console.log('PASS '+name);};
try{
  const context=await browser.newContext({viewport:{width:1366,height:900}}),page=await context.newPage();
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(url);await page.waitForFunction(()=>typeof aiFolderConnect==='function'&&ownsEditorLock());
  await page.evaluate(()=>{S.mission.title='실제 폴더 보존 시험';S.weather.auto=false;commit();
    document.addEventListener('dragover',e=>{e.preventDefault();e.stopImmediatePropagation();},true);
    document.addEventListener('drop',e=>{e.preventDefault();e.stopImmediatePropagation();window.__directory=e.dataTransfer.items[0].getAsFileSystemHandle();},true);
  });
  const cdp=await context.newCDPSession(page),data={items:[],files:[folder],dragOperationsMask:1};
  for(const type of ['dragEnter','dragOver','drop'])await cdp.send('Input.dispatchDragEvent',{type,x:400,y:300,data});
  const native=await page.evaluate(async()=>{window.__handle=await window.__directory;return {type:__handle.constructor.name,kind:__handle.kind,permission:await __handle.queryPermission({mode:'read'})};});
  assert.deepEqual(native,{type:'FileSystemDirectoryHandle',kind:'directory',permission:'granted'});pass('real OS directory read permission / native handle');
  await publish(fixture);
  await page.evaluate(()=>{window.showDirectoryPicker=async()=>__handle;});
  await page.locator('#tab-ai').click();
  await page.locator('[data-ai-action="folder"]').click();
  await page.waitForFunction((n)=>S.ai.candidates.length===n,expectedCount);
  assert.equal(await page.evaluate(()=>S.mission.title),'실제 폴더 보존 시험');pass('initial on-disk file automatically imported into existing mission');
  await page.evaluate(()=>{const key=aiKey(S.ai.candidates[0]);aiResponseDrafts[key]={note:'실제 폴더 대응 보존',status:'notified'};aiSaveResponse(key);});
  const popup=context.waitForEvent('page');await page.locator('#btnOpenDisplay').click();
  const display=await popup;await display.waitForFunction(n=>typeof S!=='undefined'&&S.ai.candidates.length===n,expectedCount);
  assert.equal(await display.evaluate(()=>aiFolder.session),null);pass('display receives candidates and never creates a second folder reader');
  const revision=await page.evaluate(()=>S.meta.revision);
  await page.waitForTimeout(2400);assert.equal(await page.evaluate(()=>S.meta.revision),revision);pass('unchanged polling creates no duplicate events or writes');
  fixture.run.revision++;fixture.candidates[0].review='hold';await publish(fixture);
  await page.waitForFunction(()=>S.ai.candidates[0].review==='hold');
  assert.equal(await page.evaluate(()=>S.ai.candidates[0].responseNote),'실제 폴더 대응 보존');pass('atomic disk replacement updates source review and preserves response');
  await display.waitForFunction(()=>S.ai.candidates[0].review==='hold'&&S.ai.candidates[0].responseNote==='실제 폴더 대응 보존');
  pass('automatic folder updates and response records reach the display window');
  await writeFile(path.join(folder,'stayup-ai-candidates.json'),'{broken');
  await page.waitForFunction(()=>aiFolder.message.includes('오류 1'));pass('corrupt disk package reported without losing valid records');
  await rm(target);await page.waitForTimeout(2400);assert.equal(await page.evaluate(()=>S.ai.candidates.length),expectedCount);pass('removed source file does not remove response history');
  await page.locator('[data-ai-action="folder-stop"]').click();
  const old=await page.evaluate(()=>S.meta.revision);fixture.run.revision++;fixture.candidates[0].review='person';await publish(fixture);
  await page.waitForTimeout(2400);assert.equal(await page.evaluate(()=>S.meta.revision),old);pass('disconnect stops real disk polling');
  await page.locator('[data-ai-file]').setInputFiles(target);
  await page.waitForFunction(()=>S.ai.candidates[0].review==='person');pass('manual file input remains functional after folder disconnect');
  await page.reload();await page.waitForFunction(()=>typeof aiFolder==='object');
  assert.equal(await page.evaluate(()=>aiFolder.session),null);assert.equal(await page.evaluate(()=>S.ai.candidates[0].responseNote),'실제 폴더 대응 보존');pass('reload restores records but never reconnects directory permission');
  await page.locator('#tab-ai').click();
  await page.screenshot({path:path.join(temp,'folder-console.png'),fullPage:true});
  console.log(JSON.stringify({passed,folder,native,screenshot:path.join(temp,'folder-console.png')}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
