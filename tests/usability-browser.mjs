/* Real Chrome: first use, day/night themes and isolated practice storage.
 * node tests/usability-browser.mjs --modules /absolute/node_modules --out /tmp/stayup-usability
 * All records are artificial and use a disposable browser context.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-usability';await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{
  try{const u=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+u.pathname);if(!file.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=process.argv.includes('--file')?pathToFileURL(path.join(root,'stayup-dash.html')).href:'http://127.0.0.1:'+server.address().port+'/stayup-dash.html';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1366,height:900},serviceWorkers:'block',reducedMotion:'reduce'});
const results=[],errors=[];
function check(name,pass,detail){results.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name);}
function observe(p){p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.type()==='prompt'?d.accept('완전삭제'):d.accept());}
const live=await context.newPage();observe(live);
async function addMap(page){
  await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=1600;c.height=900;c.getContext('2d').fillRect(0,0,1600,900);const b=await new Promise(r=>c.toBlob(r));fileToMap(new File([b],'가상-지도.png',{type:'image/png'}));});
  await page.waitForFunction(()=>S.grid.hasMap&&mapPayloadReady());
}
async function offlineMarker(page,name,write){
  return page.evaluate(async({name,write})=>{
    await STAYUP_OFFLINE.list();
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    return new Promise((resolve,reject)=>{const tx=db.transaction('tiles',write?'readwrite':'readonly'),store=tx.objectStore('tiles');
      const request=write?store.put({key:'isolated-storage-probe',bytes:new Uint8Array([1])}):store.get('isolated-storage-probe');
      let result;request.onsuccess=()=>result=request.result;tx.oncomplete=()=>{db.close();resolve(write?true:!!result);};tx.onerror=()=>reject(tx.error);
    });
  },{name,write});
}
try{
  await live.goto(url);await live.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  check('첫 화면은 주간 테마·시작·불러오기·분리된 연습 경로 제공',await live.locator('.cons').getAttribute('data-theme')==='light'&&await live.locator('#onboardingGuide').isVisible()&&await live.locator('[data-onboard-action="new"]').isVisible()&&await live.locator('a[href*="practice=1"]').getAttribute('rel')==='noopener');
  check('시작 안내에 첫 다운로드·변경 확인 주기·파일 확인 행동 명시',await live.locator('#onboardingGuide').innerText().then(t=>t.includes('30초')&&t.includes('첫 변경 확인')&&t.includes('10분')&&t.includes('다운로드 목록')));
  await live.screenshot({path:path.join(out,'first-start-light.png'),fullPage:false});
  for(const [w,h] of [[390,844],[320,800]]){
    await live.setViewportSize({width:w,height:h});
    await live.locator('#onboardingGuide [data-sec="sec-data"]').scrollIntoViewIfNeeded();
    check(`${w}px 시작 안내의 보관 버튼과 긴 설명 가로 넘침 없음`,await live.locator('#onboardingGuide [data-sec="sec-data"]').isVisible()&&await live.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await live.screenshot({path:path.join(out,`first-start-${w}.png`),fullPage:false});
  }
  await live.setViewportSize({width:1366,height:900});
  // Keep preservation checks stable when the new subject-form scenario reloads.
  // Automatic weather refresh has its own existing regression coverage.
  await live.evaluate(()=>{S.weather.auto=false;commitLight();});
  const beforeBackupNav=await live.evaluate(()=>exportPayload(true));
  await live.locator('#onboardingGuide [data-sec="sec-data"]').click();
  check('시작 안내에서 보관 설정으로 이동해도 업무 상태 보존',await live.locator('#sec-data').isVisible()&&await live.evaluate(()=>exportPayload(true))===beforeBackupNav);
  const beforeTheme=await live.evaluate(()=>exportPayload(true));
  await live.locator('[data-theme-target="console"][data-theme-value="dark"]').click();
  check('야간 날짜 컨트롤에 dark color-scheme 적용',await live.locator('[data-path="mission.dispatchedAt"]').evaluate(e=>getComputedStyle(e).colorScheme)==='dark');
  await live.locator('[data-theme-target="console"][data-theme-value="light"]').click();
  check('테마 변경은 상황·리비전·백업을 변경하지 않음',await live.evaluate(()=>exportPayload(true))===beforeTheme);
  await live.locator('[data-onboard-action="new"]').click();
  check('새 상황 시작은 상황 입력과 제목 포커스로 연결',await live.locator('#sec-mission').isVisible()&&await live.locator('[data-path="mission.title"]').evaluate(e=>e===document.activeElement));
  await live.locator('[data-path="mission.title"]').fill('실제 기록 보존 검증용 가상 상황');
  await live.locator('[data-path="mission.location"]').fill('가상 훈련 구역');
  await live.locator('[data-path="mission.lat"]').fill('35.8');await live.locator('[data-path="mission.lon"]').fill('127.1');await live.locator('[data-act="confirmcoords"]').click();
  check('준비 현황은 실제 입력값으로 갱신하고 비행 승인과 구분',await live.locator('.guide-progress').innerText().then(t=>t.includes('1 / 4')&&t.includes('별개')));
  await live.locator('#onboardingGuide [data-sec="sec-data"]').click();
  const beforeBackup=await live.evaluate(()=>exportPayload(true));
  const automaticDownload=live.waitForEvent('download');
  await live.evaluate(()=>{autoSaveHandle=null;autoSaveAt=0;lastAutoSavedRev=-1;autoSaveTick();});
  const automaticFile=await automaticDownload;await automaticFile.saveAs(path.join(out,'automatic-backup.json'));
  const automaticPayload=JSON.parse(await readFile(path.join(out,'automatic-backup.json'),'utf8'));
  check('실제 자동 다운로드 파일에 입력 상황을 포함하고 업무 상태 보존',automaticFile.suggestedFilename().startsWith('stayup-자동보관-')&&automaticPayload.mission.title==='실제 기록 보존 검증용 가상 상황'&&await live.evaluate(()=>exportPayload(true))===beforeBackup);
  check('자동 다운로드 후 상단·설정 상태가 일치하고 실제 파일 확인 안내',await live.locator('#autoSavePill').innerText().then(async t=>t.includes('다운로드 요청')&&t.includes('파일 확인')&&t===await live.locator('[data-auto-save-status]').innerText()));
  await live.screenshot({path:path.join(out,'backup-status.png'),fullPage:false});
  await live.evaluate(()=>{autoSaveAt=0;lastAutoSavedRev=-1;autoSaveHandle={createWritable:async()=>({write:async t=>{window.backupGuidePayload=t;},close:async()=>{}})};autoSaveTick();});
  await live.waitForFunction(()=>!autoSaveBusy&&autoSaveAt>0);
  check('지정 파일 쓰기는 다운로드 요청과 구분하며 내용·리비전 보존',await live.locator('#autoSavePill').innerText().then(async t=>t.startsWith('파일 저장')&&!t.includes('다운로드')&&t===await live.locator('[data-auto-save-status]').innerText())&&await live.evaluate(v=>backupGuidePayload===v&&exportPayload(true)===v,beforeBackup));
  await live.evaluate(()=>{autoSaveHandle=null;refreshAutoSavePill();});
  await live.locator('[data-onboard-action="close"]').click();
  check('안내를 접어도 기존 메뉴를 즉시 사용 가능',!(await live.locator('#onboardingGuide').isVisible())&&await live.locator('#tab-grid').isVisible());
  const palette=await live.evaluate(()=>{
    const box=document.querySelector('#sec-mission'),label=box.querySelector('label.f>span'),input=box.querySelector('input');
    const lum=c=>{const a=c.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722;};
    const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    const cs=getComputedStyle(input);return {text:ratio(cs.color,cs.backgroundColor),label:ratio(getComputedStyle(label).color,getComputedStyle(box).backgroundColor),font:parseFloat(cs.fontSize),scheme:cs.colorScheme};
  });
  check('주간 입력 글자·라벨 대비 4.5:1 이상 및 16px 크기',palette.text>=4.5&&palette.label>=4.5&&palette.font>=16&&palette.scheme==='light',palette);
  await live.screenshot({path:path.join(out,'mission-light.png'),fullPage:false});
  await live.locator('#tab-subject').click();
  const subjectName=live.locator('[data-path="subject.name"]'),speed=live.locator('[data-path="subject.walkSpeed"]');
  check('실종자 입력은 식별 별칭과 예시를 명시',await subjectName.getAttribute('placeholder')==='예: 대상 A'&&await subjectName.evaluate(e=>e.closest('label').textContent.includes('별칭')));
  check('이동 추정 설정은 기본 접힘이며 감지기 정보는 바로 확인 가능',!await speed.isVisible()&&await live.locator('[data-path="subject.tracker"]').isVisible());
  const subjectBefore=await live.evaluate(()=>exportPayload(true));
  await live.locator('details[data-fold="subject-estimate"]>summary').click();
  check('상세를 열어도 기존 기본값과 업무 상태를 바꾸지 않음',await speed.inputValue()==='2'&&await live.locator('[data-path="subject.decay"]').inputValue()==='0.35'&&await live.evaluate(()=>exportPayload(true))===subjectBefore);
  await subjectName.fill('대상 A');await speed.fill('3.3');await live.locator('[data-path="subject.decay"]').fill('0.45');await live.locator('[data-path="subject.tracker"]').check();
  await live.locator('#tab-crew').click();await live.locator('#tab-subject').click();
  check('메뉴를 다녀와도 펼침 상태와 직접 입력한 추정 값을 유지',await speed.isVisible()&&await speed.inputValue()==='3.3'&&await live.locator('[data-path="subject.decay"]').inputValue()==='0.45');
  await live.reload();await live.waitForFunction(()=>ownsEditorLock());await live.locator('#tab-subject').click();
  check('다시 열어도 별칭·감지기·사용자 지정 값 보존',await subjectName.inputValue()==='대상 A'&&await live.locator('[data-path="subject.tracker"]').isChecked()&&await speed.inputValue()==='3.3'&&await live.locator('[data-path="subject.decay"]').inputValue()==='0.45');
  await live.screenshot({path:path.join(out,'subject-basic.png'),fullPage:false});
  for(const [w,h] of [[390,844],[320,800]]){
    await live.setViewportSize({width:w,height:h});
    check(`${w}px 실종자 기본 입력·감지기·상세 접기 가로 넘침 없음`,await live.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)&&await subjectName.isVisible()&&await live.locator('[data-path="subject.tracker"]').isVisible()&&!await speed.isVisible());
    await live.screenshot({path:path.join(out,`subject-basic-${w}.png`),fullPage:false});
  }
  await live.setViewportSize({width:1366,height:900});
  await live.locator('#tab-crew').click();await live.locator('#btnAddCrew').click();
  check('인원 추가 뒤 새 성명 입력에 실제 포커스 연결',await live.locator('[data-path="crew.0.name"]').evaluate(e=>e===document.activeElement));
  await live.locator('#tab-drone').click();await live.locator('#btnAddDrone').click();
  check('기체 추가 뒤 조종자 입력이 고정 영역 아래에 보이며 포커스 연결',await live.locator('[data-path="drones.0.pilot"]').evaluate(e=>e===document.activeElement&&e.getBoundingClientRect().top>=document.querySelector('.console-workspace-bar').getBoundingClientRect().bottom));
  check('빈 인원·기체 행만 추가한 것은 등록 완료로 표시하지 않음',await live.evaluate(()=>!preparationSteps()[1].done));
  await live.locator('#tab-crew').click();await live.locator('[data-path="crew.0.name"]').fill('조종 A');
  await live.locator('#tab-drone').click();
  check('등록한 조종자 별칭을 선택 목록과 연결하고 수동 입력도 유지',await live.locator('[data-path="drones.0.pilot"]').evaluate(e=>{const list=document.querySelector('[data-pilot-target="'+e.dataset.path+'"]');return e.tagName==='INPUT'&&list&&[...list.options].some(o=>o.value==='조종 A')&&e.value==='';}));
  await live.locator('[data-pilot-target="drones.0.pilot"]').selectOption('조종 A');
  await live.screenshot({path:path.join(out,'pilot-suggestions.png'),fullPage:false});
  check('조종자 별칭을 연결한 기체는 기본 등록 확인에 반영',await live.evaluate(()=>preparationSteps()[1].done));
  await addMap(live);
  const operational=await live.evaluate(()=>({state:exportPayload(true),map:MAPDATA,epoch:localStorage.getItem(EPOCHKEY)}));
  await offlineMarker(live,'stayup-offline-regions-v1',true);
  await live.locator('[data-onboard-action="toggle"]').click();
  live.removeAllListeners('dialog');live.on('dialog',d=>d.dismiss());
  await live.locator('[data-onboard-action="new"]').click();
  check('기존 기록이 있는 새 상황 시작을 취소하면 내용과 원본 지도 보존',await live.evaluate(v=>exportPayload(true)===v.state&&MAPDATA===v.map,operational));
  live.removeAllListeners('dialog');live.on('dialog',d=>d.type()==='prompt'?d.accept('완전삭제'):d.accept());
  const chooserEvent=live.waitForEvent('filechooser');await live.locator('[data-onboard-action="import"]').click();const chooser=await chooserEvent;await chooser.setFiles([]);
  check('시작 화면 불러오기는 파일 선택으로 연결되며 취소 시 기존 내용 보존',await live.locator('#sec-data').isVisible()&&await live.evaluate(v=>exportPayload(true)===v,operational.state));
  const popup=context.waitForEvent('page');await live.locator('a[href*="practice=1"]').click();const practice=await popup;observe(practice);
  await practice.waitForFunction(()=>typeof S==='object'&&S.drones.length===3&&ownsEditorLock());
  check('연습은 별도 창·가상 데이터·명확한 연습 표시 제공',practice.url().includes('practice=1')&&await practice.locator('.practice-badge').isVisible()&&await practice.title().then(t=>t.startsWith('[연습]')));
  check('연습 안내에 실제 자동 보관 주기나 설정 이동을 섞지 않음',await practice.locator('#onboardingGuide [data-sec="sec-data"]').count()===0&&!await practice.locator('#onboardingGuide').innerText().then(t=>t.includes('30초')));
  const storage=await practice.evaluate(()=>({stateStorage:KEY,recoveryStorage:SNAPKEY,editorStorage:LOCKKEY,photoStorage:IDB_NAME,onlineStorage:ONLINE_KEYS_KEY}));
  check('연습 상태·복구·편집권·이미지·지도키 저장소 분리',
    storage.stateStorage==='stayup.practice.v1'&&storage.recoveryStorage.startsWith('stayup.practice.')
    &&storage.editorStorage.startsWith('stayup.practice.')&&storage.photoStorage==='stayup.practice'
    &&storage.onlineStorage.startsWith('stayup.practice.'));
  await offlineMarker(practice,'stayup-practice-offline-regions-v1',true);
  const requests=[];practice.on('request',r=>{if(!r.url().startsWith(new URL(url).origin))requests.push(r.url());});
  await practice.evaluate(()=>{S.mission.title='연습에서만 수정';commit();fetchWeather(false);});
  await live.waitForTimeout(700);
  check('연습 수정·폴링은 실제 기록·지도·세대 보존',await live.evaluate(v=>exportPayload(true)===v.state&&MAPDATA===v.map&&localStorage.getItem(EPOCHKEY)===v.epoch,operational));
  check('연습 자동 기상 조회는 외부 전송 없음',requests.length===0,requests);
  check('연습은 실제 폴더·자동 보관 파일 권한을 요청하지 않음',await practice.evaluate(async()=>{let pick=0,save=0;window.showDirectoryPicker=()=>{pick++;throw Error('호출 금지');};window.showSaveFilePicker=()=>{save++;throw Error('호출 금지');};await aiFolderConnect();pickAutoSaveFile();return !pick&&!save&&autoSaveLabel().includes('안 함');}));
  const displayPopup=context.waitForEvent('page');await live.locator('#btnOpenDisplay').click();const display=await displayPopup;observe(display);
  await display.waitForFunction(()=>S.mission.title==='실제 기록 보존 검증용 가상 상황');
  check('실제 조작·표출 연결에 연습 제목이 섞이지 않음',await display.locator('#hMission').innerText()==='실제 기록 보존 검증용 가상 상황');
  await display.locator('#displayThemeToggle').click();
  check('표출 야간 테마는 조작 주간 테마와 독립적으로 적용',await display.locator('#board').getAttribute('data-theme')==='dark'&&await live.locator('.cons').getAttribute('data-theme')==='light');
  await display.reload();await display.waitForFunction(()=>S.mission.title==='실제 기록 보존 검증용 가상 상황');
  check('테마는 다시 열어도 유지되며 업무 상태를 변경하지 않음',await display.locator('#board').getAttribute('data-theme')==='dark'&&await live.evaluate(v=>exportPayload(true)===v,operational.state));
  check('연습 메시지를 실제 표출 연결로 받아들이지 않음',await live.evaluate(()=>{const f=document.createElement('iframe');document.body.appendChild(f);const before=peer;window.dispatchEvent(new MessageEvent('message',{data:{ch:'stayup',type:'hello',practice:true},origin:location.origin,source:f.contentWindow}));const same=peer===before;f.remove();return same;}));
  await practice.locator('[data-onboard-action="close"]').click();await practice.locator('#tab-grid').click();await addMap(practice);
  await practice.evaluate(()=>purgeIncidentData());await practice.waitForFunction(()=>!S.mission.title&&!S.grid.hasMap);
  check('연습 완전삭제 후에도 실제 기록·사진·세대 보존',await live.evaluate(v=>exportPayload(true)===v.state&&MAPDATA===v.map&&localStorage.getItem(EPOCHKEY)===v.epoch,operational));
  check('연습 삭제가 실제 사진의 IndexedDB 원본을 지우지 않음',await live.evaluate(async v=>await mapBlobGet(S.grid.mapId)===v,operational.map));
  check('연습 지역 지도 삭제가 실제 타일 저장소에 영향을 주지 않음',await offlineMarker(live,'stayup-offline-regions-v1',false));
  await practice.evaluate(()=>loadSample());await practice.waitForFunction(()=>S.drones.length===3);await addMap(practice);const practiceState=await practice.evaluate(()=>exportPayload(true));
  const practiceMap=await practice.evaluate(()=>MAPDATA);
  await offlineMarker(practice,'stayup-practice-offline-regions-v1',true);
  await live.evaluate(()=>purgeIncidentData());await live.waitForFunction(()=>!S.mission.title&&!S.grid.hasMap);
  check('실제 완전삭제도 연습 기록을 삭제하지 않음',await practice.evaluate(v=>exportPayload(true)===v,practiceState));
  check('실제 삭제가 연습 사진의 IndexedDB 원본을 지우지 않음',await practice.evaluate(async v=>await mapBlobGet(S.grid.mapId)===v,practiceMap));
  check('실제 지역 지도 삭제가 연습 타일 저장소에 영향을 주지 않음',await offlineMarker(practice,'stayup-practice-offline-regions-v1',false));
  await live.evaluate(()=>loadSample());await live.waitForFunction(()=>S.drones.length===3);
  const oldTitle=await live.evaluate(()=>S.mission.title);
  if(!await live.locator('#onboardingGuide').isVisible())await live.locator('[data-onboard-action="toggle"]').click();
  const backupEvent=live.waitForEvent('download');await live.locator('[data-onboard-action="new"]').click();const backup=await backupEvent;
  await backup.saveAs(path.join(out,'new-incident-backup.json'));
  await live.waitForFunction(()=>!S.mission.title&&S.drones.length===0&&consoleActiveSection==='sec-mission');
  const backed=JSON.parse(await readFile(path.join(out,'new-incident-backup.json'),'utf8'));
  check('기존 상황에서 새로 시작하기 전 실제 JSON 백업을 다운로드',backed.mission.title===oldTitle&&backed.drones.length===3&&!backup.suggestedFilename().startsWith('연습-'));
  check('새 상황으로 전환한 뒤 이전 상황 복구점을 유지',await live.evaluate(title=>recoveryCandidates().some(c=>c.record.state.mission.title===title),oldTitle));
  await practice.locator('[data-theme-target="console"][data-theme-value="dark"]').click();await practice.screenshot({path:path.join(out,'practice-dark.png'),fullPage:false});
  for(const [w,h] of [[1366,768],[390,844],[320,800]]){await practice.setViewportSize({width:w,height:h});await practice.locator('#tab-mission').click();check(`${w}px 화면 가로 넘침 없음`,await practice.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  await practice.locator('[data-theme-target="console"][data-theme-value="light"]').click();await practice.screenshot({path:path.join(out,'practice-mobile-light.png'),fullPage:false});
  check('페이지 실행 오류 없음',errors.length===0,errors);
}finally{await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,results},null,2));await browser.close();await new Promise(r=>server.close(r));}
assert.equal(results.filter(r=>!r.pass).length,0,'Usability validation failed');
