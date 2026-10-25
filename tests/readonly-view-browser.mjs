/* Read-only viewing must not require or acquire the incident editor lease.
 * --probe captures the original controls without attempting disabled actions.
 * Runs against disposable Chrome storage and artificial incident data only.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-readonly-view';await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=process.argv.includes('--file')?pathToFileURL(path.join(root,'stayup-dash.html')).href:'http://127.0.0.1:'+server.address().port+'/stayup-dash.html';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1366,height:900},serviceWorkers:'block',reducedMotion:'reduce'});
const results=[],errors=[];
const check=(name,pass)=>{results.push({name,pass:!!pass});console.log((pass?'PASS ':'FAIL ')+name);};
try{
  const owner=await context.newPage();owner.on('pageerror',e=>errors.push(e.message));
  await owner.goto(url);await owner.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  await owner.evaluate(()=>{loadSample();S.mission.title='읽기 전용 검토용 가상 상황';S.weather.auto=false;S.ui.autoSave=false;commit();});
  const before=await owner.evaluate(()=>exportPayload(true));
  const viewer=await context.newPage();viewer.on('pageerror',e=>errors.push(e.message));
  await viewer.goto(url+'?viewer=1');await viewer.waitForFunction(()=>typeof S==='object'&&!ownsEditorLock()&&S.drones.length===3);
  const toggle=viewer.locator('[data-onboard-action="toggle"]');
  const theme=viewer.locator('[data-theme-target="console"][data-theme-value="dark"]');
  const flags={guide:await toggle.isEnabled(),theme:await theme.isEnabled()};
  await viewer.screenshot({path:path.join(out,process.argv.includes('--probe')?'before.png':'readonly-before-actions.png'),fullPage:false});
  if(process.argv.includes('--probe')){
    await writeFile(path.join(out,'probe.json'),JSON.stringify(flags));console.log(JSON.stringify(flags));
  }else{
    check('읽기 전용에서도 처음 사용 안내 버튼 활성화',flags.guide);
    check('읽기 전용에서도 보기 테마 버튼 활성화',flags.theme);
    if(flags.guide&&flags.theme){
      await toggle.click();check('편집권 없이 안내를 펼칠 수 있음',await viewer.locator('#onboardingGuide').isVisible());
      check('새 상황·파일 불러오기 동작은 잠금 유지',!await viewer.locator('[data-onboard-action="new"]').isEnabled()&&!await viewer.locator('[data-onboard-action="import"]').isEnabled());
      await viewer.locator('[data-onboard-action="close"]').click();check('안내 접기 허용',!await viewer.locator('#onboardingGuide').isVisible());
      await theme.click();check('테마가 실제 야간 화면으로 전환',await viewer.locator('.cons').getAttribute('data-theme')==='dark');
      await viewer.locator('[data-theme-target="console"][data-theme-value="light"]').click();
      await viewer.locator('#tab-mission').click();check('상황 입력은 비활성화 유지',!await viewer.locator('[data-path="mission.title"]').isEnabled());
      await viewer.locator('#tab-drone').click();await viewer.locator('#sec-drone details[data-fold]').first().locator('summary').click();
      check('인원·기체 추가와 명부 선택은 잠금 유지',!await viewer.locator('#btnAddDrone').isEnabled()&&!await viewer.locator('[data-pilot-target]').first().isEnabled());
      await viewer.locator('#tab-grid').click();
      await viewer.locator('details[data-fold="map-setup"]>summary').click();
      await viewer.waitForTimeout(2200);
      check('주기 갱신 후에도 지역 지도 저장·선택·파일 작업 잠금 유지',await viewer.locator('[data-offline-busy]').evaluateAll(els=>els.length>=7&&els.every(el=>el.disabled)));
      check('읽기 전용 창이 편집권을 가져오지 않음',await viewer.evaluate(()=>!ownsEditorLock())&&await owner.evaluate(()=>ownsEditorLock()));
      check('양쪽 상황·리비전·활동 기록이 보기 조작으로 바뀌지 않음',await viewer.evaluate(v=>exportPayload(true)===v,before)&&await owner.evaluate(v=>exportPayload(true)===v,before));
      await toggle.click();check('다시 안내를 열어도 편집 동작은 계속 비활성화',!await viewer.locator('[data-onboard-action="new"]').isEnabled()&&!await viewer.locator('[data-onboard-action="import"]').isEnabled());
      await owner.evaluate(()=>{S.mission.title='';commit();});await viewer.waitForFunction(()=>S.mission.title==='');
      check('원격 입력 갱신으로 안내를 다시 그려도 편집 잠금과 보기 허용 유지',!await viewer.locator('[data-onboard-action="new"]').isEnabled()&&!await viewer.locator('[data-onboard-action="import"]').isEnabled()&&await viewer.locator('[data-onboard-action="close"]').isEnabled()&&await theme.isEnabled());
      await viewer.screenshot({path:path.join(out,'readonly-guide.png'),fullPage:false});
      const lowBefore=await viewer.evaluate(()=>exportPayload(true));
      await viewer.setViewportSize({width:390,height:400});
      await viewer.locator('.compact-priority-link').click();
      check('짧은 읽기 전용 화면에서도 현재 지시 원문 접근 허용',await viewer.locator('#consolePriority').evaluate(e=>e===document.activeElement&&e.querySelector('[data-priority-text]').textContent.length>0));
      check('짧은 읽기 전용 보기 조작도 편집권·업무 상태 유지',await viewer.evaluate(v=>!ownsEditorLock()&&exportPayload(true)===v,lowBefore)&&await owner.evaluate(v=>ownsEditorLock()&&exportPayload(true)===v,lowBefore));
    }
    check('페이지 실행 오류 없음',errors.length===0);
  }
}finally{await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,results},null,2));await browser.close();await new Promise(r=>server.close(r));}
assert.equal(results.filter(r=>!r.pass).length,0,'Read-only viewing validation failed');
