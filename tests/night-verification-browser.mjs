/* 야간 반복 사용자 검증(2026-11-15~16)에서 보완한 동작: 이륙 구역 → 담당구역, 재고 미입력 문구, 조종자 교대 반영,
 * 유인기 경보 중 비행 기체 표시·모두 착륙 기록, 발견 구역 표시, 휴대폰 위험 줄, 한 장 요약 내용, 서랍 위 경보음 단추,
 * 창 초점, 잔량 칸 덮어쓰기, 같은 구역 여러 대, 원거리 글자, 실수 기록 되돌리기, 잔량 미입력·통신 두절, 추정 잔량·기체 한눈에,
 * 지금 확인 한 줄·열원감지 순서·새벽 비행, 이륙 전 경고, 발견 오입력 취소, 재이륙 기록 누락, 열원 확인 결과, 경보 단추 대비,
 * 자정 넘긴 브리핑·절전 뒤 편집권, 기록 한도, 교체 없이 대기 잔량 추정, 검토자 2차 지적. 연습 자료와 일회용 저장소만 사용한다.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-night-verification';await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port+'/stayup-dash.html?practice=1';
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[],errors=[];
const check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name+(pass||detail===undefined?'':' '+JSON.stringify(detail)));};
async function open(opts={}){
  const context=await browser.newContext({viewport:{width:1366,height:900},serviceWorkers:'block',reducedMotion:'reduce',...opts});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(base);await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  const close=page.locator('[data-onboard-action="close"]');if(await close.isVisible())await close.click();
  return {context,page};
}
async function wall(context,page,w=1920,h=1080){const p=context.waitForEvent('page');await page.locator('#btnOpenDisplay').click();const d=await p;d.on('pageerror',e=>errors.push('현황:'+e.message));await d.setViewportSize({width:w,height:h});await d.waitForFunction(()=>typeof S==='object'&&S.drones.length>0);await d.waitForTimeout(1300);return d;}
try{
  {const {context,page}=await open();
    /* 1. 이륙 구역 → 담당구역 */
    await page.locator('#tab-quick').click();const original=await page.evaluate(()=>JSON.stringify(S.drones[2]));await page.locator('[data-quick-type="takeoff"]').click();
    await page.locator('#evEntity').selectOption(await page.evaluate(()=>S.drones[2].id));await page.locator('#evZone').fill('A6');await page.locator('#evText').press('Enter');
    check('지금 이륙 기록의 구역이 기체 담당구역이 됨',await page.evaluate(()=>S.drones[2].status==='flying'&&S.drones[2].zone==='A6'));
    /* 11. 바로 되돌리기 */
    await page.locator('[data-quick-undo]').click();
    check('저장 직후 되돌리기는 상태를 기록 전으로 돌리고 기록은 취소 표시',await page.evaluate(o=>JSON.stringify(S.drones[2])===o&&S.events.find(e=>e.type==='takeoff'&&e.text.includes('3호기'))?.voided===true,original));
    /* 11. 나중에 취소하며 상태 되돌리기 */
    await page.locator('[data-quick-type="takeoff"]').click();await page.locator('#evEntity').selectOption(await page.evaluate(()=>S.drones[2].id));await page.locator('#evText').press('Enter');
    const eid=await page.evaluate(()=>S.events.at(-1).id);
    await page.locator(`#sec-quick [data-act="voidevent"][data-eid="${eid}"]`).first().click();await page.locator('#eventFixRevert').waitFor();
    check('기록 취소 창이 바뀐 상태 되돌리기를 기본으로 제안',await page.locator('#eventFixRevert').isChecked()&&(await page.locator('dialog.field-dialog[open] .chkline').innerText()).includes('3호기 비행중 → 이륙대기'));
    await page.locator('#eventFixApply').click();
    check('취소와 함께 상태도 되돌림',await page.evaluate(()=>S.drones[2].status==='ready'&&!S.drones[2].tookOffAt));
    /* 7. 잔량 칸 덮어쓰기 */
    const batt=page.locator('[data-drone-quick="quick"] .dq-row:not(.swap):not(.pilot):not(.manned) [data-dq-batt]').first();
    await batt.focus();await page.waitForTimeout(50);await page.keyboard.type('66');await page.keyboard.press('Enter');
    check('잔량 칸에 들어가 숫자를 치면 이전 값을 덮어씀',await page.evaluate(()=>S.drones[0].battery===66));
    /* 2. 조종자 교대 반영 */
    await page.locator('#tab-crew').click();
    const pilot=await page.evaluate(()=>S.drones[0].pilot);
    await page.evaluate(n=>{const i=S.crew.findIndex(c=>c.name===n);S.crew[i].outAt=localDateTime(new Date());S.crew.push({id:'night_new_pilot',name:'조종 새',role:'조종',inAt:localDateTime(new Date(Date.now()-60000)),outAt:''});commit();},pilot);
    check('조종자가 교대로 빠지면 인원 관리에 교대 반영 줄과 새 조종자 기본값',await page.locator('[data-drone-quick="crew"] .dq-row.pilot').isVisible()&&await page.locator('[data-drone-quick="crew"] [data-dq-pilot]').inputValue()==='조종 새');
    check('지금 확인에 조종자 확인 필요(주의 · 판정은 제한 비행)',await page.evaluate(()=>attentionItems().some(a=>a.lv==='warn'&&a.text.includes('조종자 확인 필요'))&&flightVerdict(new Date()).txt==='제한 비행'));
    await page.locator('[data-drone-quick="crew"] [data-dq-act="pilot"]').click();
    check('조종자 바꾸기로 판정이 다시 비행 가능 쪽으로 돌아오고 안내가 남음',await page.evaluate(()=>S.drones[0].pilot==='조종 새'&&!flightVerdict(new Date()).why.some(w=>w.includes('조종자'))&&S.events.at(-1).text.includes('조종자 변경'))&&(await page.locator('[data-drone-quick="crew"] .dq-msg').innerText()).includes('조종 새'));
    /* 1. 재고 미입력 문구 */
    await page.evaluate(()=>{S.batteries.ready=0;S.batteries.charging=0;S.batteries.empty=0;commit();});
    check('예비 배터리를 하나도 넣지 않았으면 재고 미입력(주의)',await page.evaluate(()=>attentionItems().some(a=>a.lv==='warn'&&a.text==='예비 배터리 재고 미입력')));
    await page.evaluate(()=>{S.batteries.ready=5;commit();});
    /* 3. 유인기 경보 */
    const display=await wall(context,page);
    await page.evaluate(()=>{const d=S.drones[2];d.status='flying';d.tookOffAt=localDateTime(new Date(Date.now()-60000));d.pilot='조종 새';commit();setMannedAlert(true);});
    await display.waitForTimeout(1200);
    check('유인기 경보 배너에 아직 비행 중인 기체를 적음',(await display.locator('#alertBanner').innerText()).includes('비행 중 2대'));
    await page.locator('#tab-quick').click();
    await page.locator('[data-drone-quick="quick"] [data-dq-act="landall"]').click();await display.waitForTimeout(1200);
    check('유인기 경보 중(바탕 빨강 줄무늬) 지금 확인 제목 글자를 밝게',await display.evaluate(()=>getComputedStyle(document.querySelector('.wall-attn .wa-h')).color==='rgb(243, 244, 246)'));
    check('모두 착륙 기록 뒤 배너가 전 기체 착륙 확인으로 바뀜',(await display.locator('#alertBanner').innerText()).includes('전 기체 착륙 확인')&&await page.evaluate(()=>!S.drones.some(d=>d.status==='flying')));
    await page.evaluate(()=>setMannedAlert(false));
    /* 3. 발견 구역 */
    await page.evaluate(()=>{S.grid.pinFound=null;addEvent('found','가상 발견','D4',true);commit();});await display.waitForTimeout(1300);
    check('발견 핀이 없으면 기록한 구역 칸에 발견 표를 띄움',(await display.locator('#mapWrap .found-zone').innerText()).includes('발견 D4'));
    await display.locator('#ackBtn').click();await display.waitForTimeout(800);
    check('발견 확인 뒤에도 지금 확인에 발견을 남김',(await display.locator('#wallAttention').innerText()).includes('발견 D4'));
    /* 5. 한 장 요약 */
    const brief=await page.evaluate(()=>briefingHtml().replace(/<style>[\s\S]*?<\/style>/,'').replace(/<[^>]+>/g,' '));
    check('한 장 요약에 지금 확인과 기체 남은 비행 상태가 들어감',/지금 확인 \d+건/.test(brief));
    /* 6. 서랍 위 경보음 단추 */
    check('상단 둘째 줄의 경보음 준비 단추가 서랍 위로 올라오지 않음',await display.evaluate(()=>getComputedStyle(document.getElementById('audioArm')).zIndex==='auto'));
    /* 10. 원거리 글자 */
    await page.evaluate(()=>{S.ui.viewPreset='far';commit();});await display.waitForTimeout(800);
    check('원거리 보기에서 지금 확인 글자가 20px 이상',await display.evaluate(()=>{const e=document.querySelector('.wa-item');return e&&parseFloat(getComputedStyle(e).fontSize)>=20;}));
    await page.evaluate(()=>{S.ui.viewPreset='standard';commit();});
    /* 9. 같은 구역 여러 대 */
    await page.evaluate(()=>{S.drones.forEach((d,i)=>{d.status='flying';d.tookOffAt=localDateTime(new Date(Date.now()-(i+2)*60000));d.zone='C3';d.pilot='조종 새';d.battery=90;d.batteryUpdatedAt=Date.now();});commit();});
    await display.setViewportSize({width:1366,height:768});await display.waitForTimeout(1300);
    const chip=await display.evaluate(()=>[...document.querySelectorAll('#mapWrap .drone-chip')].map(c=>c.textContent));
    check('같은 구역 여러 대는 표 하나로 합침',chip.length===1&&chip[0].startsWith('1·2·3호기'),chip);
    /* 7. 창 초점 */
    await page.locator('#tab-grid').click();await page.locator('[data-draw-line="route"]').click();await page.locator('dialog.field-dialog[open]').waitFor();
    check('선 긋기 창을 열면 이름 칸에 초점',await page.evaluate(()=>document.activeElement&&document.activeElement.id==='lineName'));
    await page.keyboard.press('Escape');
    await context.close();}
  /* 13~16. 안내 문구 · 잔량 미입력 · 통신 두절 */
  {const {context,page}=await open();
    check('준비 순서 안내가 지금 기록의 상태 반영과 격자로 시작을 알려 줌',await page.evaluate(()=>CONSOLE_FLOW.find(s=>s.id==='quick').hint.includes('상태도 함께')&&CONSOLE_FLOW.find(s=>s.id==='grid').hint.includes('격자로 시작')));
    await page.evaluate(()=>{const d=S.drones[2];d.battery=null;d.batteryUpdatedAt=0;d.status='flying';d.tookOffAt=localDateTime(new Date(Date.now()-2*60000));d.zone='E5';commit();});
    check('잔량을 넣지 않은 비행 기체는 즉시 복귀가 아니라 잔량 미입력',await page.evaluate(()=>{const r=droneReturnState(S.drones[2]);return r.lv==='warn'&&r.unknown&&!attentionItems().some(a=>a.text==='3호기 즉시 복귀')&&attentionItems().some(a=>a.text==='3호기 배터리 잔량 입력');}));
    const display=await wall(context,page);
    check('비운 잔량은 다른 창에서도 0%가 아니라 미입력',await display.evaluate(()=>S.drones[2].battery===null&&[...document.querySelectorAll('.drone .d-pct')].some(e=>e.textContent==='미입력')));
    await page.evaluate(()=>{S.drones[0].battery=80;S.drones[0].batteryUpdatedAt=Date.now();commit();});
    await page.locator('#tab-quick').click();await page.locator('[data-drone-quick="quick"] [data-dq-act="commloss"]').first().click();
    check('기체 빠른 갱신에서 통신 두절을 한 번에 기록',await page.evaluate(()=>S.drones[0].status==='commloss'&&S.events.at(-1).type==='accident'));
    await page.evaluate(()=>{const e=S.events.filter(e=>e.type==='accident').at(-1);e.t-=3*60000;commit();});await display.waitForTimeout(1400);
    check('통신 두절이 몇 분째인지 지금 확인에 표시',(await display.locator('#wallAttention').innerText()).includes('1호기 통신 두절 3분째'));
    await page.locator('[data-drone-quick="quick"] [data-dq-act="commok"]').first().click();
    check('통신 복구도 한 번에 기록',await page.evaluate(()=>S.drones[0].status==='flying'&&S.events.at(-1).text.includes('통신 복구')));
    /* 17~23. 카드 순서 · 빈 지금 확인 · 교체 없이 대기 · 기상 재확인 · 보고서 미입력 */
    await page.evaluate(()=>{S.drones[2].battery=90;S.drones[2].batteryUpdatedAt=Date.now();S.drones[0].status='ready';S.drones[0].tookOffAt='';S.drones[2].status='flying';S.drones[2].tookOffAt=localDateTime(new Date(Date.now()-60000));commit();});
    await display.waitForTimeout(1300);
    check('벽 화면 기체 카드는 떠 있는 기체가 먼저',await display.evaluate(()=>document.querySelector('.drone .d-name').textContent==='3호기'));
    await page.evaluate(()=>{S.weather.observedAt=Date.now()-45*60000;commit();});
    check('비행 중 기상 관측이 오래되면 지금 확인에 기상 재확인',await page.evaluate(()=>attentionItems().some(a=>a.text.startsWith('기상 재확인'))));
    await page.evaluate(()=>{S.drones[1].status='swap';S.drones[1].battery=60;commit();});
    await page.locator('[data-drone-quick="quick"] .dq-row.swap [data-dq-act="noswap"]').click();
    check('교체 없이 이륙대기는 잔량·재고를 그대로 두고 대기로',await page.evaluate(()=>S.drones[1].status==='ready'&&S.drones[1].battery===60&&S.events.at(-1).text.includes('교체 없이')));
    check('보고서 기체 요약도 잔량 미입력을 0%로 적지 않음',await page.evaluate(()=>{S.drones[1].battery=null;return buildReport().includes('2호기')&&/2호기[^\n]*배터리 미입력/.test(buildReport());}));
    await page.evaluate(()=>{S.drones.forEach(d=>{d.status='ready';d.tookOffAt='';d.battery=90;d.batteryUpdatedAt=Date.now();});S.crew.forEach(c=>{c.inAt=localDateTime(new Date(Date.now()-30*60000));});S.events=S.events.filter(e=>e.type!=='heat'&&e.type!=='found');S.batteries.ready=5;S.weather.observedAt=Date.now();commit();});
    await display.waitForTimeout(1400);
    check('확인할 것이 없으면 지금 확인할 것 없음을 표시',(await display.locator('#wallAttention').innerText()).includes('지금 확인할 것 없음'));
    await context.close();}
  /* 24~29. 브리핑 알림 · 추정 잔량 · 빈 잔량 칸 · 착륙 단추 · 발견 종류 · 기체 한눈에 · 선 위 칠하기 */
  {const {context,page}=await open();
    await page.evaluate(()=>{const d=new Date(Date.now()+10*60000);S.mission.briefing=p2(d.getHours())+':'+p2(d.getMinutes());commit();});
    check('지휘 브리핑 15분 전이면 지금 확인에 알림',await page.evaluate(()=>attentionItems().some(a=>a.text.startsWith('지휘 브리핑')&&/\d+분 후/.test(a.text))));
    await page.evaluate(()=>{const d=new Date(Date.now()+40*60000);S.mission.briefing=p2(d.getHours())+':'+p2(d.getMinutes());commit();});
    check('브리핑이 15분보다 멀면 알리지 않음',await page.evaluate(()=>!attentionItems().some(a=>a.text.startsWith('지휘 브리핑'))));
    const display=await wall(context,page);
    check('벽 카드는 비행 중 소모를 뺀 추정 잔량을 크게 보여 줌',await display.evaluate(()=>{const c=[...document.querySelectorAll('.drone')].find(x=>x.querySelector('.d-name').textContent==='1호기');return c&&c.querySelector('.d-pct').textContent.startsWith('추정')&&c.querySelector('.d-est').textContent.includes('마지막 입력 68%');}));
    check('한 장 요약·보고서도 비행 중 추정 잔량을 함께(68% → 추정 N%)',await page.evaluate(()=>/68% → 추정 \d+%/.test(briefingHtml())&&/1호기[^\n]*배터리 68% → 추정 \d+%/.test(buildReport())));
    check('벽 화면 오른쪽 위에 기체 한눈에 목록(비행 기체 먼저)',await display.evaluate(()=>{const t=document.getElementById('droneRiskSummary').innerText;return t.includes('기체 한눈에')&&t.indexOf('1호기')<t.indexOf('3호기');}));
    await page.locator('#tab-quick').click();
    const row=page.locator('[data-drone-quick="quick"] .dq-row:not(.swap):not(.pilot):not(.manned)').first();
    check('빠른 갱신 잔량 칸은 비어 있고 흐린 숫자는 지금 추정값(마지막 입력은 설명에)',await row.locator('[data-dq-batt]').inputValue()===''&&/^추정 \d+$/.test(await row.locator('[data-dq-batt]').getAttribute('placeholder'))&&(await row.locator('[data-dq-batt]').getAttribute('title')).includes('마지막 입력 68%'));
    await row.locator('[data-dq-act="batt"]').click();
    check('빈 잔량 칸으로 확인을 누르면 저장하지 않고 안내',await page.evaluate(()=>{const i=document.querySelector('[data-drone-quick="quick"] [data-dq-batt]');return S.drones[0].battery===68&&i.getAttribute('aria-invalid')==='true'&&i.nextElementSibling.textContent.includes('잔량');}));
    await row.locator('[data-dq-act="land"]').click();
    check('비행 기체 줄의 착륙 단추로 바로 배터리 교체 상태',await page.evaluate(()=>S.drones[0].status==='swap'&&S.events.at(-1).type==='landing'));
    check('지금 기록 종류에 발견(빨강)이 있음',await page.locator('[data-quick-type="found"].found').isVisible());
    let asked='';page.removeAllListeners('dialog');page.on('dialog',d=>{asked=d.message();d.dismiss();});
    await page.locator('[data-quick-type="found"]').click();await page.locator('#evText').fill('가상 발견 확인');await page.locator('#evText').press('Enter');await page.waitForTimeout(200);
    check('발견 기록은 저장 전에 한 번 더 확인',asked.includes('발견')&&await page.evaluate(()=>!S.events.some(e=>e.type==='found'&&e.text.includes('가상 발견 확인'))));
    page.removeAllListeners('dialog');page.on('dialog',d=>d.accept());
    await page.evaluate(()=>{S.grid.lines=[{id:'night_line',kind:'route',name:'선',points:[{x:.02,y:.5},{x:.98,y:.5}],updatedAt:Date.now()}];commit();});
    await page.locator('#tab-grid').click();await page.waitForTimeout(400);
    await page.locator('[data-map-host="consMap"][data-map-action="paint"]').first().click();
    const fold=page.locator('#sec-grid details:has([data-act="paints"]) > summary').first();if(await fold.count()&&await fold.isVisible()&&!(await page.locator('#sec-grid [data-act="paints"][data-v="2"]').first().isVisible()))await fold.click();
    await page.locator('#sec-grid [data-act="paints"][data-v="2"]').first().click();
    const c3=await page.locator('#consMap [data-cell="C3"]').boundingBox();await page.mouse.click(c3.x+c3.width/2,c3.y+c3.height/2);await page.waitForTimeout(250);
    check('선이 지나가는 칸도 칠하기로 완료 표시(선 창이 열리지 않음)',await page.evaluate(()=>S.grid.cells.C3&&S.grid.cells.C3.s===2&&!document.querySelector('dialog[open]')));
    await context.close();}
  /* 31~38. 기체 7대 · 열원감지 순서 · 항속 초과 문구 · 이륙 전 안내 · 지금 확인 한 줄 · 새벽 비행 */
  {const {context,page}=await open();
    await page.evaluate(()=>{const s=new Date();s.setHours(3,10,0,0);S.safety.nightApproval=false;S.drones[0].status='flying';S.drones[0].tookOffAt=localDateTime(new Date(s.getTime()-5*60000));commit();window.__dawn=s.getTime();});
    check('자정 넘은 새벽(일출 전) 비행도 야간 승인 없으면 위험',await page.evaluate(()=>attentionItems(window.__dawn).some(a=>a.lv==='danger'&&a.text==='일출 전 비행 중 · 야간 특별승인 없음')));
    await page.evaluate(()=>{S.safety.nightApproval=true;const t=Date.now();S.drones[0].tookOffAt=localDateTime(new Date(t-60*60000));S.drones[0].battery=90;S.drones[0].batteryUpdatedAt=t-60*60000;const d=S.drones[2];d.status='flying';d.pilot=S.drones[0].pilot;d.tookOffAt=localDateTime(new Date(t-15*60000));d.battery=95;d.batteryUpdatedAt=t-15*60000;commit();});
    check('항속시간을 넘긴 기체는 즉시 복귀 · 항속 초과로',await page.evaluate(()=>attentionItems().some(a=>a.text==='1호기 즉시 복귀 · 항속 초과')));
    check('배터리 재확인 줄에 추정 남은 시간을 함께',await page.evaluate(()=>droneRiskItems().find(i=>i.name==='3호기').reasons.some(r=>/재확인 필요 \(추정 약 \d+분 남음\)/.test(r))));
    await page.evaluate(()=>{const base=S.drones[1];for(let i=4;i<=7;i++){const d=JSON.parse(JSON.stringify(base));d.id='night_n'+i;d.name=i+'호기';d.status=i%2?'flying':'charging';d.zone=i%2?'D'+(i-2):'';d.pilot=S.drones[0].pilot;d.tookOffAt=i%2?localDateTime(new Date(Date.now()-(10+i)*60000)):'';d.battery=70;d.batteryUpdatedAt=Date.now()-(8+i)*60000;S.drones.push(d);}commit();});
    check('기체가 많아도 열원감지가 기체 주의 항목보다 앞',await page.evaluate(()=>{const a=attentionItems().map(x=>x.text);const h=a.findIndex(t=>t.startsWith('열원감지')),b=a.findIndex(t=>t.includes('배터리 재확인'));return h>=0&&b>=0&&h<b;}));
    const display=await wall(context,page,1366,768);
    check('기체 7대도 기체 한눈에 안에 모두 들어감(넘침 없음)',await display.evaluate(()=>{const s=document.getElementById('droneRiskSummary');return s.querySelectorAll('[data-drone-risk-id],[data-drone-row-id]').length===7&&s.scrollHeight<=s.clientHeight+2;}));
    const attn=await display.evaluate(()=>{const a=document.getElementById('wallAttention');return {h:Math.round(a.getBoundingClientRect().height),over:a.scrollWidth>a.clientWidth+1,more:!!a.querySelector('.wa-more')};});
    check('지금 확인이 많아도 한 줄로 두고 나머지는 외 N건',attn.h<=40&&!attn.over&&attn.more,attn);
    await page.locator('#tab-quick').click();await page.locator('[data-quick-type="takeoff"]').click();await page.locator('#evEntity').selectOption(await page.evaluate(()=>S.drones[0].id));
    check('이미 비행 중인 기체를 이륙으로 고르면 저장 전 주황 안내',(await page.locator('#quickContract').innerText()).includes('이미 비행 중')&&await page.locator('#quickContract').getAttribute('data-kind')==='warn');
    const zoneBefore=await page.evaluate(()=>S.drones[0].zone);await page.locator('#evZone').fill('A6');await page.locator('#evText').press('Enter');
    check('저장 뒤에도 상태는 그대로라고 알림',(await page.locator('#quickContract').innerText()).includes('상태는 그대로')&&await page.evaluate(z=>S.drones[0].zone===z,zoneBefore));
    await page.evaluate(()=>{S.drones[1].status='ready';S.drones[1].pilot='없는 사람';commit();});
    await page.locator('[data-quick-type="takeoff"]').click();await page.locator('#evEntity').selectOption(await page.evaluate(()=>S.drones[1].id));
    check('조종자가 투입 인원이 아닌 기체 이륙은 저장 전 주황 안내',(await page.locator('#quickContract').innerText()).includes('조종자(없는 사람)가 지금 투입된 조종 인원이 아닙니다'));
    await context.close();}
  /* 41~45. 빈 새 상황 · 원거리·1.5배 한눈에 · 발견 오입력 취소 · 재이륙 기록 누락 */
  {const {context,page}=await open();
    await page.evaluate(()=>{const t=Date.now(),d=S.drones[0];d.status='flying';d.tookOffAt=localDateTime(new Date(t-45*60000));d.battery=90;d.batteryUpdatedAt=t;commit();});
    check('항속을 넘겼는데 방금 잔량이 넉넉하면 즉시 복귀가 아니라 이륙 시각 확인',await page.evaluate(()=>{const r=droneReturnState(S.drones[0]);return r.lv==='warn'&&r.takeoffCheck&&attentionItems().some(a=>a.text==='1호기 이륙 시각 확인')&&!attentionItems().some(a=>a.text.startsWith('1호기 즉시 복귀'));}));
    await page.evaluate(()=>{S.drones[0].battery=25;S.drones[0].batteryUpdatedAt=Date.now();commit();});
    check('잔량이 낮으면 그대로 즉시 복귀 · 항속 초과',await page.evaluate(()=>attentionItems().some(a=>a.text==='1호기 즉시 복귀 · 항속 초과')));
    const display=await wall(context,page);
    await page.locator('#tab-quick').click();await page.locator('[data-quick-type="found"]').click();await page.locator('#evZone').fill('B4');await page.locator('#evText').fill('가상 오입력');await page.locator('#evText').press('Enter');
    await display.waitForTimeout(1300);
    const shown=await display.evaluate(()=>!document.getElementById('alertBanner').hidden);
    await page.locator('[data-quick-undo]').click();await display.waitForTimeout(1300);
    check('발견을 잘못 눌렀으면 2분 안에 발견 취소로 벽 경보를 거둠',shown&&await display.evaluate(()=>document.getElementById('alertBanner').hidden&&!latestFound())&&await page.evaluate(()=>S.events.at(-1).type==='correction'&&S.events.at(-1).text.includes('발견 경보 취소')));
    await page.evaluate(()=>{const base=S.drones[1];for(let i=4;i<=6;i++){const d=JSON.parse(JSON.stringify(base));d.id='night_m'+i;d.name=i+'호기';d.status=i%2?'charging':'flying';d.zone=i%2?'':'D'+(i-2);d.pilot=S.drones[0].pilot;d.tookOffAt=i%2?'':localDateTime(new Date(Date.now()-(10+i)*60000));d.battery=70;d.batteryUpdatedAt=Date.now()-(8+i)*60000;S.drones.push(d);}S.ui.scale=1.5;commit();});
    await display.setViewportSize({width:1366,height:768});await display.waitForTimeout(1400);
    check('글자 1.5배·1366에서도 기체 한눈에가 넘치지 않음(필요하면 위험 줄도 접고 몇 대 더인지 적음)',await display.evaluate(()=>{const s=document.getElementById('droneRiskSummary');return s.scrollHeight<=s.clientHeight+2&&[...s.querySelectorAll('.drone-risk-item:not(.calm)')].some(b=>b.offsetParent!==null);}));
    check('글자 1.5배·1366에서 넘치면 이상 없는 기체를 한 줄로 접음',await display.evaluate(()=>{const s=document.getElementById('droneRiskSummary');return s.classList.contains('tight')&&s.querySelector('.calm-sum').textContent.includes('이상 없음')&&s.scrollHeight<=s.clientHeight+2;}));
    await page.evaluate(()=>{S.ui.scale=1;S.ui.viewPreset='far';commit();});await display.setViewportSize({width:1920,height:1080});await display.waitForTimeout(1400);
    check('원거리 보기에서 이상 없는 기체 칸도 16px 이상',await display.evaluate(()=>{const e=document.querySelector('#droneRiskSummary .calm');return e&&parseFloat(getComputedStyle(e).fontSize)>=16;}));
    await page.evaluate(()=>{S.ui.viewPreset='standard';S.drones=[];S.crew=[];S.events=S.events.filter(e=>e.type!=='heat'&&e.type!=='found');S.subject.missingAt='';commit();});await display.waitForTimeout(1400);
    check('기본 입력이 비면 지금 확인 자리에 준비 중 · 무엇이 비었는지',(await display.locator('#wallAttention').innerText()).includes('준비 중 · 실종시각·기체 미입력'));
    await context.close();}
  /* 46. 열원감지 확인 결과 */
  {const {context,page}=await open();
    await page.locator('#tab-quick').click();
    check('열원감지가 있으면 수색 기록 탭에 확인 결과 줄',(await page.locator('[data-drone-quick="heat"]').innerText()).includes('열원 C3'));
    await page.locator('[data-drone-quick="heat"] [data-dq-act="heatclear"]').first().click();
    check('대상자 아님 · 확인 끝을 누르면 기록을 남기고 지금 확인에서 내림',await page.evaluate(()=>!attentionItems().some(a=>a.text.startsWith('열원감지'))&&S.events.at(-1).stateAction==='heatClear'&&S.events.at(-1).text.includes('대상자 아님')));
    const display=await wall(context,page);
    check('벽 기록의 원래 열원 줄에 확인 끝 표시',(await display.locator('#logBody').innerText()).includes('→ 확인 끝 · 대상자 아님'));
    check('보고서·한 장 요약에도 열원 확인 끝',await page.evaluate(()=>buildReport().includes('→ 확인 끝 · 대상자 아님')&&briefingHtml().includes('→ 확인 끝 · 대상자 아님')));
    await page.evaluate(()=>{S.events.at(-1).voided=true;commit();});
    check('확인 끝 기록을 취소하면 다시 확인 결과 대기',await page.evaluate(()=>attentionItems().some(a=>a.text.startsWith('열원감지'))));
    await page.evaluate(()=>{setMannedAlert(true);});await page.waitForTimeout(300);
    check('주간 테마에서 켜진 유인기 경보 단추는 흰 글자(초록 덮어쓰기 없음)',await page.evaluate(()=>getComputedStyle(document.getElementById('btnManned')).color==='rgb(255, 255, 255)'));
    await page.evaluate(()=>setMannedAlert(false));
    await context.close();}
  /* 49. 자정 넘긴 브리핑 · 절전 뒤 편집권 */
  {const {context,page}=await open();
    check('자정 직전에 적힌 다음 날 새벽 브리핑도 15분 전 알림',await page.evaluate(()=>{const now=new Date();now.setHours(23,55,0,0);S.mission.briefing='00:05';return attentionItems(now.getTime()).some(a=>a.text==='지휘 브리핑 00:05 · 10분 후');}));
    check('조금 전 지난 브리핑 시각은 다음 날로 보지 않음',await page.evaluate(()=>{const now=new Date();now.setHours(18,10,0,0);S.mission.briefing='18:00';return !attentionItems(now.getTime()).some(a=>a.text.startsWith('지휘 브리핑'));}));
    await page.evaluate(()=>{S.mission.briefing='';commit();});
    let dialogs=0;page.removeAllListeners('dialog');page.on('dialog',d=>{dialogs++;d.accept();});
    await page.locator('#tab-quick').click();await page.locator('#evText').fill('덮개 열고 바로 기록');
    await page.evaluate(()=>{const x=readEditorLock();x.expires=Date.now()-60000;localStorage.setItem(LOCKKEY,JSON.stringify(x));document.getElementById('btnAddEv').click();});await page.waitForTimeout(300);
    check('절전 등으로 내 편집권만 만료됐으면 누른 자리에서 되찾아 저장',dialogs===0&&await page.evaluate(()=>S.events.at(-1).text==='덮개 열고 바로 기록'&&ownsEditorLock()));
    /* 다른 창 편집권을 넣은 직후 5초 회수 주기가 화면을 다시 그릴 수 있으므로, 내용 입력 → (같은 순간) 다른 창 편집권 + 저장 단추 */
    await page.locator('#evText').fill('다른 창 편집 중');const n=await page.evaluate(()=>S.events.length);
    await page.evaluate(()=>{localStorage.setItem(LOCKKEY,JSON.stringify({id:'xother_window',epoch:SESSION_EPOCH,expires:Date.now()+60000,mode:'console'}));document.getElementById('btnAddEv').click();});await page.waitForTimeout(300);
    check('다른 창이 편집권을 가졌으면 그대로 막음',dialogs===1&&await page.evaluate(n=>S.events.length===n,n));
    page.removeAllListeners('dialog');page.on('dialog',d=>d.accept());
    await context.close();}
  /* 50. 기록 한도 */
  {const {context,page}=await open();
    await page.evaluate(()=>{const base=S.events[0];const t=Date.now()-3*24*3600e3;for(let i=S.events.length;i<4600;i++)S.events.push(Object.assign({},base,{id:'bulk'+i,t:t+i*50000,type:'note',text:'대량 '+i,emergency:false}));commit();});
    check('일반 기록이 90%를 넘으면 지금 확인에 백업 후 새 상황 준비',await page.evaluate(()=>attentionItems().some(a=>a.lv==='warn'&&a.text==='기록 4,600/5,000건 · 백업 후 새 상황 준비')));
    await page.evaluate(()=>{const base=S.events[0];for(let i=4600;i<5000;i++)S.events.push(Object.assign({},base,{id:'bulk'+i,t:Date.now()-1000,type:'note',text:'대량 '+i,emergency:false}));commit();});
    await page.locator('#tab-quick').click();await page.locator('[data-quick-type="found"]').click();await page.locator('#evZone').fill('B4');await page.locator('#evText').fill('한도에서 발견');await page.locator('#evText').press('Enter');await page.waitForTimeout(300);
    check('한도에 닿아도 발견은 긴급 기록으로 저장',await page.evaluate(()=>{const e=S.events.at(-1);return e.type==='found'&&e.text==='한도에서 발견'&&e.emergency===true;}));
    check('발견을 긴급으로 넣은 백업도 다시 읽힘',await page.evaluate(()=>{try{validateImportPackage(JSON.parse(exportPayload(true)));return true;}catch(e){return false;}}));
    await context.close();}
  /* 54. 교체 없이 이륙대기 뒤 잔량 추정 */
  {const {context,page}=await open();
    await page.evaluate(()=>{const d=S.drones[2],t=Date.now();d.status='swap';d.tookOffAt='';d.battery=90;d.batteryUpdatedAt=t-30*60000;
      addEvent('takeoff','3호기 이륙','E5',true,new Date(t-28*60000),{entityType:'drone',entityId:d.id});addEvent('landing','3호기 착륙','E5',true,new Date(t-8*60000),{entityType:'drone',entityId:d.id});commit();});
    await page.locator('#tab-quick').click();
    const row=page.locator(`[data-drone-quick="quick"] [data-dq-id="${await page.evaluate(()=>S.drones[2].id)}"]`);
    check('교체 없이 이륙대기 단추가 마지막 확인 뒤 비행한 시간을 알려 줌',(await row.locator('[data-dq-act="noswap"]').innerText()).includes('그 뒤 20분 비행'));
    await row.locator('[data-dq-act="noswap"]').click();
    check('교체 없이 이륙대기는 비행한 만큼 낮춘 추정 잔량·미확인으로 둠',await page.evaluate(()=>{const d=S.drones[2];return d.status==='ready'&&d.battery===Math.max(0,Math.round(90-(75/Math.max(1,num(d.endurance,25)))*20))&&d.battery<85&&!d.batteryUpdatedAt&&S.events.at(-1).text.includes('20분 비행 추정');}));
    await context.close();}
  /* 56. 독립 검토 2차: 한눈에·판정 문구 일치, 조종자 추천, 교체 경과, 일출까지, 열원 지도·발견 바로가기 */
  {const {context,page}=await open();
    await page.evaluate(()=>{const d3=S.drones[2];d3.status='flying';d3.tookOffAt=localDateTime(new Date(Date.now()-6*60000));d3.zone='E5';d3.battery=92;d3.batteryUpdatedAt=Date.now()-60000;commit();});
    const display=await wall(context,page);
    check('지금 확인의 조종자 확인 필요 기체가 기체 한눈에서도 확인 필요(주의)',await display.evaluate(()=>[...document.querySelectorAll('#droneRiskSummary .drone-risk-item.warn')].some(b=>b.textContent.startsWith('3호기 · 조종자 확인 필요'))));
    check('비행 판정 문구도 조종자 확인 필요로 같은 말',(await display.locator('#kFlight').innerText()).includes('3호기 조종자 확인 필요'));
    check('지도에 확인 대기 중인 열원 칸',(await display.locator('#mapWrap .heat-zone').innerText()).includes('열원 C3'));
    check('밤에는 일몰까지 대신 일출까지 남은 시간',await display.evaluate(()=>{const k=kpiSunset(new Date(new Date().setHours(2,0,0,0)));return k.l==='일출까지'&&/^(\d+시간 )?\d+분$/.test(k.v);}));
    await page.locator('#tab-quick').click();
    await page.waitForTimeout(1500);
    check('1초 갱신 뒤에도 조종자 확인 줄 글·추정 잔량이 유지됨',await page.evaluate(()=>{const p=document.querySelector('[data-drone-quick="quick"] .dq-row.pilot .dq-state'),a=document.querySelector('[data-drone-quick="quick"] .dq-row:not(.swap):not(.pilot) [data-dq-state]');return p&&p.textContent.startsWith('조종자 확인 필요')&&a&&/추정 \d+%/.test(a.textContent);}));
    check('새 조종자 후보 중 오래 근무한 사람은 근무 시간·휴식 필요로(추천처럼 읽히지 않게)',/근무 \d+시간 \d+분 · 본인도 휴식 필요/.test(await page.locator('[data-drone-quick="quick"] [data-dq-pilot]').first().innerText()));
    check('배터리 교체가 30분을 넘으면 지금 확인에 교체 완료 확인',await page.evaluate(()=>attentionItems().some(a=>/^2호기 교체 \d+분째 · 교체 완료 확인$/.test(a.text))));
    check('교체 중 기체는 몇 분째인지와 재고 변화(9 → 8개)를 보여 줌',await page.evaluate(()=>{const r=document.querySelector('[data-drone-quick="quick"] .dq-row.swap');return /교체 중 · \d+분째/.test(r.textContent)&&r.textContent.includes('재고 9 → 8개');}));
    await page.locator('[data-drone-quick="heat"] [data-dq-act="heatfound"]').click();
    check('열원 줄의 대상자 발견은 발견 기록을 구역·내용까지 채워 준비',await page.evaluate(()=>quickEv.type==='found'&&document.getElementById('evZone').value==='C3'&&document.getElementById('evText').value.startsWith('열원 확인 결과 대상자 발견')&&document.activeElement.id==='evText'));
    await page.locator('#evText').press('Enter');await display.waitForTimeout(1300);
    check('같은 구역 발견을 기록하면 열원은 대상자 발견으로 닫힘',await page.evaluate(()=>!attentionItems().some(a=>a.text.startsWith('열원감지'))&&!document.querySelector('[data-drone-quick="heat"]'))&&(await display.locator('#logBody').innerText()).includes('→ 대상자 발견'));
    await context.close();}
  /* 70. 유인기 경보 중 이륙 */
  {const {context,page}=await open();
    await page.evaluate(()=>setMannedAlert(true));await page.locator('#tab-quick').click();await page.locator('[data-quick-type="takeoff"]').click();
    check('유인기 경보 중 이륙 종류는 이륙 금지 안내가 먼저',(await page.locator('#quickContract').innerText()).startsWith('⚠ 유인기 진입 경보 중'));
    let asked='';page.removeAllListeners('dialog');page.on('dialog',d=>{asked=d.message();d.dismiss();});
    await page.locator('#evEntity').selectOption(await page.evaluate(()=>S.drones[2].id));await page.locator('#evText').press('Enter');await page.waitForTimeout(200);
    check('경보 중 이륙 저장은 한 번 더 묻고 취소하면 그대로',asked.includes('이륙 금지')&&await page.evaluate(()=>S.drones[2].status==='ready'));
    page.removeAllListeners('dialog');page.on('dialog',d=>d.accept());await page.evaluate(()=>setMannedAlert(false));
    await page.evaluate(()=>{S.weather.wind=20;S.weather.observedAt=Date.now();commit();});await page.locator('[data-quick-type="note"]').click();await page.locator('[data-quick-type="takeoff"]').click();await page.locator('#evEntity').selectOption(await page.evaluate(()=>S.drones[2].id));
    check('판정이 비행 불가면 이륙 기록 전에 이유와 함께 경고',(await page.locator('#quickContract').innerText()).startsWith('⚠ 지금 판정은 비행 불가'));
    await context.close();}
  /* 72. 코드 검토 반영: 중복 기록 취소, 모두 착륙, 브리핑 오후 표기 */
  {const {context,page}=await open();
    await page.locator('#tab-quick').click();const id1=await page.evaluate(()=>S.drones[0].id);
    await page.locator(`[data-drone-quick="quick"] [data-dq-id="${id1}"] [data-dq-act="land"]`).click();
    await page.locator('[data-quick-type="landing"]').click();await page.locator('#evEntity').selectOption(id1);await page.locator('#evText').press('Enter');
    const eid=await page.evaluate(()=>S.events.at(-1).id);
    await page.locator(`#sec-quick [data-act="voidevent"][data-eid="${eid}"]`).first().click();await page.locator('#eventFixRevert').waitFor();
    check('같은 기체 착륙 기록이 둘이면 취소할 때 상태 되돌리기를 기본으로 체크하지 않음',!(await page.locator('#eventFixRevert').isChecked()));
    await page.keyboard.press('Escape');
    await page.evaluate(()=>{const d=S.drones[2];d.status='flying';d.tookOffAt=localDateTime(new Date(Date.now()-5*60000));d.pilot=S.drones[0].pilot;S.drones[0].status='flying';S.drones[0].tookOffAt=localDateTime(new Date(Date.now()-9*60000));commit();setMannedAlert(true);});
    await page.locator('[data-drone-quick="quick"] [data-dq-act="landall"]').click();
    check('유인기 경보 중 모두 착륙 기록도 배터리교체 단계로',await page.evaluate(()=>S.drones[0].status==='swap'&&S.drones[2].status==='swap'));
    await page.evaluate(()=>setMannedAlert(false));
    check('브리핑 오후·PM 표기를 오후 시각으로, 1시간마다는 시각으로 보지 않음',await page.evaluate(()=>{const n=new Date();n.setHours(17,55,0,0);const r=b=>{S.mission.briefing=b;return attentionItems(n.getTime()).some(a=>a.text==='지휘 브리핑 18:00 · 5분 후');};const ok=r('오후 6시')&&r('6:00 PM');S.mission.briefing='1시간마다';const n2=new Date();n2.setHours(0,50,0,0);return ok&&!attentionItems(n2.getTime()).some(a=>a.text.startsWith('지휘 브리핑'));}));
    await context.close();}
  /* 판정 등급·시간 표기 통일(2026-11-16 아침) */
  {const {context,page}=await open();
    check('시간 길이는 시간·분으로(시각 HH:MM과 구분)',await page.evaluate(()=>durHM(15*3600e3+39*60e3)==='15시간 39분'&&durHM(45*60e3)==='45분'&&kpiGolden(new Date()).v.includes('시간')));
    const display=await wall(context,page);
    check('벽 상단 숫자·인원 근무·기체 비행시간에 단위가 붙고 칸을 넘지 않음',await display.evaluate(()=>{const ok=id=>{const e=document.getElementById(id);return /(시간|분)/.test(e.textContent)&&e.scrollWidth<=e.clientWidth+1;};const el=[...document.querySelectorAll('.drone .d-el')].filter(e=>e.textContent!=='—');const crew=document.querySelector('#crewBody .ct');return ok('vGolden')&&ok('vElapsed')&&el.length&&el.every(e=>/분$/.test(e.textContent)&&e.scrollWidth<=e.clientWidth+1)&&/시간 \d+분$/.test(crew.textContent);}));
    check('대상자 칸은 감지기 미착용으로(감지된 것 없음으로 읽히지 않게)',(await display.locator('body').innerText()).includes('감지기 미착용'));
    await context.close();}
  /* 재검증(2026-11-24): 비행 불가 사유가 지금 확인에 · 인원 관리 근무 표시 */
  {const {context,page}=await open();
    await page.evaluate(()=>{S.safety.nightApproval=true;S.weather.observedAt=Date.now();S.weather.wind=15;commit();});
    check('비행 중 풍속이 한계를 넘으면 지금 확인에 비행 불가 · 회수 판단(위험)',await page.evaluate(()=>attentionItems().some(a=>a.lv==='danger'&&/^비행 불가 · 풍속 15m\/s \(한계 \d+\) · 회수 판단$/.test(a.text))));
    await page.evaluate(()=>{S.weather.wind=4;S.safety.noFly=true;S.safety.approval='pending';S.drones.forEach(d=>{d.status='ready';d.tookOffAt='';});commit();});
    check('떠 있는 기체가 없으면 이륙 금지(주의)로, 확인할 것 없음으로 보이지 않음',await page.evaluate(()=>attentionItems().some(a=>a.lv==='warn'&&a.text==='이륙 금지 · 비행금지구역 · 승인완료 확인 필요')));
    await page.evaluate(()=>{S.safety.noFly=false;S.safety.approval='done';commit();setMannedAlert(true);});
    check('유인기 진입은 이미 있는 항목으로만(같은 사유를 두 번 올리지 않음)',await page.evaluate(()=>!attentionItems().some(a=>/^(비행 불가|이륙 금지) · 유인기/.test(a.text))));
    await page.evaluate(()=>setMannedAlert(false));
    await page.locator('#tab-crew').click();
    check('인원 관리에 근무 시간·교대 권고·조종 중 기체',await page.evaluate(()=>[...document.querySelectorAll('#sec-crew .crew-dur.tired')].some(e=>/^근무 \d+시간 \d+분 · 교대 권고/.test(e.textContent))));
    await context.close();}
  /* 재검증 검토 반영(2026-11-24): 조종자 사유 말·순서 · 벽 카드 문구 · 우선 지시 시각 · 노트북 판정 색 */
  {const {context,page}=await open();
    const why=()=>page.evaluate(()=>flightVerdict(new Date()).why.find(w=>w.startsWith('1호기 조종자')));
    const pilot=await page.evaluate(()=>{const p=S.drones[0].pilot;S.crew.find(c=>c.name===p).outAt=localDateTime(new Date());commit();return p;});
    check('조종자 사유: 교대 종료',(await why())==='1호기 조종자 확인 필요('+pilot+' 교대 종료)',await why());
    check('지금 확인에서 조종자 확인이 열원감지보다 앞(판정 첫 사유와 같은 순서)',await page.evaluate(()=>{const a=attentionItems().map(i=>i.text);const p=a.indexOf('1호기 조종자 확인 필요'),h=a.findIndex(t=>t.startsWith('열원감지'));return p>=0&&(h<0||p<h);}));
    await page.evaluate(()=>{S.drones[0].pilot='명부밖';commit();});
    check('조종자 사유: 명부에 없음',(await why())==='1호기 조종자 확인 필요(명부밖 명부에 없음)',await why());
    const obs=await page.evaluate(()=>{const c=S.crew.find(c=>c.role!=='조종'&&!c.outAt);S.drones[0].pilot=c.name;commit();return c.name;});
    check('조종자 사유: 조종 역할 아님',(await why())==='1호기 조종자 확인 필요('+obs+' 조종 역할 아님)',await why());
    await page.evaluate(()=>{S.crew.push({id:uid(),name:'늦은조종',role:'조종',inAt:localDateTime(new Date(Date.now()+3600e3)),outAt:''});S.drones[0].pilot='늦은조종';commit();});
    check('조종자 사유: 투입 시각 전',(await why())==='1호기 조종자 확인 필요(늦은조종 투입 시각 전)',await why());
    await page.locator('#tab-quick').click();
    check('입력 화면 조종자 줄도 같은 말',(await page.locator('[data-drone-quick="quick"] .dq-row.pilot .dq-state').first().innerText()).includes('늦은조종 투입 시각 전'));
    check('노트북 판정 줄은 제한 비행이면 주의 색·▲',await page.evaluate(()=>{const e=document.getElementById('consoleVerdictReason');return document.getElementById('verdictHelp').dataset.verdictLevel==='warn'&&getComputedStyle(e,'::before').content.includes('▲');}));
    await page.evaluate(()=>{S.safety.nightApproval=true;S.weather.observedAt=Date.now();S.weather.wind=15;commit();});await page.waitForTimeout(300);
    check('노트북 판정 줄은 비행 불가면 위험 색·■',await page.evaluate(()=>{const e=document.getElementById('consoleVerdictReason');return document.getElementById('verdictHelp').dataset.verdictLevel==='danger'&&e.textContent.startsWith('비행 불가')&&getComputedStyle(e,'::before').content.includes('■')&&getComputedStyle(e).color!==getComputedStyle(document.getElementById('verdictCount')).color;}));
    await page.evaluate(()=>{S.weather.wind=4;commit();});
    await page.locator('[data-field-action="message"]').first().click();await page.locator('#fieldMessageText').fill('B구역 하천변 우선 수색');await page.locator('#fieldMessagePublish').click();
    const stamp=/^현재 우선 지시 · \d\d:\d\d 지시$/;
    check('우선 지시를 올리면 입력 화면 제목에 올린 시각',stamp.test(await page.locator('#consolePriority [data-priority-label]').innerText()));
    const display=await wall(context,page);
    check('벽 화면 우선 지시 제목에도 올린 시각',stamp.test(await display.locator('#displayPriorityLabel').innerText()));
    check('벽 카드 추정 설명은 짧게(확인시각 없음·입력 요청 반복 없음)',await display.evaluate(()=>[...document.querySelectorAll('.drone .d-est')].every(e=>!e.textContent.includes('확인시각 없음')&&!e.textContent.includes('실제 잔량을 확인'))));
    await page.evaluate(()=>{S.mission.priorityOrder='손으로 바꾼 지시';commit();});
    check('기록 없이 바뀐 지시는 시각을 붙이지 않음',(await page.locator('#consolePriority [data-priority-label]').innerText())==='현재 우선 지시');
    await context.close();}
  /* 4. 휴대폰 위험 줄 */
  {const {context,page}=await open({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await page.waitForTimeout(1300);const line=page.locator('[data-brief-attn]');
    check('휴대폰은 위험 항목이 있으면 위쪽에 빨간 한 줄',await line.isVisible()&&(await line.innerText()).includes('1호기 즉시 복귀'));
    await page.locator('.mobile-nav button',{hasText:'드론'}).first().tap();await line.tap();await page.waitForTimeout(300);
    check('빨간 줄을 누르면 수색 기록의 잔량 입력으로 이동',await page.evaluate(()=>document.querySelector('[role=tabpanel]:not([hidden])').id==='sec-quick'&&document.activeElement.dataset.dqBatt!==undefined));
    await context.close();}
  check('페이지 실행 오류 없음',errors.length===0,errors);
}finally{await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,results},null,2));await browser.close();await new Promise(r=>server.close(r));}
assert.equal(results.filter(r=>!r.pass).length,0,'Night verification failed');
