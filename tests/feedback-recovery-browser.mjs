/* Feedback and recovery journeys use synthetic incidents and disposable Chrome.
 * The SDK request is deliberately held/failed; no real NAVER key is used. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const opt=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=opt('--modules'),out=opt('--out')||'/tmp/stayup-ux-five-fixes-20261105/feedback';await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{try{const f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!f.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(f));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port+'/stayup-dash.html',browser=await chromium.launch({channel:'chrome',headless:true});
const results=[],errors=[];let fatal;
const check=(name,pass,details)=>{results.push({name,pass:!!pass,details});console.log((pass?'PASS ':'FAIL ')+name);};
const payload=p=>p.evaluate(()=>JSON.parse(exportPayload(true)));
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const dialog=p=>p.locator('dialog[data-map-position][open]');
const activate=(p,control)=>p.viewportSize().width<600?control.tap():control.click();
async function shown(p,selector){return p.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect(),d=e.closest('dialog'),b=d?d.getBoundingClientRect():{top:0,bottom:innerHeight};return r.height>0&&r.top>=Math.max(0,b.top)+1&&r.bottom<=Math.min(innerHeight,b.bottom)-1&&r.left>=0&&r.right<=innerWidth;});}
async function context(width,file=false){
  const c=await browser.newContext({viewport:{width,height:width===1366?900:844},isMobile:width<600,hasTouch:width<600,serviceWorkers:'block',reducedMotion:'reduce'});
  let release;const gate=new Promise(r=>release=r);
  await c.route('**/*',async r=>{const u=new URL(r.request().url());if(u.hostname==='127.0.0.1'||u.protocol==='file:')return r.continue();await gate;return r.abort();});
  const p=await c.newPage();p.setDefaultTimeout(6000);p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
  await p.goto(file?pathToFileURL(path.join(root,'stayup-dash.html')).href:url);await p.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  await p.locator('[data-onboard-action="new"]').click();
  await p.evaluate(()=>{S.mission.title='가상 피드백 검증';S.weather.auto=false;S.ui.autoSave=false;commitLight();});
  await p.locator('#tab-grid').click();return {c,p,release};
}
async function openNaver(p){
  const opener=p.locator('[data-position-action="open"]');
  if(!await opener.isVisible()){
    const online=p.locator('[data-stage-action="online"]');
    if(!await online.isVisible()){
      const change=p.locator('[data-stage-action="change"]');
      if(await change.isVisible())await change.click();
      else await p.locator('[data-map-source-choices]>summary').click();
    }
    await online.click();
  }
  if(!await dialog(p).count())await opener.click();
  await dialog(p).waitFor();
}
async function photo(p){
  const data=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=750;const x=c.getContext('2d');x.fillStyle='#d9e6dd';x.fillRect(0,0,1200,750);x.fillStyle='#244a37';x.font='32px sans-serif';x.fillText('가상 지도 · 실제 지형 아님',40,70);return c.toDataURL('image/png').split(',')[1];});
  await p.locator('#mapFileInput').setInputFiles({name:'synthetic-feedback-map.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
  await p.waitForFunction(()=>S.grid.hasMap&&mapPayloadReady());
}
try{
 for(const width of [1366,390,320]){
  const {c,p,release}=await context(width);try{
   const before=await payload(p);
   const pump=p.locator('[data-equipment-kind="pump"]');
   if(await pump.isVisible()){
    await(width<600?pump.tap():pump.click());await settle(p);
    check(width+'px 지도 미준비 안내가 현재 화면에 보임',await shown(p,'[data-map-feedback]')&&await p.locator('[data-map-feedback]').innerText().then(t=>t.includes('먼저 준비')));
   }else check(width+'px 지도 준비 전 장비 배치를 숨기고 준비 선택을 먼저 제공',await p.locator('[data-map-source-choices] [data-act="mapfile"]').isVisible()&&await p.locator('[data-stage-action="online"]').isVisible());
   check(width+'px 준비 전 조작으로 상황·표식·기록 불변',isDeepStrictEqual(await payload(p),before));
   await openNaver(p);await activate(p,p.locator('#mapPositionConnect'));await settle(p);
   check(width+'px 키 공란은 다른 메뉴 대신 현재 창 입력란을 안내하며 자료 유지',await p.locator('[data-field-feedback]').innerText().then(t=>t.includes('이 창의')&&t.includes('NAVER Client ID')&&!t.includes('지도·격자 설정'))&&await shown(p,'[data-field-feedback]')&&await shown(p,'#mapPositionConnect')&&await shown(p,'#mapPositionKey')&&isDeepStrictEqual(await payload(p),before));
   await p.locator('#mapPositionKey').fill('wrong key!?');await activate(p,p.locator('#mapPositionConnect'));await settle(p);
   const invalid=p.locator('[data-field-feedback]');
   check(width+'px 잘못된 키 오류와 키 입력·재시도 버튼이 함께 보임',await invalid.innerText().then(t=>t.includes('연결하지 못')&&t.includes('다시 누르'))&&await shown(p,'[data-field-feedback]')&&await shown(p,'#mapPositionConnect')&&await shown(p,'#mapPositionKey'));
   check(width+'px 오류를 보여도 키 입력·초점과 업무자료 유지',await p.locator('#mapPositionKey').inputValue()==='wrong key!?'&&await p.locator('#mapPositionConnect').evaluate(e=>document.activeElement===e)&&isDeepStrictEqual(await payload(p),before));
   await p.screenshot({path:path.join(out,'invalid-key-'+width+'.png'),scale:'css'});
   await p.locator('#mapPositionKey').fill('synthetic-feedback-key');await activate(p,p.locator('#mapPositionConnect'));await p.waitForFunction(()=>document.querySelector('[data-field-feedback]').dataset.kind==='loading');
   check(width+'px 연결 진행 상태가 연결 버튼 옆에 표시됨',await invalid.innerText().then(t=>t.includes('불러오는 중'))&&await shown(p,'[data-field-feedback]'));
   release();await p.waitForFunction(()=>document.querySelector('[data-field-feedback]').dataset.kind==='err');await settle(p);
   check(width+'px SDK 연결 실패 이유와 재시도 동작이 현재 화면에 보임',await shown(p,'[data-field-feedback]')&&await shown(p,'#mapPositionConnect')&&await invalid.innerText().then(t=>t.includes('연결하지 못'))&&await p.locator('#mapPositionApply').isDisabled());
   check(width+'px 연결 실패가 기존 자료나 승인 상태를 바꾸지 않음',isDeepStrictEqual(await payload(p),before));
   await p.screenshot({path:path.join(out,'connection-failed-'+width+'.png'),scale:'css'});
   await dialog(p).getByRole('button',{name:'취소',exact:true}).click();
   await photo(p);const withPhoto=await payload(p);
   await openNaver(p);await activate(p,p.locator('[data-position-recovery="calibrate"]'));await settle(p);
   check(width+'px 미보정 사진에서 닫고 실제 좌표 보정으로 이동',await dialog(p).count()===0&&await p.locator('#photoGeoSetup').isVisible()&&await p.locator('#photoGeoSetup').evaluate(e=>e===document.activeElement)&&await p.locator('details[data-fold="map-setup"]').evaluate(e=>e.open));
   check(width+'px 보정 바로가기는 사진·장비·상황·기록 불변',isDeepStrictEqual(await payload(p),withPhoto));
   await p.screenshot({path:path.join(out,'calibration-target-'+width+'.png'),scale:'css'});
   await p.locator('#tab-grid').click();const tools=p.locator('#fieldTools');if(!await tools.evaluate(e=>e.open))await tools.locator(':scope>summary').click();await p.locator('[data-field-action="rect"]').click();
   await p.locator('[data-equipment-kind="pump"]').click();await settle(p);
   check(width+'px 구역 초안 중 장비 배치 제한을 현재 화면에서 설명',await shown(p,'[data-map-feedback]')&&await p.locator('[data-map-feedback]').innerText().then(t=>t.includes('초안'))&&await p.evaluate(()=>!!fieldEdit&&fieldEdit.mode==='rect'));
   check(width+'px 오류 노출은 작성 중 구역 초안·기존 기록을 변경하지 않음',isDeepStrictEqual(await payload(p),withPhoto));
   await p.keyboard.press('Escape');
  }finally{release();await c.close();}
 }
 const {c,p,release}=await context(390,true);try{
  const before=await payload(p);await openNaver(p);
  check('파일 실행은 연결 불가와 현재 가능한 두 행동을 먼저 표시',await p.locator('[data-position-recovery="photo"]').isVisible()&&await p.locator('[data-position-recovery="web-help"]').isVisible()&&await p.locator('#mapPositionKey').isDisabled()&&!await p.locator('#mapPositionKey').isVisible()&&await p.locator('#mapPositionConnect').isDisabled());
  await activate(p,p.locator('[data-position-recovery="web-help"]'));
  check('웹 실행 방법은 실제 주소·폴더·저장공간 이동 안내와 문서 링크 제공',await p.locator('#mapPositionWebHelp').innerText().then(t=>t.includes('127.0.0.1:8899/stayup-dash.html')&&t.includes('폴더 전체')&&t.includes('상황 백업'))&&await p.locator('#mapPositionWebHelp a').getAttribute('href')==='docs/user-guide.html#chapter-2');
  check('웹 실행 안내는 서버 실행이나 업무 값 변경을 하지 않음',isDeepStrictEqual(await payload(p),before));
  await p.screenshot({path:path.join(out,'file-help-390.png'),scale:'css'});
  const choosing=p.waitForEvent('filechooser');choosing.catch(()=>{});await activate(p,p.locator('[data-position-recovery="photo"]'));const chooser=await choosing;
  check('사진 지도로 계속하기가 창을 닫고 실제 사진 선택으로 연결',await dialog(p).count()===0&&await chooser.element().getAttribute('id')==='mapFileInput');
  await chooser.setFiles([]);check('사진 선택 취소는 기존 입력을 보존',isDeepStrictEqual(await payload(p),before));
 }finally{release();await c.close();}
 check('실행 중 JavaScript 오류 없음',errors.length===0,errors);
}catch(error){fatal=error;check('사용자 동선 실행 완료',false,error.stack);}
finally{await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),results,errors},null,2));await browser.close();await new Promise(r=>server.close(r));}
if(fatal)throw fatal;assert.equal(results.filter(r=>!r.pass).length,0,'피드백·복귀 동선 검증 실패');
