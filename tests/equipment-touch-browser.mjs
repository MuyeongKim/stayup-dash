/* Native touch regression: one placement tap must not also open its new marker.
   --before serves a previous HTML without modifying the checkout (red check). */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const out=option('--out')||'/tmp/stayup-equipment-touch';await mkdir(out,{recursive:true});
const modules=option('--modules'),before=option('--before')?await readFile(option('--before')):null;
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{try{const f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!f.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':'application/json');res.end(before&&f.endsWith('/stayup-dash.html')?before:await readFile(f));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=(process.argv.includes('--file')?pathToFileURL(path.join(root,'stayup-dash.html')).href:'http://127.0.0.1:'+server.address().port+'/stayup-dash.html')+'?practice=1';
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[],errors=[];
const check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name);};
const stable=s=>{s=structuredClone(s);delete s.meta;delete s.grid.equipment;return s;};
try{
 for(const width of [390,320]){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'});
  await context.route('**/*',r=>{const u=new URL(r.request().url());return u.protocol==='file:'||u.hostname==='127.0.0.1'?r.continue():r.abort();});
  const page=await context.newPage();page.setDefaultTimeout(7000);page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  await page.locator('[data-onboard-action="close"]').tap();await page.locator('#tab-grid').tap();
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=750;const g=c.getContext('2d');g.fillStyle='#dce9df';g.fillRect(0,0,1200,750);return c.toDataURL('image/png').split(',')[1];});
  await page.locator('#mapFileInput').setInputFiles({name:'가상-터치지도.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await page.waitForFunction(()=>S.grid.hasMap&&mapPayloadReady());
  const baseline=await page.evaluate(()=>JSON.parse(exportPayload(true)));
  for(const [kind,cell] of [['pump','B2'],['command','D5'],['drone','D2']]){
   const panel=page.locator('[data-equipment-tools]');if(!await panel.evaluate(e=>e.open))await panel.locator(':scope>summary').tap();
   await page.locator('[data-equipment-kind="'+kind+'"]').tap();
   if(kind==='drone')await page.locator('#equipmentDrone').selectOption({index:1});else await page.locator('#equipmentName').fill('가상 '+kind);
   await page.locator('[data-equipment-action="place"]').tap();await page.locator('#consMap [data-cell="'+cell+'"]').tap();
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const opened=await page.locator('dialog.field-dialog[open]').count();
   check(width+'px '+kind+': 배치한 첫 터치로 정보창이 자동으로 열리지 않음',opened===0);
   if(opened)await page.locator('dialog.field-dialog [data-field-close]').last().tap();
   const id=await page.evaluate(k=>S.grid.equipment.find(p=>p.kind===k).id,kind);
   await page.locator('#consMap [data-equipment-id="'+id+'"]').tap();
   check(width+'px '+kind+': 바로 다음 의도적인 터치는 정보창을 정상적으로 엶',await page.locator('dialog.field-dialog[open]').count()===1);
   await page.locator('dialog.field-dialog [data-field-close]').last().tap();
  }
  const pump=await page.evaluate(()=>S.grid.equipment.find(p=>p.kind==='pump').id);
  await page.locator('#consMap [data-equipment-id="'+pump+'"]').tap();await page.locator('[data-equipment-action="move"]').tap();await page.locator('#consMap [data-cell="E2"]').tap();
  check(width+'px: 위치 옮기기 터치도 정보창을 자동으로 열지 않음',await page.locator('dialog.field-dialog[open]').count()===0&&await page.evaluate(id=>S.grid.equipment.find(p=>p.id===id).y>80,pump));
  const final=await page.evaluate(()=>JSON.parse(exportPayload(true)));
  check(width+'px: 터치 배치·이동은 기존 지도·핀·기체·구역·기록·안전을 유지',isDeepStrictEqual(stable(baseline),stable(final)));
  await page.screenshot({path:path.join(out,'touch-placement-'+width+'.png'),scale:'css'});
  await context.close();
 }
 check('브라우저 실행 오류 없음',errors.length===0,errors);
}finally{await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),results,errors},null,2));await browser.close();await new Promise(r=>server.close(r));}
assert.equal(results.filter(r=>!r.pass).length,0,'Touch placement regression');
