/* Real-browser layout, persisted-record upgrade, and two-window checks.
 * node tests/layout-browser.mjs --modules /absolute/node_modules
 * --before /path/to/previous/stayup-dash.html also exercises the old app first.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules');
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const out=path.resolve(option('--out')||path.join(root,'output/playwright/layout'));
await mkdir(out,{recursive:true});
const old=option('--before')?await readFile(option('--before')):null;
const server=createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+u.pathname);
    if(!file.startsWith(root+path.sep))throw Error('Invalid path');
    res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'application/json');
    res.setHeader('Cache-Control','no-store');
    res.end(old&&u.searchParams.has('previous')&&u.pathname==='/stayup-dash.html'?old:await readFile(file));
  }catch(_){res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port,url=origin+'/stayup-dash.html';
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[],errors=[],measurements=[];
function check(name,pass,details){results.push({name,pass:!!pass,details});console.log((pass?'PASS ':'FAIL ')+name);}
try{
  const context=await browser.newContext({viewport:{width:1366,height:768},serviceWorkers:'block',reducedMotion:'reduce'});
  const page=await context.newPage();page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url+(old?'?previous=1':''));await page.waitForFunction(()=>typeof S!=='undefined'&&ownsEditorLock());
  await page.evaluate(()=>{
    loadSample();S.weather.auto=false;S.mission.title='가상 훈련 · 기존 기록 보존 검증';
    S.mission.priorityOrder='계곡 하류 D–E열 우선 확인. 후보 확인 후 지상팀에 전달.';
    S.mission.orders='기존 지휘부 지시 전문\n좌표와 현장 조건을 확인한 뒤 지상팀과 공유하세요. '.repeat(18);
    S.grid.cells.C3={s:1,by:'비행팀 1'};S.grid.pinLast={x:32,y:41};commit();
  });
  await page.locator('[data-ai-file]').setInputFiles(path.join(root,'tests/fixtures/stayup-photo-candidates-v1.json'));
  await page.waitForFunction(()=>S.ai.candidates.length===2&&mapPayloadReady());
  await page.evaluate(()=>{const key=aiKey(S.ai.candidates[0]);aiResponseDrafts[key]={note:'기존 대응 기록 보존 <img src=x>',status:'notified'};aiSaveResponse(key);});
  // Use the previous app's own persisted/normalized state as the upgrade baseline.
  await page.reload();await page.waitForFunction(()=>typeof S!=='undefined'&&ownsEditorLock()&&mapPayloadReady());
  const saved=await page.evaluate(()=>exportPayload(true));
  await writeFile(path.join(out,'saved-before.json'),saved);
  if(old)await page.screenshot({path:path.join(out,'before-console-1366.png'),fullPage:false});
  await page.goto(url);await page.waitForFunction(()=>typeof S!=='undefined'&&ownsEditorLock()&&mapPayloadReady());
  const afterUpgrade=await page.evaluate(()=>exportPayload(true));await writeFile(path.join(out,'saved-after.json'),afterUpgrade);
  const previousRecord=JSON.parse(saved),updatedRecord=JSON.parse(afterUpgrade);
  delete previousRecord.appVersion;delete updatedRecord.appVersion;
  check('앱 버전 표기 외 상황·격자·핀·인원·기체·후보 이미지·대응·이벤트를 그대로 유지',JSON.stringify(updatedRecord)===JSON.stringify(previousRecord));
  const readonly=await context.newPage();await readonly.goto(url);await readonly.waitForFunction(()=>typeof S!=='undefined'&&!ownsEditorLock());
  const readOnlyBefore=await readonly.evaluate(()=>exportPayload(true));
  await readonly.locator('[data-priority-toggle="console"]').click();
  check('읽기 전용 창도 권한 변경 없이 지시 전문 열람',await readonly.locator('#consolePriorityDetails').isVisible()&&await readonly.evaluate(()=>!ownsEditorLock()&&exportPayload(true))===readOnlyBefore);
  await readonly.close();
  const popup=context.waitForEvent('page');await page.locator('#btnOpenDisplay').click();const display=await popup;
  display.on('pageerror',e=>errors.push(e.message));await display.waitForFunction(()=>typeof S!=='undefined'&&S.ai.candidates.length===2&&mapPayloadReady());
  for(const [w,h] of [[1920,1080],[1440,900],[1366,768],[1280,720]]){
    await display.setViewportSize({width:w,height:h});
    for(const preset of ['standard','far']){
      await page.evaluate(p=>{S.ui.viewPreset=p;commit();},preset);
      await display.waitForFunction(p=>S.ui.viewPreset===p,preset);
      await display.locator('#displayPriority [data-priority-text]').waitFor();
      const m=await display.evaluate(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width,height:r.height};};return {w:innerWidth,h:innerHeight,docWidth:document.documentElement.scrollWidth,docHeight:document.documentElement.scrollHeight,map:rect('#mapWrap'),priority:rect('#displayPriority'),main:rect('#board .cols')};});
      measurements.push({preset,...m});
      check(`${w}×${h} ${preset}: 문서 넘침과 지시·본문 겹침 없음`,m.docWidth<=w+1&&m.docHeight<=h+1&&m.main.bottom<=m.priority.top+1&&m.priority.bottom<=h,m);
      check(`${w}×${h} ${preset}: 지도 폭·높이 확보`,m.map.width>=400&&m.map.height>=150,m.map);
      check(`${w}×${h} ${preset}: 우선 지시 전체 표시`,await display.locator('#displayPriority [data-priority-text]').evaluate(el=>el.scrollHeight<=el.clientHeight+1&&el.textContent.includes('지상팀에 전달')));
      check(`${w}×${h} ${preset}: 경보음 준비가 지시·상세 버튼을 가리지 않음`,await display.locator('#audioArm').evaluate(e=>{const a=e.getBoundingClientRect(),p=document.querySelector('#displayPriority').getBoundingClientRect();return a.bottom<=p.top||a.top>=p.bottom;}));
      await display.screenshot({path:path.join(out,`display-${w}-${preset}.png`),fullPage:false});
    }
  }
  await display.setViewportSize({width:1366,height:768});
  await page.evaluate(()=>{S.ui.scale=1;S.ui.viewPreset='standard';commit();});await display.waitForFunction(()=>S.ui.scale===1&&S.ui.viewPreset==='standard');
  const normalFont=await display.locator('#vGolden').evaluate(e=>parseFloat(getComputedStyle(e).fontSize));
  await page.evaluate(()=>{S.ui.scale=1.5;commit();});await display.waitForFunction(()=>S.ui.scale===1.5);
  check('노트북에서도 기존 글자 배율 조절 반영',await display.locator('#vGolden').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))>normalFont);
  const scaled=await display.locator('#mapWrap').boundingBox(),scaledPriority=await display.locator('#displayPriority').boundingBox();
  check('노트북 1.5배에서도 지도와 지시 유지',scaled.height>=150&&scaled.y+scaled.height<=scaledPriority.y&&scaledPriority.y+scaledPriority.height<=768,{scaled,scaledPriority});
  await page.evaluate(()=>{S.ui.scale=1;commit();});
  await display.setViewportSize({width:1366,height:640});
  await display.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  const low=await display.locator('#displayPriority').boundingBox();
  check('640px 높이는 축소·잘림 대신 스크롤로 지시에 접근',low.y>=0&&low.y+low.height<=640&&await display.evaluate(()=>getComputedStyle(document.body).overflowY==='auto'),low);
  await display.setViewportSize({width:1366,height:768});
  await page.evaluate(()=>{S.ui.viewPreset='standard';commit();});
  for(const [w,h] of [[390,844],[360,800]]){
    await page.setViewportSize({width:w,height:h});await page.evaluate(()=>window.scrollTo(0,0));
    const first=await page.locator('#consolePriority').boundingBox();
    check(`${w}px 조작: 첫 화면에 우선 지시`,first.y>=0&&first.y+first.height<h,first);
    await page.screenshot({path:path.join(out,`console-${w}-top.png`),fullPage:false});
    await page.locator('.skip-priority').focus();await page.keyboard.press('Enter');
    check(`${w}px 조작: 건너뛰기로 지시에 실제 포커스`,await page.locator('#consolePriority').evaluate(e=>e===document.activeElement));
    const toggle=page.locator('[data-priority-toggle="console"]');
    check(`${w}px 조작: 상세 버튼 44px 이상`,(await toggle.boundingBox()).height>=44);
    await toggle.focus();await page.keyboard.press('Enter');
    check(`${w}px 조작: 긴 전문을 펼쳐 모두 읽을 수 있음`,await page.locator('#consolePriorityDetails').isVisible()&&(await page.locator('[data-priority-full]').innerText()).includes('기존 지휘부 지시 전문'));
    await page.screenshot({path:path.join(out,`console-${w}-details.png`),fullPage:false});
    await page.keyboard.press('Space');
    check(`${w}px 조작: Space로 상세 접기`,await toggle.getAttribute('aria-expanded')==='false');
    await page.evaluate(()=>window.scrollTo(0,1400));
    const sticky=await page.locator('.console-workspace-bar').boundingBox(),verdict=await page.locator('.mobile-verdict').boundingBox();
    check(`${w}px 조작: 지시와 안전 판정이 함께 상단 유지`,sticky.y>=-1&&sticky.y<=2&&verdict.y>=sticky.y&&verdict.y+verdict.height<h,{sticky,verdict});
    check(`${w}px 조작: 가로 넘침 없음`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:path.join(out,`console-${w}-scrolled.png`),fullPage:false});
    await page.locator('.mobile-nav [data-sec="sec-grid"]').click();
    const heading=await page.locator('#sec-grid h2').boundingBox(),brief=await page.locator('.operation-brief').boundingBox();
    check(`${w}px 조작: 지도 이동 후 제목을 고정 지시가 가리지 않음`,heading.y>=brief.y+brief.height-2,{heading,brief});
    await display.setViewportSize({width:w,height:h});
    await display.waitForFunction(()=>document.querySelector('#board .hdr').nextElementSibling===document.querySelector('#displayPriority'));
    await display.evaluate(()=>window.scrollTo(0,0));
    const dfirst=await display.locator('#displayPriority').boundingBox();
    check(`${w}px 표출: 첫 화면에 우선 지시`,dfirst.y>=0&&dfirst.y+dfirst.height<h,dfirst);
    await display.screenshot({path:path.join(out,`display-${w}-top.png`),fullPage:false});
    await display.evaluate(()=>window.scrollTo(0,1200));
    const dscroll=await display.locator('#displayPriority').boundingBox();
    check(`${w}px 표출: 스크롤 중 지시가 상단 유지`,dscroll.y>=-1&&dscroll.y<=2,dscroll);
    await display.locator('[data-priority-toggle="display"]').click();
    check(`${w}px 표출: 전문 상세 열기`,await display.locator('#displayPriorityDetails').isVisible());
    await display.locator('[data-priority-toggle="display"]').click();
    await display.setViewportSize({width:1366,height:768});
    await display.waitForFunction(()=>document.querySelector('#displayPriority').previousSibling.nodeType===8);
    check(`${w}px→PC: 지시 중복 없이 원위치 복귀`,await display.locator('#displayPriority').count()===1);
  }
  await page.setViewportSize({width:1366,height:768});
  const stateBeforeTabs=await page.evaluate(()=>exportPayload(true));
  for(const [key,label] of [['quick','즉시조작'],['mission','상황'],['subject','실종자'],['drone','드론'],['batt','배터리'],['crew','인원'],['grid','수색구역'],['ai','AI 후보'],['safety','안전·기상'],['data','데이터']]){
    await page.locator('#tab-'+key).click();
    check(`${label}: 선택한 입력 영역만 표시`,await page.evaluate(key=>{
      const panels=[...document.querySelectorAll('#consoleRoot [role="tabpanel"]')].filter(p=>p.getClientRects().length);
      return panels.length===1&&panels[0].id==='sec-'+key&&document.querySelector('#tab-'+key).getAttribute('aria-selected')==='true';
    },key));
    if(['mission','drone','grid','ai'].includes(key))await page.screenshot({path:path.join(out,`console-tab-${key}-1366.png`),fullPage:false});
  }
  check('실제 메뉴 클릭은 기존 상황·기체·핀·후보·기록을 변경하지 않음',await page.evaluate(()=>exportPayload(true))===stateBeforeTabs);
  await page.locator('#tab-quick').click();await page.locator('#tab-quick').focus();
  await page.keyboard.press('ArrowRight');
  check('실제 방향키로 포커스만 이동하고 선택 상태 유지',await page.locator('#tab-mission').evaluate(e=>e===document.activeElement)&&await page.locator('#tab-quick').getAttribute('aria-selected')==='true');
  await page.keyboard.press('Enter');
  check('Enter로 선택한 입력 탭 활성화',await page.locator('#sec-mission').isVisible()&&await page.locator('#tab-mission').getAttribute('aria-selected')==='true');
  await page.evaluate(()=>scrollToSection(document.querySelector('#consoleRoot'),document.querySelector('#sec-mission')));
  await page.locator('[data-path="mission.priorityOrder"]').fill('통신 확인 후 C3 후보를 지상팀과 대조하세요.');
  await display.waitForFunction(()=>document.querySelector('#displayPriority [data-priority-text]').textContent.includes('C3 후보'));
  check('우선 지시 편집이 조작·표출 창에 즉시 동기화',(await page.locator('#consolePriority [data-priority-text]').innerText()).includes('C3 후보'));
  await page.locator('[data-path="mission.priorityOrder"]').fill('');
  check('긴 전문에서 지시를 임의 요약하지 않음',(await page.locator('#consolePriority [data-priority-text]').innerText()).includes('우선 지시 미입력'));
  await page.locator('[data-path="mission.priorityOrder"]').fill('계곡 하류 D–E열 우선 확인. 후보 확인 후 지상팀에 전달.');
  await page.evaluate(()=>renderConsole(document.querySelector('#consoleRoot')));
  await page.locator('[data-ai-action="section"]').first().click();
  await page.locator('[data-ai-response="note"]').first().fill('반응형 전환 중 대응 메모 초안');
  await page.setViewportSize({width:390,height:844});await page.setViewportSize({width:1366,height:768});
  check('화면 크기 변경이 작성 중 대응 메모를 보존',await page.locator('[data-ai-response="note"]').first().inputValue()==='반응형 전환 중 대응 메모 초안');
  await page.locator('#tab-drone').click();await page.locator('#tab-ai').click();
  check('다른 입력 탭을 다녀와도 저장 전 AI 대응 메모 보존',await page.locator('[data-ai-response="note"]').first().inputValue()==='반응형 전환 중 대응 메모 초안');
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>{const e=document.querySelector('#tab-ai'),a=e.getBoundingClientRect(),b=e.parentElement.getBoundingClientRect();return a.left>=b.left-2&&a.right<=b.right+2;});
  check('화면을 줄여도 선택한 메뉴가 가로 스크롤 밖으로 사라지지 않음',await page.locator('#tab-ai').evaluate(e=>{const a=e.getBoundingClientRect(),b=e.parentElement.getBoundingClientRect();return a.left>=b.left-2&&a.right<=b.right+2;}));
  await page.screenshot({path:path.join(out,'console-tab-ai-390.png'),fullPage:false});
  await page.evaluate(()=>renderConsole(document.querySelector('#consoleRoot')));
  check('입력 영역 재표시 뒤에도 선택 메뉴와 작성 중 메모 유지',await page.locator('#tab-ai').evaluate(e=>{const a=e.getBoundingClientRect(),b=e.parentElement.getBoundingClientRect();return a.left>=b.left-2&&a.right<=b.right+2&&e.getAttribute('aria-selected')==='true';})&&await page.locator('[data-ai-response="note"]').first().inputValue()==='반응형 전환 중 대응 메모 초안');
  await page.setViewportSize({width:1366,height:768});
  check('보기·상세 펼침·크기 변경이 기존 대응 기록을 덮어쓰지 않음',await page.evaluate(()=>S.ai.candidates[0].responseNote)==='기존 대응 기록 보존 <img src=x>');
  await page.locator('[data-priority-toggle="console"]').click();
  const beforeView=await page.evaluate(()=>exportPayload(true));
  await page.locator('[data-priority-toggle="console"]').click();await display.locator('[data-priority-toggle="display"]').click();await display.locator('[data-priority-toggle="display"]').click();
  check('상세 펼침 자체는 저장 상태·리비전·이벤트를 바꾸지 않음',await page.evaluate(()=>exportPayload(true))===beforeView);
  await page.locator('#tab-data').click();
  const downloadEvent=page.waitForEvent('download');await page.locator('[data-act="export"]').click();const download=await downloadEvent;
  const backupPath=path.join(out,'exported-backup.json');await download.saveAs(backupPath);
  const backup=JSON.parse(await readFile(backupPath,'utf8'));
  check('실제 JSON 다운로드에 기존 기록·후보 이미지 포함',backup.ai.candidates[0].responseNote==='기존 대응 기록 보존 <img src=x>'&&Object.keys(backup.aiImages).length>0&&backup.grid.cells.C3.s===1);
  await page.reload();await page.waitForFunction(()=>typeof S!=='undefined'&&mapPayloadReady());
  check('새로고침 후 후보·대응·지시 복원',await page.evaluate(()=>S.ai.candidates[0].responseNote==='기존 대응 기록 보존 <img src=x>'&&S.mission.priorityOrder.includes('D–E열')));
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(out,'console-1366.png'),fullPage:false});
  if(!process.argv.includes('--skip-regression')){
    // The regression suite intentionally corrupts/purges storage; isolate it
    // from the normal two-window scenario rather than sharing its origin data.
    const regressionContext=await browser.newContext({serviceWorkers:'block'});
    const regression=await regressionContext.newPage();await regression.goto(origin+'/tests/regression.html');
    await regression.waitForFunction(()=>window.__REGRESSION__,{},{timeout:180000});
    const result=await regression.evaluate(()=>window.__REGRESSION__);await writeFile(path.join(out,'regression.json'),JSON.stringify(result,null,2));
    check('전체 기존 브라우저 회귀 검사',result.fail===0&&!result.error,result);
    await regressionContext.close();
  }
  check('페이지 실행 오류 없음',errors.length===0,[...errors]);
}finally{
  await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,measurements,results},null,2));
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass).map(r=>r.name)}));
assert.equal(results.filter(r=>!r.pass).length,0,'Browser verification failed');
