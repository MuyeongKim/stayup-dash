/* A new employee follows the visible next action from a blank incident to a
 * downloaded backup. Artificial records, local images and disposable Chrome only. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-beginner-flow';await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=process.argv.includes('--file')?pathToFileURL(path.join(root,'stayup-dash.html')).href:'http://127.0.0.1:'+server.address().port+'/stayup-dash.html';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1366,height:900},deviceScaleFactor:2,serviceWorkers:'block',reducedMotion:'reduce'});
const results=[],errors=[],dialogs=[];
const check=(name,pass)=>{results.push({name,pass:!!pass});console.log((pass?'PASS ':'FAIL ')+name);};
const page=await context.newPage();page.setDefaultTimeout(7000);
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());await d.accept();});
const state=()=>page.evaluate(()=>JSON.parse(exportPayload(true)));
async function next(expected){await page.locator('.onboarding-next .btn.primary').click();await page.waitForFunction(id=>consoleActiveSection==='sec-'+id,expected);check('다음 버튼으로 '+expected+' 입력 한 영역만 표시',await page.locator('[role="tabpanel"]:visible').count()===1&&await page.locator('#sec-'+expected).isVisible());}
try{
  await page.goto(url);await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  // Keep fake coordinates and browser downloads out of background timers.
  await page.evaluate(()=>{S.weather.auto=false;S.ui.autoSave=false;commitLight();});
  check('처음에는 상황 입력을 선택하고 쉬운 시작 버튼 제공',await page.locator('#tab-mission').getAttribute('aria-selected')==='true'&&await page.locator('[data-onboard-action="new"]').innerText()==='새 수색 준비');
  check('처음 안내의 상세 정보는 접힌 상태',await page.locator('[data-onboard-fold]').evaluateAll(es=>es.every(e=>!e.open)));
  await page.screenshot({path:path.join(out,'start-1366.png'),scale:'css'});
  await page.locator('[data-onboard-action="new"]').click();
  check('시작하면 첫 입력에 초점을 두고 순서 1/8 표시',await page.locator('[data-path="mission.title"]').evaluate(e=>e===document.activeElement)&&await page.locator('.onboarding-next').innerText().then(t=>t.includes('1 / 8')));
  await page.locator('[data-path="mission.title"]').fill('가상 직원의 첫 수색');await page.locator('[data-path="mission.location"]').fill('가상 훈련 구역');
  await next('subject');await page.locator('[data-path="subject.name"]').fill('대상 A');
  await next('crew');await page.locator('#btnAddCrew').click();
  check('인원 추가 버튼은 충분한 높이와 새 입력 위치를 제공',await page.locator('#btnAddCrew').evaluate(e=>e.getBoundingClientRect().height>=44)&&await page.locator('[data-path="crew.0.name"]').evaluate(e=>e===document.activeElement));
  await page.locator('[data-path="crew.0.name"]').fill('조종 A');await page.locator('[data-path="crew.0.name"]').press('Tab');await page.waitForFunction(()=>!consoleIdleTimer);
  await next('drone');await page.locator('#btnAddDrone').click();
  check('드론 추가 버튼도 충분한 높이와 조종자 입력 초점을 제공',await page.locator('#btnAddDrone').evaluate(e=>e.getBoundingClientRect().height>=44)&&await page.locator('[data-path="drones.0.pilot"]').evaluate(e=>e===document.activeElement));
  await page.locator('[data-pilot-target]').first().selectOption('조종 A');await page.waitForFunction(()=>!consoleIdleTimer);
  check('작성한 인원과 드론 조종자를 연결하고 원래 이름 보존',await page.evaluate(()=>S.crew[0].name==='조종 A'&&S.drones[0].pilot==='조종 A'&&S.mission.title==='가상 직원의 첫 수색'));
  await next('grid');
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=750;const g=c.getContext('2d');g.fillStyle='#dce9df';g.fillRect(0,0,c.width,c.height);g.fillStyle='#234a38';g.font='40px sans-serif';g.fillText('가상 지도 · 실제 지형 아님',60,100);return c.toDataURL('image/png').split(',')[1];});
  const fixture=path.join(out,'synthetic-map.png');await writeFile(fixture,Buffer.from(png,'base64'));
  const chooser=page.waitForEvent('filechooser');chooser.catch(()=>{});await page.locator('[data-act="mapfile"]').first().click();await(await chooser).setFiles(fixture);await page.waitForFunction(()=>S.grid.hasMap&&mapPayloadReady());
  await next('safety');check('순서 이동과 입력 현황을 실제 비행승인으로 처리하지 않음',await page.evaluate(()=>S.safety.approval==='unknown'&&flightVerdict(new Date()).lv!=='ok'));
  await next('quick');await page.locator('#evType').selectOption('note');await page.locator('#evText').fill('가상 구역을 다시 확인함');await page.locator('#btnAddEv').click();
  check('쉬운 기록 버튼은 이력만 남기고 기체 상태를 바꾸지 않음',await page.evaluate(()=>S.events.at(-1).text==='가상 구역을 다시 확인함'&&S.drones[0].status==='ready'));
  await next('data');
  check('마지막 단계는 처음으로 돌지 않고 백업 저장으로 끝남',await page.locator('.onboarding-next .btn.primary').innerText()==='상황 백업 저장'&&await page.locator('.onboarding-next').innerText().then(t=>t.includes('8 / 8')));
  const before=await state(),downloaded=page.waitForEvent('download');downloaded.catch(()=>{});await page.locator('.onboarding-next .btn.primary').click();const file=await downloaded;const saved=path.join(out,'first-employee-backup.json');await file.saveAs(saved);
  check('마지막 버튼의 실제 백업에 전체 입력·사진·기록 포함',isDeepStrictEqual(JSON.parse(await readFile(saved,'utf8')),before)&&isDeepStrictEqual(await state(),before));
  check('파일 요청 뒤 다운로드 확인 안내를 보여 주고 보관 완료로 단정하지 않음',await page.locator('#sec-data [data-manual-backup-status]').innerText().then(t=>t.includes('요청')&&t.includes('파일을 확인')&&!t.includes('저장 완료')));
  check('백업 결과 안내는 업무 저장 형식에 새 필드를 넣지 않음',!Object.hasOwn(before,'lastManualBackup')&&!Object.hasOwn(before,'guidedStarted'));
  for(const [width,height,theme] of [[390,844,'light'],[320,800,'dark']]){
    await page.setViewportSize({width,height});await page.locator('[data-theme-target="console"][data-theme-value="'+theme+'"]').click();await page.locator('#tab-data').click();
    check(width+'px에서 첫 백업 버튼이 44px 이상으로 고정 메뉴 사이에 보임',await page.locator('#sec-data [data-act="export"]').evaluate(e=>{const r=e.getBoundingClientRect(),bar=document.querySelector('.console-workspace-bar').getBoundingClientRect(),bottom=document.querySelector('.mobile-nav').getBoundingClientRect();return r.height>=44&&r.top>=bar.bottom-1&&r.bottom<=bottom.top+1;})&&await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:path.join(out,'backup-'+width+'-'+theme+'.png'),scale:'css'});
  }
  await page.setViewportSize({width:1366,height:900});
  for(const key of ['mission','subject','crew','drone','grid','safety','quick','data','batt','ai'])await page.locator('#tab-'+key).click();
  check('일반 메뉴와 추가 기능 왕복이 전체 자료·사진을 보존',isDeepStrictEqual(await state(),before));
  await page.locator('#tab-mission').click();await page.locator('[data-path="mission.title"]').fill('가상 직원의 첫 수색 수정');await page.locator('[data-path="mission.title"]').press('Tab');await page.waitForFunction(()=>!consoleIdleTimer);await page.locator('#tab-data').click();
  check('백업 후 입력을 바꾸면 최신 내용 재백업을 안내',await page.locator('#sec-data [data-manual-backup-status]').innerText().then(t=>t.includes('입력이 바뀌었습니다')));
  const modified=await state();await page.evaluate(()=>{window.originalBeginnerDownload=download;download=function(){throw new Error('가상 다운로드 실패');};});
  try{await page.locator('#sec-data [data-act="export"]').click();}finally{await page.evaluate(()=>{download=originalBeginnerDownload;delete window.originalBeginnerDownload;});}
  check('백업 요청 실패도 명확히 표시하며 전체 내용 유지',dialogs.at(-1)==='가상 다운로드 실패'&&await page.locator('#sec-data [data-manual-backup-status]').innerText().then(t=>t.includes('요청이 실패했습니다'))&&isDeepStrictEqual(await state(),modified));
  const finalDownload=page.waitForEvent('download');finalDownload.catch(()=>{});await page.locator('#sec-data [data-act="export"]').click();await(await finalDownload).saveAs(path.join(out,'retry-backup.json'));
  await page.reload();await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock()&&mapPayloadReady());
  check('다시 열어도 모든 업무 값·사진·활동 이력이 복원',isDeepStrictEqual(await state(),modified));
  check('요청 안내는 세션에만 있고 재시작 후 저장 완료 표시로 남지 않음',await page.evaluate(()=>lastManualBackup===null));
  check('페이지 실행 오류 없음',errors.length===0);
}finally{await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,results},null,2));await browser.close();await new Promise(r=>server.close(r));}
assert.equal(results.filter(r=>!r.pass).length,0,'Beginner flow validation failed');
