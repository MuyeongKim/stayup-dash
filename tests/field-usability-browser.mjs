/* 현장 사용성 보완(2026-11-15): 기록과 상태 연동, 기록 종류 되돌림, 빠른 종류 단추, 어긋남 상자 대비,
 * 지도 없이 격자 칠하기, 큰 기체 단추, 지시·상황 전달 창, 휴대폰 작업 공간, 앱 안 정정 창.
 * 연습 자료와 일회용 브라우저 저장소만 사용한다.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-field-usability';await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port+'/stayup-dash.html';
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[],errors=[];
const check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name+(pass||detail===undefined?'':' '+JSON.stringify(detail)));};
async function open(url,opts={}){
  const context=await browser.newContext({viewport:{width:1366,height:900},serviceWorkers:'block',reducedMotion:'reduce',...opts});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(url);await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  const close=page.locator('[data-onboard-action="close"]');if(await close.isVisible())await close.click();
  return {context,page};
}
const contrast=(page,sel)=>page.evaluate(sel=>{const el=document.querySelector(sel);
  const lum=c=>{const m=c.match(/[\d.]+/g).map(Number);const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);};return .2126*f(m[0])+.7152*f(m[1])+.0722*f(m[2]);};
  let bg='rgb(255,255,255)';for(let e=el;e;e=e.parentElement){const b=getComputedStyle(e).backgroundColor;if(b&&!/rgba\(0, 0, 0, 0\)|transparent/.test(b)){bg=b;break;}}
  const a=lum(getComputedStyle(el).color),b=lum(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);},sel);
try{
  /* 1·2·6. 수색 기록 */
  {const {context,page}=await open(base+'?practice=1');
    await page.locator('#tab-quick').click();
    await page.locator('[data-quick-type="landing"]').click();
    const flying=await page.evaluate(()=>S.drones.filter(d=>d.status==='flying'||d.status==='commloss').map(d=>d.id));
    check('착륙 단추는 떠 있는 기체가 하나면 미리 골라 두고 내용 칸으로 이동',flying.length===1&&await page.locator('#evEntity').inputValue()===flying[0]&&await page.evaluate(()=>document.activeElement.id)==='evText');
    await page.locator('#evText').fill('가상 착륙 배터리 교체');await page.locator('#evText').press('Enter');
    const landed=await page.evaluate(id=>({d:S.drones.find(d=>d.id===id),e:S.events.at(-1),mm:!!document.querySelector('.mismatch')}),flying[0]);
    check('수색 기록의 지금 착륙은 기체 상태도 배터리교체로 바꾸고 어긋남을 만들지 않음',landed.d.status==='swap'&&!landed.d.tookOffAt&&landed.e.type==='landing'&&landed.e.entityId===flying[0]&&!landed.mm,landed);
    check('저장 뒤 기록 종류는 특이사항으로 돌아가고 바뀐 상태를 알림',await page.locator('#evType').inputValue()==='note'&&await page.locator('[data-quick-type="note"]').getAttribute('aria-pressed')==='true'&&(await page.locator('#quickContract').innerText()).includes('배터리교체'));
    await page.locator('#evText').fill('지상팀 식사 교대');await page.locator('#evText').press('Enter');
    check('열원감지 등 직전 종류가 다음 일반 메모에 남지 않음',await page.evaluate(()=>S.events.at(-1).type)==='note');
    const ground=await page.evaluate(()=>S.drones.find(d=>d.status==='ready').id);
    await page.locator('[data-quick-type="takeoff"]').click();await page.locator('#evEntity').selectOption(ground);
    await page.locator('#evTimeMode').selectOption('custom');await page.locator('#evTime').fill(await page.evaluate(()=>localDateTime(new Date(Date.now()-40*60000))));
    check('과거 시각을 고르면 상태를 바꾸지 않는다고 미리 안내',(await page.locator('#quickContract').innerText()).includes('상태는 바꾸지 않습니다'));
    await page.locator('#evText').fill('사후 이륙 이력');await page.locator('#btnAddEv').click();
    check('과거 시각 이륙 기록은 이력만 남기고 기체 상태는 그대로',await page.evaluate(id=>S.drones.find(d=>d.id===id).status,ground)==='ready'&&await page.evaluate(()=>S.events.at(-1).text)==='사후 이륙 이력');
    await page.evaluate(()=>{window.__clicks=0;document.addEventListener('pointerdown',e=>{if(e.isTrusted)__clicks++;},true);});
    await page.locator('[data-quick-type="heat"]').click();
    check('열원감지 단추는 구역 칸으로 바로 이동',await page.evaluate(()=>document.activeElement.id)==='evZone');
    await page.keyboard.type('C4');await page.locator('#evText').click();await page.keyboard.type('가상 열원 반응');await page.keyboard.press('Enter');
    check('열원감지 기록은 단추 두 번과 입력으로 끝남',await page.evaluate(()=>__clicks)===2&&await page.evaluate(()=>S.events.at(-1).type+S.events.at(-1).zone)==='heatC4');
    await page.locator('[data-quick-type="zone"]').click();await page.keyboard.type('C6');await page.locator('#evText').press('Enter');
    check('구역완료 기록은 지도 칸도 완료로 칠함',await page.evaluate(()=>S.grid.cells.C6&&S.grid.cells.C6.s===2&&S.events.at(-1).stateAction==='zoneState'));
    /* 3. 어긋남 상자 대비 */
    await page.evaluate(()=>{const d=S.drones.find(d=>d.status==='ready');d.status='flying';d.tookOffAt=localDateTime(new Date(Date.now()-60000));addEvent('landing',d.name+' 가상 착륙','',true,Date.now()-1000,{entityType:'drone',entityId:d.id});commit();});
    const light={text:await contrast(page,'.mismatch .mm-row>span'),head:await contrast(page,'.mismatch .mm-h'),note:await contrast(page,'.mismatch .note')};
    check('주간 화면 어긋남 상자 글자 대비 4.5 이상',Object.values(light).every(v=>v>=4.5),light);
    await page.locator('[data-theme-target="console"][data-theme-value="dark"]').click();
    const dark={text:await contrast(page,'.mismatch .mm-row>span'),head:await contrast(page,'.mismatch .mm-h')};
    check('야간 화면 어긋남 상자 글자 대비 4.5 이상',Object.values(dark).every(v=>v>=4.5),dark);
    await page.locator('[data-theme-target="console"][data-theme-value="light"]').click();
    /* 5. 큰 기체 단추 */
    await page.locator('#tab-drone').click();
    const sizes=await page.evaluate(()=>['takeoff','land','confirmbattery'].map(a=>Math.round(document.querySelector('#sec-drone [data-act="'+a+'"]').getBoundingClientRect().height)));
    check('이륙·착륙·배터리 확인 단추는 44px 이상',sizes.every(h=>h>=44),sizes);
    check('떠 있는 기체 카드는 착륙 단추를 강조',await page.evaluate(()=>{const i=S.drones.findIndex(d=>d.tookOffAt);return document.querySelector('#sec-drone [data-act="land"][data-di="'+i+'"]').classList.contains('primary');}));
    /* 7. 지시·상황 전달 */
    await page.evaluate(()=>scrollTo(0,0));await page.locator('[data-field-action="message"]').click();
    const dialog=page.locator('dialog.field-dialog[open]');await dialog.waitFor();
    const d7=await dialog.evaluate(d=>({theme:d.dataset.theme,bg:getComputedStyle(d).backgroundColor,kind:d.querySelector('[aria-checked="true"]').dataset.messageKind,close:!!d.querySelector('.field-dialog-safety [data-field-close]').offsetParent,current:d.querySelector('[data-message-current]').textContent}));
    check('지시 창은 입력 화면 테마를 따르고 우선 지시를 기본으로 염',d7.theme==='light'&&d7.bg==='rgb(255, 255, 255)'&&d7.kind==='order',d7);
    check('평소에는 저장처럼 보이는 닫기 단추를 숨기고 지금 표시 중인 문장을 보여 줌',!d7.close&&d7.current.length>0,d7);
    check('빈 입력으로는 올리기 단추를 누를 수 없음',await page.locator('#fieldMessagePublish').isDisabled()===(await page.evaluate(()=>!S.mission.priorityOrder)));
    await page.locator('#fieldMessageText').fill('가상 E열 우선 수색');
    check('올리기 단추가 무엇을 바꾸는지 이름에 적음',(await page.locator('#fieldMessagePublish').innerText())==='현재 우선 지시로 올리기');
    await page.locator('#fieldMessagePublish').click();
    check('올리면 우선 지시가 바뀜',await page.evaluate(()=>S.mission.priorityOrder)==='가상 E열 우선 수색');
    /* 9. 정정 창 */
    await page.locator('#tab-quick').click();
    const target=await page.locator('#sec-quick [data-act="correctevent"]').first().getAttribute('data-eid');
    let native=0;page.on('dialog',()=>native++);
    await page.locator('#sec-quick [data-act="correctevent"]').first().click();await dialog.waitFor();
    check('기록 정정은 브라우저 기본 창 없이 원문·사유·고친 내용을 한 창에 보여 줌',native===0&&await page.locator('#eventFixText').inputValue()===await page.evaluate(id=>S.events.find(e=>e.id===id).text,target)&&await page.locator('#eventFixReason').inputValue()==='오입력');
    await page.locator('[data-fix-reason="중복 기록"]').click();await page.locator('#eventFixText').fill('가상 정정 내용');await page.locator('#eventFixApply').click();await dialog.waitFor({state:'detached'});
    check('정정 저장은 원본 무효·정정본·감사 기록을 남김',await page.evaluate(id=>{const o=S.events.find(e=>e.id===id);return o.voided&&o.voidReason==='중복 기록'&&S.events.some(e=>e.text==='가상 정정 내용')&&S.events.at(-1).type==='correction';},target));
    await context.close();}
  /* 4. 지도 사진 없이 격자 */
  {const {context,page}=await open(base);
    const start=page.locator('[data-onboard-action="new"]');if(await start.isVisible())await start.click();
    const guide=page.locator('[data-onboard-action="close"]');if(await guide.isVisible())await guide.click();
    await page.locator('#tab-grid').click();
    check('지도 사진이 없을 때 격자로 시작 선택지가 보임',await page.locator('[data-stage-action="gridonly"]').isVisible()&&!await page.locator('[data-map-host="consMap"][data-map-action="paint"]').first().isVisible());
    const before=await page.evaluate(()=>exportPayload(true));
    await page.locator('[data-stage-action="gridonly"]').click();
    check('격자로 시작은 저장 자료를 바꾸지 않고 칠하기 단추를 보여 줌',await page.evaluate(b=>exportPayload(true)===b,before)&&await page.locator('[data-map-host="consMap"][data-map-action="paint"]').first().isVisible()&&(await page.locator('[data-map-stage-current]').innerText()).includes('격자만'));
    await page.locator('[data-map-host="consMap"][data-map-action="paint"]').first().click();
    const fold=page.locator('#sec-grid details:has([data-act="paints"]) > summary').first();
    if(await fold.count()&&await fold.isVisible()&&!await page.locator('#sec-grid [data-act="paints"][data-v="2"]').first().isVisible())await fold.click();
    await page.locator('#sec-grid [data-act="paints"][data-v="2"]').first().click();
    await page.locator('#consMap [data-cell="B2"]').click();
    check('지도 사진 없이 칸을 눌러 완료로 칠함',await page.evaluate(()=>S.grid.cells.B2&&S.grid.cells.B2.s===2));
    await page.reload();await page.waitForFunction(()=>typeof S==='object');await page.locator('#tab-grid').click();
    check('칠한 칸이 있으면 새로고침 뒤에도 바로 칠할 수 있음',await page.locator('[data-map-host="consMap"][data-map-action="paint"]').first().isVisible());
    await context.close();}
  /* 8. 휴대폰 */
  {const {context,page}=await open(base+'?practice=1',{viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await page.locator('.mobile-nav button',{hasText:'기록'}).first().tap();await page.evaluate(()=>scrollTo(0,500));
    const g=await page.evaluate(()=>({sticky:consoleStickyEl(document.getElementById('consoleRoot')).getBoundingClientRect().bottom,nav:document.querySelector('.mobile-nav').getBoundingClientRect().height,manned:(()=>{const r=document.getElementById('btnManned').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()}));
    check('세로 휴대폰에서 위아래 고정 영역을 뺀 작업 공간이 화면의 65% 이상',(844-g.sticky-g.nav)/844>=0.65,g);
    check('스크롤해도 유인기 경보 단추는 계속 보임',g.manned,g);
    await page.evaluate(()=>scrollTo(0,0));await page.locator('.mobile-nav button',{hasText:'기록'}).first().tap();
    const y=await page.evaluate(()=>{const r=document.getElementById('evText').getBoundingClientRect();return {top:r.top,bottom:r.bottom,nav:document.querySelector('.mobile-nav').getBoundingClientRect().top};});
    check('기록 탭을 열면 내용 칸이 스크롤 없이 화면 위쪽 60% 안에서 시작',y.top<=844*0.6&&y.bottom<=y.nav,y);
    check('휴대폰 가로 넘침 없음',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:path.join(out,'phone-quick.png')});
    await context.close();}
  check('페이지 실행 오류 없음',errors.length===0,errors);
}finally{await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,results},null,2));await browser.close();await new Promise(r=>server.close(r));}
assert.equal(results.filter(r=>!r.pass).length,0,'Field usability validation failed');
