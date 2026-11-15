/* Upgrade, view-only journeys and portable backups use synthetic incidents and
 * disposable Chrome contexts. This does not test a real NAVER account or staff. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-ux-five-fixes-20261105/preservation';
const before=await readFile(option('--before')||'/tmp/stayup-before-five-fixes.html');
const sourceDigest=async()=>createHash('sha256').update(await readFile(path.join(root,'stayup-dash.html'))).digest('hex');
const sourceBefore=await sourceDigest();
await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+u.pathname);
    if(!file.startsWith(root+path.sep))throw Error('Invalid path');
    res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/json');
    res.setHeader('Cache-Control','no-store');
    res.end(u.searchParams.has('previous')&&u.pathname==='/stayup-dash.html'?before:await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port+'/stayup-dash.html';
const browser=await chromium.launch({channel:'chrome',headless:true}),contexts=[];
const results=[],errors=[],external=[];
const check=(name,pass,details)=>{results.push({name,pass:!!pass,details});console.log((pass?'PASS ':'FAIL ')+name);};
async function newContext(viewport={width:1366,height:1000}){
  const context=await browser.newContext({viewport,serviceWorkers:'block',reducedMotion:'reduce',acceptDownloads:true});contexts.push(context);
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1')return route.continue();external.push(u.origin);return route.abort();});
  context.on('page',page=>{page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.stack||e.message));page.on('dialog',d=>d.accept());});
  return context;
}
const payload=page=>page.evaluate(()=>JSON.parse(exportPayload(true)));
/* 2026-11-15 지도 선(grid.lines)을 더했다. 구버전 자료를 새 앱으로 열면 빈 목록만 생겨야 하므로 빈 목록만 비교에서 뺀다. */
const withoutVersion=raw=>{const value=structuredClone(raw);delete value.appVersion;
  const strip=g=>{if(g&&Array.isArray(g.lines)&&g.lines.length===0)delete g.lines;};
  strip(value.grid);((value.grid&&value.grid.history)||[]).forEach(h=>strip(h.grid));return value;};
async function settle(page){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function changeChoices(page){
  const choices=page.locator('[data-map-source-choices]');
  if(await choices.count()&&await choices.evaluate(e=>e.open))return;
  const change=page.locator('[data-stage-action="change"]');
  if(await change.isVisible())await change.click();
  else await choices.locator(':scope > summary').click();
  await page.waitForFunction(()=>document.querySelector('[data-map-source-choices]').open);
}
async function openTools(page){
  const toggle=page.locator('[data-map-tools-toggle]');
  if(await toggle.count()&&!await page.locator('[data-map-tools-panel]').isVisible())await toggle.click();
}
let page,fatal;
try{
  const context=await newContext();page=await context.newPage();
  await page.goto(base+'?previous=1');await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  await page.evaluate(()=>{loadSample();S.weather.auto=false;S.ui.autoSave=false;S.mission.title='가상 기존자료 보존';S.mission.situationMessage='가상 A팀 하류 확인 중';S.mission.orders='지휘부 원문\n기존 기록을 그대로 보존';commit();});
  const images=await page.evaluate(()=>[0,1].map(i=>{const c=document.createElement('canvas');c.width=1200;c.height=900;const x=c.getContext('2d');x.fillStyle=i?'#dce4d2':'#cfe1e8';x.fillRect(0,0,c.width,c.height);x.fillStyle='#314a43';x.font='36px sans-serif';x.fillText('가상 보존 지도 '+(i+1),60,95);x.strokeStyle=i?'#748465':'#85a7b9';x.lineWidth=30;x.beginPath();x.moveTo(0,600);x.lineTo(1200,300);x.stroke();return c.toDataURL('image/png').split(',')[1];}));
  await page.locator('#mapFileInput').setInputFiles({name:'synthetic-history-map.png',mimeType:'image/png',buffer:Buffer.from(images[0],'base64')});
  await page.waitForFunction(()=>S.grid.hasMap&&mapPayloadReady());
  await page.locator('[data-ai-file]').setInputFiles(path.join(root,'tests/fixtures/stayup-photo-candidates-v1.json'));
  await page.waitForFunction(()=>S.ai.candidates.length===2&&mapPayloadReady());
  await page.evaluate(()=>{
    const now=Date.now(),drone=S.drones[0];drone.name='가상 등록 드론';drone.zone='C3';drone.battery=76;
    S.grid.geo={north:35.94,south:35.86,west:127.18,east:127.26,src:'manual',at:now};
    S.grid.cells.C3={s:1,by:'드론'};S.grid.pinLast={x:25,y:30};S.grid.pinFound={x:75,y:65};
    S.grid.equipment=[{id:'preserve-pump',kind:'pump',name:'가상 펌프 1',droneId:'',positionRole:'team',x:30,y:45,updatedAt:now},{id:'preserve-drone',kind:'drone',name:drone.name,droneId:drone.id,positionRole:'team',x:65,y:60,updatedAt:now}];
    archiveFieldGrid(S,'가상 격자 변경 전');resetSpatialGrid(S,false);
    S.grid.layout=FieldGeometry.layout({cx:.5,cy:.5,w:.55,h:.4,angle:20,aspect:4/3});
    S.grid.regions=[{id:'preserve-region-previous',name:'가상 이전 자유 구역',points:[{x:.15,y:.15},{x:.4,y:.15},{x:.4,y:.4},{x:.15,y:.4}],s:2,by:'가상 지상팀'}];
    const key=aiKey(S.ai.candidates[0]);aiResponseDrafts[key]={note:'기존 AI 후보 대응 원문 <보존>',status:'notified'};aiSaveResponse(key);
    addEvent('note','가상 기존 상황 기록','C3',true);commit();
  });
  await page.locator('#mapFileInput').setInputFiles({name:'synthetic-current-map.png',mimeType:'image/png',buffer:Buffer.from(images[1],'base64')});
  await page.waitForFunction(()=>S.grid.hasMap&&mapPayloadReady());
  await page.evaluate(()=>{
    const now=Date.now(),drone=S.drones[0];
    S.grid.geo={north:35.96,south:35.89,west:127.16,east:127.28,src:'manual',at:now};
    S.grid.layout=FieldGeometry.layout({cx:.5,cy:.5,w:.5,h:.35,angle:-15,aspect:4/3});
    S.grid.regions=[{id:'preserve-region-current',name:'가상 현재 자유 구역',points:[{x:.2,y:.2},{x:.45,y:.2},{x:.45,y:.45},{x:.2,y:.45}],s:1,by:'가상 B팀'}];
    S.grid.cells.D4={s:3,by:'지상'};S.grid.pinLast={x:22,y:35};S.grid.pinFound={x:72,y:66};
    S.grid.equipment=[{id:'preserve-pump-current',kind:'pump',name:'가상 현재 펌프',droneId:'',positionRole:'team',x:28,y:45,updatedAt:now},{id:'preserve-drone-current',kind:'drone',name:drone.name,droneId:drone.id,positionRole:'reported',x:63,y:60,updatedAt:now}];
    S.grid.viewLock={lat:35.925,lon:127.22,zoom:13,source:'naver'};commit();
  });
  await page.waitForFunction(()=>mapPayloadReady());await page.reload();await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock()&&mapPayloadReady());
  const old=await payload(page);await writeFile(path.join(out,'before-v1.4.0.json'),JSON.stringify(old,null,2));
  check('이전 앱 정규화 자료에 현재·이전 사진과 회전·자유 구역·장비·후보 대응이 포함',old.grid.history.length>=2&&old.grid.layout&&old.grid.regions.length===1&&old.grid.equipment.length===2&&Object.keys(old.gridHistoryImages).length>=1&&old.ai.candidates[0].responseNote==='기존 AI 후보 대응 원문 <보존>'&&old.events.some(e=>e.text==='가상 기존 상황 기록'));
  await page.goto(base);await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock()&&mapPayloadReady());
  const upgraded=await payload(page);await writeFile(path.join(out,'after-upgrade.json'),JSON.stringify(upgraded,null,2));
  check('v1.4.0에서 새 앱으로 재열어도 버전 표기 외 모든 저장값·이미지 동일',isDeepStrictEqual(withoutVersion(old),withoutVersion(upgraded)));
  await page.locator('#tab-grid').click();
  await changeChoices(page);await page.locator('[data-stage-action="online"]').click();
  await page.locator('[data-position-action="open"]').click();await page.locator('dialog.field-dialog').waitFor();
  await page.locator('dialog.field-dialog [data-field-close]').last().click();
  check('지도 종류 선택·네이버 연결창 열기와 취소가 전체 업무 자료 보존',isDeepStrictEqual(await payload(page),upgraded));
  await changeChoices(page);await page.getByRole('button',{name:'지역 지도 미리 저장',exact:true}).click();
  check('저장 지도 준비 안내 보기만으로 지도·핀·장비·안전·기록 불변',isDeepStrictEqual(await payload(page),upgraded));
  await page.locator('#tab-grid').click();await changeChoices(page);
  const choosing=page.waitForEvent('filechooser');choosing.catch(()=>{});await page.getByRole('button',{name:'지도·현장 사진 넣기',exact:true}).first().click();await(await choosing).setFiles([]);
  check('지도 사진 선택을 취소하면 과거 구역 이미지까지 그대로 보존',isDeepStrictEqual(await payload(page),upgraded));
  await page.locator('[data-map-host="consMap"][data-map-action="expand"]').click();
  const cameraBefore=await page.evaluate(()=>JSON.parse(JSON.stringify(mapViewState($('consMap')))));
  await openTools(page);await page.locator('[data-map-tools-close]').click();
  check('큰 지도 도구를 열고 닫아도 지도 배율·위치와 전체 업무 자료 불변',isDeepStrictEqual(await page.evaluate(()=>JSON.parse(JSON.stringify(mapViewState($('consMap'))))),cameraBefore)&&isDeepStrictEqual(await payload(page),upgraded));
  await page.screenshot({path:path.join(out,'preserved-large-map-desktop.png'),scale:'css'});
  await page.setViewportSize({width:320,height:800});await openTools(page);await page.locator('[data-map-tools-close]').click();
  await page.screenshot({path:path.join(out,'preserved-large-map-320.png'),scale:'css'});
  check('작은 화면 도구 왕복·크기 변경도 현재·이전 지도와 기록을 변경하지 않음',isDeepStrictEqual(await payload(page),upgraded));
  await page.getByRole('button',{name:'지도 닫기',exact:true}).click();await page.setViewportSize({width:1366,height:1000});
  await page.locator('#tab-data').click();const downloading=page.waitForEvent('download');downloading.catch(()=>{});await page.locator('#sec-data [data-act="export"]').click();const downloaded=await downloading,backup=path.join(out,'portable-backup.json');await downloaded.saveAs(backup);
  const portable=JSON.parse(await readFile(backup,'utf8'));
  check('실제 다운로드한 백업에 기존 전체 자료·현재 및 과거 사진·후보 이미지 포함',isDeepStrictEqual(portable,upgraded));
  const restoredContext=await newContext(),restoredPage=await restoredContext.newPage();await restoredPage.goto(base);await restoredPage.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  const importChoice=restoredPage.waitForEvent('filechooser');importChoice.catch(()=>{});await restoredPage.locator('[data-onboard-action="import"]').click();await(await importChoice).setFiles(backup);await restoredPage.waitForFunction(()=>S.mission.title==='가상 기존자료 보존'&&S.grid.equipment.length===2&&mapPayloadReady());
  const restored=await payload(restoredPage),expected=structuredClone(portable);delete restored.meta;delete expected.meta;expected.grid.mapVer++;expected.grid.mapId=restored.grid.mapId;
  await writeFile(path.join(out,'after-portable-restore.json'),JSON.stringify(restored,null,2));
  check('새 브라우저 복원은 허용된 메타·현재 지도 참조 외 모든 자료·이미지 동일',isDeepStrictEqual(restored,expected));
  check('복원된 과거 구역 이력의 장비·회전·자유 구역과 과거 사진 본체 보존',isDeepStrictEqual(restored.grid.history,portable.grid.history)&&isDeepStrictEqual(restored.gridHistoryImages,portable.gridHistoryImages)&&isDeepStrictEqual(restored.aiImages,portable.aiImages));
  const popup=context.waitForEvent('page');popup.catch(()=>{});await page.locator('#btnOpenDisplay').click();const display=await popup;await display.waitForFunction(()=>typeof S==='object'&&S.grid.equipment.length===2&&mapPayloadReady());
  const shown=await payload(display);
  check('표출창도 동일 현재·이전 지도·기체·장비·후보·기록을 수신',isDeepStrictEqual(shown,upgraded)&&await display.locator('#mapWrap [data-equipment-id]').count()===2);
  await display.screenshot({path:path.join(out,'preserved-display.png'),scale:'css'});await display.close();
  const practice=await context.newPage();await practice.goto(base+'?practice=1');await practice.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  check('연습 공간은 실제 장비·현재 및 과거 지도 이력을 가져오지 않음',await practice.evaluate(()=>PRACTICE_MODE&&S.grid.equipment.length===0&&S.grid.history.length===0&&S.mission.title!=='가상 기존자료 보존'));
  await practice.locator('#tab-mission').click();await practice.locator('[data-path="mission.title"]').fill('별도 연습 가상 상황');await practice.locator('[data-path="mission.title"]').press('Tab');await practice.waitForFunction(()=>!consoleIdleTimer);await practice.close();
  check('연습 입력·닫기 후 실제 백업 전체값은 그대로 유지',isDeepStrictEqual(await payload(page),upgraded));
  await page.reload();await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock()&&mapPayloadReady());
  check('새 앱 재시작 후에도 모든 원문·이력·사진·배치값 보존',isDeepStrictEqual(await payload(page),upgraded));
  check('실행 중 JavaScript 오류 없음',errors.length===0,errors);
  check('시험 중 외부 지도·기상 요청 없음',external.length===0,external);
}catch(error){fatal=error.stack||String(error);check('전체 보존 검증 시나리오 완료',false,fatal);if(page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png'),fullPage:false}).catch(()=>{});}
finally{await writeFile(path.join(out,'results.json'),JSON.stringify({sourceBefore,sourceAfter:await sourceDigest(),passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,external,results,fatal},null,2));await browser.close();await new Promise(r=>server.close(r));}
assert.equal(results.filter(r=>!r.pass).length,0,'Novice map preservation validation failed');
