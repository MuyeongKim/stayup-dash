/* Event history: paging focus, correction/cancel audit and read-only navigation.
 * Synthetic records, isolated Chrome storage, no live incident access.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-event-history';await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=(process.argv.includes('--file')?pathToFileURL(path.join(root,'stayup-dash.html')).href:'http://127.0.0.1:'+server.address().port+'/stayup-dash.html')+'?practice=1';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1366,height:900},deviceScaleFactor:3,serviceWorkers:'block',reducedMotion:'reduce'});
const results=[],errors=[];
const check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name);};
const operations=page=>page.evaluate(()=>JSON.stringify({mission:S.mission,subject:S.subject,drones:S.drones,crew:S.crew,grid:S.grid,safety:S.safety,weather:S.weather,ui:S.ui,ai:S.ai}));
async function resultFocus(page){return page.locator('[data-event-results]').evaluate(e=>{const r=e.getBoundingClientRect(),bar=document.querySelector('.console-workspace-bar'),fixed=document.querySelector('.mobile-verdict'),nav=document.querySelector('.ct-nav'),bottom=document.querySelector('.mobile-nav');const top=getComputedStyle(bar).position==='sticky'?bar.getBoundingClientRect().bottom:Math.max(getComputedStyle(fixed).position==='fixed'?fixed.getBoundingClientRect().bottom:0,getComputedStyle(nav).position==='sticky'?nav.getBoundingClientRect().bottom:0);return {focused:e===document.activeElement,top:r.top,bottom:r.bottom,limitTop:top,limitBottom:bottom&&getComputedStyle(bottom).position==='fixed'?bottom.getBoundingClientRect().top:innerHeight};});}
const fits=p=>p.focused&&p.top>=p.limitTop&&p.bottom<=p.limitBottom;
try{
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(url);await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  // Stage older artificial records; the workflow below uses normal controls.
  await page.evaluate(()=>{for(let i=0;i<25;i++)addEvent('note','가상 기록 '+(i+1),'A1',true);commit();});
  await page.reload();await page.waitForFunction(()=>ownsEditorLock());
  if(await page.locator('#onboardingGuide').isVisible())await page.locator('[data-onboard-action="close"]').click();
  const operationsBefore=await operations(page),initialEvents=await page.evaluate(()=>S.events.length);
  await page.locator('#evType').selectOption('note');await page.locator('#evZone').fill('A1');await page.locator('#evText').fill('가상 기록 무전 추가');await page.locator('#evText').press('Enter');
  check('빠른기록은 실제 입력 후 이력 한 건만 추가하고 현재 운용 상태 유지',await page.evaluate(()=>S.events.length)===initialEvents+1&&await page.locator('#evText').inputValue()===''&&await operations(page)===operationsBefore);
  await page.locator('#eventHistory>summary').click();await page.locator('#eventSearch').fill('가상 기록');
  check('검색 입력 중 초점·커서를 결과로 빼앗지 않음',await page.locator('#eventSearch').evaluate(e=>e===document.activeElement&&e.selectionStart===e.value.length));
  const beforePaging=await page.evaluate(()=>exportPayload(true));
  await page.locator('#eventHistory [data-act="eventpage"]').last().press('Enter');
  let position=await resultFocus(page);
  check('다음 쪽은 결과 요약에 초점을 두고 고정 영역 사이에 표시',fits(position)&&await page.locator('[data-event-results]').innerText().then(t=>t.includes('2 / 2쪽')),position);
  check('쪽 이동으로 기록·리비전·필터가 변하지 않음',await page.evaluate(()=>exportPayload(true))===beforePaging&&await page.locator('#eventSearch').inputValue()==='가상 기록');
  const target=await page.locator('#eventHistoryRows [data-act="correctevent"]').first().getAttribute('data-eid');
  await page.keyboard.press('Tab');
  check('요약에서 Tab을 누르면 새 쪽 첫 기록의 정정으로 연결',await page.evaluate(id=>document.activeElement.dataset.act==='correctevent'&&document.activeElement.dataset.eid===id,target));
  function dialogs(answers){const seen=[];page.removeAllListeners('dialog');page.on('dialog',async d=>{seen.push({type:d.type(),message:d.message()});const a=answers.shift();if(a===null)await d.dismiss();else await d.accept(a);});return seen;}
  let seen=dialogs([null]);await page.locator('#eventHistoryRows [data-act="correctevent"]').first().click();
  check('정정 사유창 취소는 추가 오류 안내와 기록 변경 없이 종료',seen.length===1&&seen[0].type==='prompt'&&await page.evaluate(()=>exportPayload(true))===beforePaging,seen);
  seen=dialogs([' ']);await page.locator('#eventHistoryRows [data-act="correctevent"]').first().click();
  check('공백 사유를 제출하면 감사 사유를 요구하고 기존 기록 보존',seen.some(d=>d.type==='alert')&&await page.evaluate(()=>exportPayload(true))===beforePaging,seen);
  seen=dialogs(['가상 오기 정정',null]);await page.locator('#eventHistoryRows [data-act="correctevent"]').first().click();
  check('올바른 내용 입력창에서 취소해도 원본·이력 보존',seen.length===2&&seen.every(d=>d.type==='prompt')&&await page.evaluate(()=>exportPayload(true))===beforePaging,seen);
  const old=await page.evaluate(id=>S.events.find(e=>e.id===id),target),beforeCount=await page.evaluate(()=>S.events.length);
  dialogs(['가상 오기 정정','가상 기록 정정본']);await page.locator('#eventHistoryRows [data-act="correctevent"]').first().click();
  const corrected=await page.evaluate(id=>({old:S.events.find(e=>e.id===id),replacement:S.events.find(e=>e.text==='가상 기록 정정본'),count:S.events.length}),target);
  check('정정은 원본과 사유를 남기고 발생시각·구역을 유지한 정정본·이력 생성',corrected.old.voided&&corrected.old.text===old.text&&corrected.old.voidReason==='가상 오기 정정'&&corrected.replacement.id!==old.id&&corrected.replacement.t===old.t&&corrected.replacement.zone===old.zone&&corrected.count===beforeCount+2);
  check('정정 후에는 가려진 패널 제목 대신 검색 결과를 확인',fits(await resultFocus(page))&&await page.locator('#eventSearch').inputValue()==='가상 기록');
  await page.locator('#eventSearch').fill('가상 기록 정정본');
  const beforeVoid=await page.evaluate(()=>S.events.length);dialogs(['가상 중복 기록 취소']);await page.locator('#eventHistoryRows [data-act="voidevent"]').click();
  check('기록 취소도 원문·사유·감사 이력을 남기고 결과에 초점 유지',await page.evaluate(({id,n})=>{const e=S.events.find(e=>e.id===id);return e.voided&&e.text==='가상 기록 정정본'&&e.voidReason==='가상 중복 기록 취소'&&S.events.length===n+1;},{id:corrected.replacement.id,n:beforeVoid})&&fits(await resultFocus(page)));
  check('정정·취소는 기체·인원·수색구역·안전·AI 현재 상태를 변경하지 않음',await operations(page)===operationsBefore);
  const audited=await page.evaluate(()=>exportPayload(true));
  await page.locator('#eventStatusFilter').focus();await page.locator('#eventStatusFilter').selectOption('active');
  const empty={text:await page.locator('#eventHistoryRows').innerText(),filter:await page.locator('#eventStatusFilter').inputValue(),focus:await page.locator('#eventStatusFilter').evaluate(e=>e===document.activeElement),preserved:await page.evaluate(()=>exportPayload(true))===audited};
  check('유효 기록 필터의 빈 결과는 명시하고 입력 초점·데이터 유지',empty.text.includes('조건에 맞는 기록이 없습니다')&&empty.filter==='active'&&empty.focus&&empty.preserved,empty);
  await page.locator('#eventStatusFilter').selectOption('all');await page.locator('#eventSearch').fill('가상 기록');
  for(const [w,h,theme] of [[390,844,'light'],[320,800,'dark']]){
    await page.setViewportSize({width:w,height:h});await page.locator('[data-theme-target="console"][data-theme-value="'+theme+'"]').click();
    await page.locator('#eventHistory [data-act="eventpage"]').last().press('Enter');position=await resultFocus(page);
    check(w+'px·'+theme+'에서 결과 초점·쪽 번호·첫 기록 접근과 가로 폭 유지',fits(position)&&await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)&&await page.evaluate(()=>exportPayload(true))===audited,position);
    await page.screenshot({path:path.join(out,'history-'+w+'.png'),scale:'css'});
    if(w===390){const head=await page.locator('[data-event-results]').boundingBox(),row=await page.locator('#eventHistoryRows .recent-event').first().boundingBox();await page.screenshot({path:path.join(out,'history-results-preview.png'),clip:{x:head.x-4,y:head.y-4,width:head.width+8,height:row.y+row.height-head.y+8},scale:'device'});}
    await page.locator('#eventHistory [data-act="eventpage"]').first().press('Enter');
    check(w+'px 이전 쪽으로 돌아와도 결과 초점·데이터 유지',fits(await resultFocus(page))&&await page.evaluate(()=>exportPayload(true))===audited);
  }
  const viewer=await context.newPage();viewer.on('pageerror',e=>errors.push(e.message));await viewer.goto(url);await viewer.waitForFunction(()=>typeof S==='object'&&!ownsEditorLock());
  if(await viewer.locator('#onboardingGuide').isVisible())await viewer.locator('[data-onboard-action="close"]').click();await viewer.locator('#eventHistory>summary').click();
  await viewer.locator('#eventHistory [data-act="eventpage"]').last().press('Enter');
  check('읽기 전용도 쪽 이동·결과 초점은 허용하고 정정·취소 잠금 유지',fits(await resultFocus(viewer))&&!await viewer.locator('#eventHistoryRows [data-act="correctevent"]').first().isEnabled()&&await page.evaluate(()=>ownsEditorLock())&&await page.evaluate(()=>exportPayload(true))===audited);
  check('페이지 실행 오류 없음',errors.length===0,errors);
}finally{await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,results},null,2));await browser.close();await new Promise(r=>server.close(r));}
assert.equal(results.filter(r=>!r.pass).length,0,'Event-history validation failed');
