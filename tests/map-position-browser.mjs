/* Naver camera-lock journeys use disposable Chrome and a synthetic Mercator SDK.
 * This verifies application controls, preservation and projection contracts;
 * it does not verify a real NAVER key, domain authentication, map tiles or billing. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-map-position';await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const fixture=await readFile(path.join(root,'tests/online-maps.js'),'utf8');
const installCode=fixture.slice(fixture.indexOf('function onlineMapInstallSdk('),fixture.indexOf('async function onlineMapReady('));
const server=createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/stayup-dash.html';
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1366,height:900},serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage();
const results=[],errors=[];const check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name);};
await context.route('**/*',r=>{const u=new URL(r.request().url());return u.protocol==='file:'||u.hostname==='127.0.0.1'?r.continue():r.abort();});
context.on('page',p=>{p.on('pageerror',e=>errors.push(e.stack));p.on('dialog',d=>d.accept());});page.on('pageerror',e=>errors.push(e.stack));page.on('dialog',d=>d.accept());page.setDefaultTimeout(8000);
async function mock(p){await p.addScriptTag({content:'var W=window;'+installCode+';window.positionMock=onlineMapInstallSdk(false);'});}
const stable=state=>{const s=structuredClone(state);delete s.meta;delete s.grid.source;delete s.grid.mapType;delete s.grid.viewLock;return s;};
const camera=p=>p.evaluate(()=>{const a=onlineHosts.consMap.adapter;return {center:a.getCenter(),zoom:a.getZoom()};});
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
try{
 await page.goto(url);await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());await mock(page);
 await page.evaluate(()=>{loadSample();S.weather.auto=false;S.ui.autoSave=false;S.grid.geo={north:35.91,south:35.88,west:127.20,east:127.24,src:'manual',at:Date.now()};S.grid.cells.C3={s:2,by:'드론'};S.grid.pinLast={x:40,y:45};S.grid.pinFound={x:60,y:55};commit();});await page.locator('#tab-grid').click();
 const before=await page.evaluate(()=>JSON.parse(JSON.stringify(migrate(S))));
 await page.locator('[data-position-action="open"]').click();
 check('처음 연결할 때 브라우저용 키와 웹 주소 등록 안내 표시',await page.locator('.map-position-key').evaluate(e=>e.open)&&await page.locator('.map-position-key').innerText().then(t=>t.includes('Client ID')&&t.includes('Client Secret')));
 await page.locator('#mapPositionKey').fill('synthetic-naver-key');await page.locator('#mapPositionConnect').click();await page.waitForFunction(()=>!document.querySelector('#mapPositionApply').disabled);
 const previewBefore=await page.locator('#mapPositionCamera').innerText();await page.locator('.map-position-capture').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('+');
 check('실제 키보드로 미리보기 위치·확대 변경',await page.locator('#mapPositionCamera').innerText()!==previewBefore);
 await page.locator('[data-position-preview="range"]').click();await page.locator('.map-position-capture').focus();await page.keyboard.press('ArrowRight');
 const fixedCenter=await page.locator('#mapPositionCamera').innerText();await page.locator('#mapPositionApply').click();await page.waitForFunction(()=>S.grid.viewLock&&onlineHosts.consMap&&onlineHosts.consMap.adapter&&!onlineHosts.consMap.error);
 const locked=await page.evaluate(()=>JSON.parse(JSON.stringify(S)));
 check('고정은 네이버 배경·카메라만 변경하고 기존 입력·사진·구역·핀·기록 유지',locked.grid.source==='naver'&&isDeepStrictEqual(stable(before),stable(locked)));
 check('인증키는 상황 JSON에 포함되지 않음',await page.evaluate(()=>!exportPayload(true).includes('synthetic-naver-key')));
 check('화면 고정 상태와 고정 해제 버튼 표시',await page.locator('[data-position-action="unlock"]').isVisible()&&await page.locator('#consMapWorkspace [data-position-status]').innerText().then(t=>t.includes('화면 고정됨')));
 const held=await camera(page);await page.evaluate(()=>{setMapView($('consMap'),{zoom:4,x:300,y:200});resetMapView($('consMap'));});await settle(page);
 check('고정 중 기존 확대·이동·전체맞춤 경로 차단',isDeepStrictEqual(await camera(page),held));
 const hr=await page.locator('#consMap').boundingBox();await page.mouse.move(hr.x+hr.width*.45,hr.y+hr.height*.45);await page.mouse.down();await page.mouse.move(hr.x+hr.width*.7,hr.y+hr.height*.6,{steps:5});await page.mouse.up();await settle(page);
 check('고정 중 실제 드래그로 지도 위치가 바뀌지 않음',isDeepStrictEqual(await camera(page),held));
 await page.setViewportSize({width:390,height:844});await settle(page);check('390px로 크기 변경해도 카메라 중심·배율 유지',isDeepStrictEqual(await camera(page),held));
 check('390px 화면의 고정 도구 가로 넘침 없음',await page.locator('[data-map-position-tools="consMap"]').evaluate(e=>e.getBoundingClientRect().right<=innerWidth+1));
 await page.setViewportSize({width:1366,height:900});await page.locator('[data-map-host="consMap"][data-map-action="expand"]').click();await settle(page);check('지도 크게 보기에서도 고정한 카메라 유지',isDeepStrictEqual(await camera(page),held));await page.locator('.map-dialog [data-map-action="close"]').first().click();
 await page.evaluate(()=>{setPinMode('found');placeMapPoint(55,55);});check('화면 고정 중에도 기존 핀 편집 허용',await page.evaluate(()=>S.grid.pinFound.x===55&&S.grid.viewLock!==null));
 await page.locator('[data-position-action="unlock"]').click();check('고정 해제 직후 기존 화면 위치·배율 유지',isDeepStrictEqual(await camera(page),held)&&await page.evaluate(()=>S.grid.viewLock===null));
 const previousZoom=(await camera(page)).zoom;await page.locator('[data-map-host="consMap"][data-map-action="zoom-out"]').click();await settle(page);check('고정 해제 후 기존 확대·축소 도구 재사용',(await camera(page)).zoom<previousZoom);
 await page.locator('[data-position-action="lock-current"]').click();await page.waitForFunction(()=>!!S.grid.viewLock);const relock=await page.evaluate(()=>JSON.stringify(S.grid.viewLock));
 await page.reload();await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());await mock(page);await page.evaluate(()=>{Object.keys(onlineHosts).forEach(destroyOnlineHost);renderAll();});await page.locator('#tab-grid').click();await page.waitForFunction(()=>onlineHosts.consMap&&onlineHosts.consMap.adapter&&!onlineHosts.consMap.error);await settle(page);
 check('재시작 후 저장한 위치·배율·고정 상태 복원',await page.evaluate(lock=>JSON.stringify(S.grid.viewLock)===lock&&Math.abs(onlineHosts.consMap.adapter.getZoom()-S.grid.viewLock.zoom)<1e-8&&Math.abs(onlineHosts.consMap.adapter.getCenter().lat-S.grid.viewLock.lat)<1e-8,relock));
 const viewer=await context.newPage();await viewer.goto(url+'#display');await viewer.waitForFunction(()=>typeof S==='object');await mock(viewer);await viewer.evaluate(()=>{Object.keys(onlineHosts).forEach(destroyOnlineHost);renderAll();});await viewer.waitForFunction(()=>onlineHosts.mapWrap&&onlineHosts.mapWrap.adapter);await settle(viewer);
 check('현황 창에서도 같은 위치·배율과 고정 상태 적용',await viewer.evaluate(()=>!ownsEditorLock()&&mapPositionLock()&&Math.abs(onlineHosts.mapWrap.adapter.getZoom()-S.grid.viewLock.zoom)<1e-8));await viewer.close();
 await page.locator('[data-position-action="open"]').click();await page.waitForFunction(()=>!document.querySelector('#mapPositionApply').disabled);const originalLock=await page.evaluate(()=>JSON.stringify(S.grid.viewLock));await page.evaluate(()=>{S.grid.generation=uid();commit();});await settle(page);if(!await page.locator('#mapPositionApply').isDisabled())await page.locator('#mapPositionApply').click();check('미리보기 도중 수색 범위가 바뀌면 오래된 적용 차단',await page.evaluate(lock=>JSON.stringify(S.grid.viewLock)===lock,originalLock)&&await page.locator('.field-status').innerText().then(t=>t.includes('바뀌')));await page.locator('dialog.field-dialog [data-field-close]').last().click();
 await page.evaluate(()=>{S.grid.viewLock=null;S.grid.source='image';S.grid.geo=null;S.grid.pinFound={x:55,y:55};commit();});await page.locator('[data-position-action="open"]').click();await page.waitForFunction(()=>document.querySelector('.map-position-empty').hidden);check('좌표 없는 기존 표식은 보정 안내하며 고정 차단',await page.locator('#mapPositionApply').isDisabled()&&await page.locator('.map-position-warning').innerText().then(t=>t.includes('좌표')));await page.locator('dialog.field-dialog [data-field-close]').last().click();
 await page.evaluate(()=>{S=defaultState();S.meta.epoch=SESSION_EPOCH;S.mission.title='빈 지도 범위 지정 시험';S.weather.auto=false;S.ui.autoSave=false;commit();});await page.locator('#tab-grid').click();await page.locator('[data-position-action="open"]').click();await page.waitForFunction(()=>document.querySelector('.map-position-empty').hidden);await page.locator('.map-position-capture').focus();for(let i=0;i<6;i++)await page.keyboard.press('+');await page.waitForFunction(()=>!document.querySelector('#mapPositionApply').disabled);await page.locator('#mapPositionApply').click();await page.waitForFunction(()=>geoOK()&&S.grid.viewLock);
 check('빈 지도에서만 미리보기 범위로 새 geo를 만들고 기존 상황명 유지',await page.evaluate(()=>geoOK()&&S.grid.geo.src==='online'&&S.mission.title==='빈 지도 범위 지정 시험'&&S.grid.history.length===0));
 for(const width of [390,320]){await page.setViewportSize({width,height:844});await page.locator('[data-position-action="open"]').click();await page.waitForFunction(()=>!document.querySelector('#mapPositionApply').disabled);check(width+'px 위치맞추기 창 가로 넘침 없음',await page.locator('dialog.field-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1&&e.getBoundingClientRect().right<=innerWidth+1));await page.screenshot({path:path.join(out,'position-preview-'+width+'.png'),scale:'css'});await page.locator('dialog.field-dialog [data-field-close]').last().click();}
 const bad=await page.evaluate(()=>[{},null,{lat:91,lon:127,zoom:12,source:'naver'},{lat:35,lon:127,zoom:99,source:'naver'},{lat:35,lon:127,zoom:12,source:'bad'}].every(x=>mapPositionNormalizeLock(x)===null));check('잘못된 가져오기 카메라 값은 무효화',bad);
 const fileContext=await browser.newContext({serviceWorkers:'block'}),file=await fileContext.newPage();file.on('pageerror',e=>errors.push(e.stack));await file.goto(pathToFileURL(path.join(root,'stayup-dash.html')).href);await file.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());await file.evaluate(()=>{loadSample();S.weather.auto=false;commit();});await file.locator('#tab-grid').click();await file.locator('[data-position-action="open"]').click();check('file 직접 실행은 명확한 웹 실행 안내와 연결 차단',await file.locator('#mapPositionConnect').isDisabled()&&await file.locator('.map-position-warning').first().innerText().then(t=>t.includes('localhost')));await fileContext.close();
 check('실행 중 자바스크립트 오류 없음',errors.length===0,errors);
}catch(error){check('시나리오 실행 완료',false,error.stack);await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}
finally{await writeFile(path.join(out,'results.json'),JSON.stringify({results,errors},null,2));await browser.close();server.close();}
assert.equal(results.filter(x=>!x.pass).length,0,JSON.stringify(results.filter(x=>!x.pass)));
