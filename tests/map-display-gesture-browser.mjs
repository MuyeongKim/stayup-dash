/* Deterministic popup-refresh race: run the real delayed display callback while
 * a real mouse drag owns capture. Only the 700ms delivery time is intercepted;
 * the product callback and the normal 500ms deferred refresh run unchanged.
 * Uses disposable browser storage and synthetic incident/image data only.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-map-display-gesture';
await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{
  try{
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep))throw Error('Invalid path');
    res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/json');
    res.setHeader('Cache-Control','no-store');res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=process.argv.includes('--file')?pathToFileURL(path.join(root,'stayup-dash.html')).href:'http://127.0.0.1:'+server.address().port+'/stayup-dash.html';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1366,height:900},serviceWorkers:'block',reducedMotion:'reduce'});
await context.route('**/*',route=>{const u=new URL(route.request().url());return u.protocol==='file:'||u.hostname==='127.0.0.1'?route.continue():route.abort();});
const results=[],errors=[];
const check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name);};
context.on('page',p=>{p.on('pageerror',e=>errors.push(e.stack||e.message));p.on('dialog',d=>d.accept());p.setDefaultTimeout(7000);});
let page,fatal;
try{
  page=await context.newPage();await page.goto(url);await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  await page.evaluate(()=>{loadSample();S.weather.auto=false;S.ui.autoSave=false;commit();});
  await page.locator('#tab-grid').click();
  const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=800;c.height=600;const g=c.getContext('2d');g.fillStyle='#dce6cf';g.fillRect(0,0,800,600);g.strokeStyle='#75a2bc';g.lineWidth=30;g.beginPath();g.moveTo(420,0);g.lineTo(310,600);g.stroke();return c.toDataURL('image/png').split(',')[1];});
  await page.locator('#mapFileInput').setInputFiles({name:'synthetic-display-gesture.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await page.waitForFunction(()=>S.grid.hasMap&&mapPayloadReady());
  await page.evaluate(()=>{
    S.mission.title='가상 표출 연결 중 지도 조작';S.grid.cells.C3={s:1,by:'드론'};
    S.grid.pinLast={x:15,y:15};S.grid.pinFound={x:85,y:85};S=migrate(S);commit();
  });
  const baseline=await page.evaluate(()=>exportPayload(true));
  await page.evaluate(()=>{
    window.__nativeDisplayTimeout=window.setTimeout;window.__displayCallback=null;window.__displayCallbackCount=0;
    window.setTimeout=function(callback,delay,...args){
      if(Number(delay)===700&&!window.__displayCallback){
        window.__displayCallbackCount++;window.__displayCallback=()=>callback(...args);
        return __nativeDisplayTimeout(()=>{},0);
      }
      return __nativeDisplayTimeout.call(window,callback,delay,...args);
    };
  });
  const opened=context.waitForEvent('page');opened.catch(()=>{});await page.locator('#btnOpenDisplay').click();const display=await opened;
  await page.evaluate(()=>{window.setTimeout=__nativeDisplayTimeout;});
  await display.waitForFunction(()=>typeof S==='object'&&S.grid.hasMap&&mapPayloadReady());
  check('실제 현황 열기 버튼의 원본 700ms 콜백만 포착',await page.evaluate(()=>__displayCallbackCount===1&&typeof __displayCallback==='function'));
  await page.locator('#tab-grid').click();if(!await page.locator('#fieldTools').evaluate(e=>e.open))await page.locator('#fieldTools>summary').click();await page.locator('[data-field-action="rect"]').click();
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const fit=await page.locator('#consMap .mapfit').boundingBox();
  check('드래그 시작과 끝이 실제 화면 안의 지도에 위치',fit&&fit.y+fit.height*.2>=0&&fit.y+fit.height*.7<900,fit);
  await page.evaluate(()=>{window.__dragHost=document.getElementById('consMap');window.__dragStartState=exportPayload(true);window.__dragPointerId=null;__dragHost.addEventListener('gotpointercapture',e=>{__dragPointerId=e.pointerId;},{once:true});});
  await page.mouse.move(fit.x+fit.width*.2,fit.y+fit.height*.2);await page.mouse.down();
  await page.mouse.move(fit.x+fit.width*.5,fit.y+fit.height*.45,{steps:4});
  check('원래 지도에서 실제 포인터 캡처와 사각 초안 드래그 시작',await page.evaluate(()=>pointerHeld&&fieldEdit.mode==='rect'&&!!fieldEdit.drag&&__dragHost.hasPointerCapture(__dragPointerId)));
  await page.evaluate(()=>__displayCallback());
  check('표출 연결 콜백은 드래그 중 지도 DOM을 교체하지 않고 갱신을 예약',await page.evaluate(()=>pointerHeld&&__dragHost.isConnected&&document.getElementById('consMap')===__dragHost&&!!fieldEdit.drag&&consoleIdleTimer!==null));
  // Exercise the real first 500ms refresh expiry while the pointer is still held.
  await page.waitForTimeout(550);
  check('예약 갱신 시간이 지나도 누르고 있는 지도와 초안·캡처를 유지',await page.evaluate(()=>pointerHeld&&__dragHost.isConnected&&document.getElementById('consMap')===__dragHost&&!!fieldEdit.drag&&__dragHost.hasPointerCapture(__dragPointerId)&&consoleIdleTimer!==null));
  await page.mouse.move(fit.x+fit.width*.8,fit.y+fit.height*.7,{steps:4});await page.mouse.up();
  const completed=await page.evaluate(()=>({held:pointerHeld,drag:fieldEdit.drag,layout:{...fieldForm.layout},unchanged:exportPayload(true)===__dragStartState}));
  check('콜백 발생 뒤에도 끝점까지 드래그해 폭60%·높이50% 초안을 완성',!completed.held&&!completed.drag&&Math.abs(completed.layout.w-.6)<.02&&Math.abs(completed.layout.h-.5)<.02&&completed.unchanged,completed);
  await page.waitForFunction(()=>consoleIdleTimer===null&&document.getElementById('consMap')!==__dragHost);
  check('마우스를 놓은 뒤 실제 지연 갱신을 완료해도 초안과 기존 업무값 보존',await page.evaluate(original=>fieldEdit.mode==='rect'&&Math.abs(fieldForm.layout.w-.6)<.02&&Math.abs(fieldForm.layout.h-.5)<.02&&exportPayload(true)===original,baseline));
  await page.screenshot({path:path.join(out,'completed-draft-after-refresh.png'),scale:'css'});
  await page.locator('.field-editbar [data-field-action="cancel"]').click();
  check('사용자가 초안을 취소하면 기존 구역·핀·기록을 유지한 채 정상 복귀',await page.evaluate(original=>fieldEdit===null&&S.grid.layout===null&&S.grid.cells.C3.by==='드론'&&S.grid.pinLast.x===15&&S.grid.pinFound.x===85&&exportPayload(true)===original,baseline));
  check('연결된 현황 화면도 기존 구역·핀을 유지',await display.evaluate(()=>S.grid.layout===null&&S.grid.cells.C3.by==='드론'&&S.grid.pinLast.x===15&&S.grid.pinFound.x===85));
  check('페이지 실행 오류 없음',errors.length===0,errors);
}catch(error){
  fatal=error.stack||String(error);check('표출 연결 중 지도 드래그 시나리오 완료',false,fatal);
  if(page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png'),fullPage:false}).catch(()=>{});
}finally{
  await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,results,fatal},null,2));
  await browser.close();await new Promise(r=>server.close(r));
}
assert.equal(results.filter(r=>!r.pass).length,0,'Display refresh must not interrupt map gestures');
