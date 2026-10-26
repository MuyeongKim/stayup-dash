/* Startup choices, cancellation, recovery and alert visibility. Disposable
 * Chrome contexts and synthetic records only; no real user profile is opened. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-start-screen';await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=process.argv.includes('--file')?pathToFileURL(path.join(root,'stayup-dash.html')).href:'http://127.0.0.1:'+server.address().port+'/stayup-dash.html';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1366,height:768},serviceWorkers:'block',reducedMotion:'reduce'});
const page=await context.newPage();page.setDefaultTimeout(7000);
const results=[],errors=[],dialogs=[];
const observe=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('dialog',async d=>{dialogs.push(d.message());await d.accept();});};observe(page);
const check=(name,pass)=>{results.push({name,pass:!!pass});console.log((pass?'PASS ':'FAIL ')+name);};
const payload=()=>page.evaluate(()=>JSON.parse(exportPayload(true)));
const home=()=>page.locator('.cons').evaluate(e=>e.classList.contains('is-start'));
try{
  await page.goto(url);await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  await page.evaluate(()=>{S.weather.auto=false;S.ui.autoSave=false;commitLight();});
  // Normalize the synthetic blank record through the existing startup migration
  // before measuring preservation (blank age is historically read back as null).
  await page.reload();await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  const empty=await payload();
  for(const [width,height] of [[1366,768],[390,844],[320,800],[390,400]]){
    await page.setViewportSize({width,height});
    const geometry=await page.locator('.start-actions').evaluate(e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,width:document.documentElement.scrollWidth,viewport:innerWidth,buttons:[...e.querySelectorAll('.btn')].map(b=>b.getBoundingClientRect().height)}));
    check(width+'×'+height+' 시작 화면은 세 선택과 첫 행동을 명확히 제공',await home()&&await page.locator('.start-actions .btn').count()===3&&geometry.top>=0&&geometry.width<=geometry.viewport+1&&geometry.buttons.every(h=>h>=52)&&(height<600||geometry.bottom<=height));
    check(width+'×'+height+' 시작 선택 전에 입력·미입력 현황·전체 메뉴를 숨김',await page.locator('[role="tabpanel"]:visible').count()===0&&!await page.locator('.console-workspace-bar').isVisible()&&!await page.locator('#ctKpi').isVisible()&&!await page.locator('.mobile-nav').isVisible());
    await page.screenshot({path:path.join(out,'start-'+width+'-'+height+'.png'),scale:'css'});
  }
  await page.setViewportSize({width:1366,height:768});
  const cancel=page.waitForEvent('filechooser');cancel.catch(()=>{});await page.locator('[data-onboard-action="import"]').click();await(await cancel).setFiles([]);
  check('시작 화면에서 파일 선택 취소는 시작 선택과 모든 값을 유지',await home()&&await page.locator('[data-onboard-action="new"]').isVisible()&&isDeepStrictEqual(await payload(),empty));
  const wrong=page.waitForEvent('filechooser');wrong.catch(()=>{});await page.locator('[data-onboard-action="import"]').click();const wrongNotice=page.waitForEvent('dialog');wrongNotice.catch(()=>{});await(await wrong).setFiles(path.join(root,'tests/fixtures/stayup-photo-candidates-v1.json'));await wrongNotice;
  check('다른 종류 파일을 고르면 안내 후 재시도 가능하고 내용 유지',await home()&&dialogs.some(t=>t.includes('탐지 사진')&&t.includes('불러오기'))&&isDeepStrictEqual(await payload(),empty));
  const viewer=await context.newPage();observe(viewer);await viewer.goto(url+'?viewer=1');await viewer.waitForFunction(()=>typeof S==='object'&&!ownsEditorLock());
  check('빈 보기 전용 화면도 잠금 안내와 입력권 전환을 가리지 않음',await viewer.locator('[data-editor-help]').isVisible()&&await viewer.locator('[data-act="takecontrol"]').isVisible()&&!await viewer.locator('[data-onboard-action="new"]').isEnabled()&&!await viewer.locator('[data-onboard-action="import"]').isEnabled());await viewer.close();
  const saveStatus=await page.evaluate(()=>Object.assign({},SAVE_STATUS));await page.evaluate(()=>{SAVE_STATUS.ok=false;renderConsole(document.getElementById('consoleRoot'));});
  check('시작 화면에서도 저장 실패는 숨기지 않고 표시',await home()&&await page.locator('#savePill').isVisible()&&await page.locator('#savePill').innerText()==='저장 실패');
  await page.evaluate(value=>{Object.assign(SAVE_STATUS,value);renderConsole(document.getElementById('consoleRoot'));},saveStatus);
  await page.evaluate(()=>{S.safety.manned=true;renderAll();});
  check('유인기 경보가 있으면 빈 작업이어도 현황·경보를 숨기지 않음',!await home()&&await page.locator('#btnManned').isVisible()&&await page.locator('#btnManned').getAttribute('aria-pressed')==='true');
  await page.evaluate(()=>{S.safety.manned=false;renderAll();});
  check('보기 분기 검증 뒤 업무 값·리비전은 원래 값 유지',isDeepStrictEqual(await payload(),empty));
  await page.locator('[data-onboard-action="new"]').click();
  check('새 수색 준비는 첫 입력·기존 메뉴·안전·경보로 연결',!await home()&&await page.locator('[data-path="mission.title"]').evaluate(e=>e===document.activeElement)&&await page.locator('.console-workspace-bar').isVisible()&&await page.locator('#btnManned').isVisible()&&isDeepStrictEqual(await payload(),empty));
  check('상황 단계는 통신 상세만 두고 백업 설정·입력 현황을 앞세우지 않음',await page.locator('#sec-mission details[data-fold="mission-details"]').count()===1&&!await page.locator('#sec-data').isVisible()&&await page.locator('[data-onboard-fold="guide-readiness"]').count()===0);
  await page.locator('[data-theme-target="console"][data-theme-value="dark"]').click();await page.reload();await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  check('빈 작업의 야간 재시작도 시작 화면으로 돌아오고 자료 보존',await home()&&await page.locator('.cons').getAttribute('data-theme')==='dark'&&isDeepStrictEqual(await payload(),empty));
  await page.screenshot({path:path.join(out,'start-dark.png'),scale:'css'});
  const liveStorageKey=await page.evaluate(()=>KEY),practiceOpen=context.waitForEvent('page');practiceOpen.catch(()=>{});await page.locator('.start-actions a').click();const practice=await practiceOpen;observe(practice);await practice.waitForFunction(()=>typeof S==='object'&&PRACTICE_MODE&&S.drones.length>0);
  check('첫 화면의 연습 선택은 실제 자료와 분리된 작업·안내 제공',await practice.locator('.practice-badge').isVisible()&&await practice.evaluate(key=>KEY!==key,liveStorageKey)&&isDeepStrictEqual(await payload(),empty));
  await practice.close();
  await page.locator('[data-onboard-action="new"]').click();await page.locator('[data-path="mission.title"]').fill('시작 화면 검토 · 가상 상황');await page.locator('[data-path="mission.title"]').press('Tab');await page.waitForFunction(()=>!consoleIdleTimer);
  await page.locator('#tab-safety').click();check('전체 입력 확인은 안전 단계에서 접어 보도록 제공',await page.locator('[data-onboard-fold="guide-readiness"]').count()===1&&!await page.locator('[data-onboard-fold="guide-readiness"]').evaluate(e=>e.open));
  await page.locator('#tab-data').click();check('백업 단계에서 실제 자동 백업 설정에 접근 가능',await page.locator('#sec-data .data-task').nth(1).innerText().then(t=>t.includes('자동 백업')&&t.includes('30초')));
  const backup=await payload(),download=page.waitForEvent('download');download.catch(()=>{});await page.locator('#sec-data [data-act="export"]').click();const file=await download,backupFile=path.join(out,'saved-incident.json');await file.saveAs(backupFile);
  check('실제 저장한 백업은 모든 입력과 일치하고 보기 상태 필드 없음',isDeepStrictEqual(JSON.parse(await readFile(backupFile,'utf8')),backup)&&!Object.hasOwn(backup,'isStart'));
  await page.reload();await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());check('저장된 상황 재시작은 시작 선택을 강요하지 않고 기록 화면에서 이어짐',!await home()&&await page.locator('#sec-quick').isVisible()&&isDeepStrictEqual(await payload(),backup));
  const importedContext=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});const imported=await importedContext.newPage();observe(imported);await imported.goto(url);await imported.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  const chooser=imported.waitForEvent('filechooser');chooser.catch(()=>{});await imported.locator('[data-onboard-action="import"]').click();await(await chooser).setFiles(backupFile);await imported.waitForFunction(()=>S.mission.title==='시작 화면 검토 · 가상 상황');
  const actual=await imported.evaluate(()=>JSON.parse(exportPayload(true)));await writeFile(path.join(out,'import-before.json'),JSON.stringify(backup));await writeFile(path.join(out,'import-after.json'),JSON.stringify(actual));delete actual.meta;const expected=JSON.parse(JSON.stringify(backup));delete expected.meta;
  // Existing imports rotate metadata and increment the map revision even with
  // no photograph. Preserve that transaction contract and compare every value.
  expected.grid.mapVer++;
  check('시작 화면에서 백업을 열면 입력 화면으로 넘어가며 업무 자료 보존',!await imported.locator('.cons').evaluate(e=>e.classList.contains('is-start'))&&await imported.locator('[role="tabpanel"]:visible').count()===1&&isDeepStrictEqual(actual,expected));await importedContext.close();
  check('페이지 실행 오류 없음',errors.length===0);
}finally{await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,results},null,2));await browser.close();await new Promise(r=>server.close(r));}
assert.equal(results.filter(r=>!r.pass).length,0,'Start screen validation failed');
