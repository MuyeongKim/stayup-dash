/* 드론 운용·관제(2026-11-15 5회 반복 보완): 비행 중 줄어드는 남은 비행시간과 복귀 판단, 지도 위 비행 기체 표시,
 * 기록자의 기체 빠른 갱신(잔량 확인·배터리 교체 완료), 기록의 구역 중복 표시 제거, 지휘관용 '지금 확인' 줄,
 * 경보 중 안전 띠 잘림 없음. 연습 자료와 일회용 저장소만 사용한다.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-drone-ops';await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port+'/stayup-dash.html?practice=1';
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[],errors=[];
const check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name+(pass||detail===undefined?'':' '+JSON.stringify(detail)));};
try{
  const context=await browser.newContext({viewport:{width:1366,height:900},serviceWorkers:'block',reducedMotion:'reduce'});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(base);await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  const close=page.locator('[data-onboard-action="close"]');if(await close.isVisible())await close.click();
  /* 1. 남은 비행시간 계산 */
  const calc=await page.evaluate(()=>{
    const now=Date.now(),d={status:'flying',battery:100,endurance:30,tookOffAt:localDateTime(new Date(now-60000)),batteryUpdatedAt:now-60000,zone:''};
    const at=m=>droneRemainMin(d,now+m*60000);
    const r={start:at(0),later:at(10),ok:droneReturnState(d,now+19*60000).lv,warn:droneReturnState(d,now+24*60000).lv,danger:droneReturnState(d,now+27*60000).lv,over:droneReturnState(d,now+31*60000).over};
    d.batteryUpdatedAt=now+10*60000;d.battery=100;r.reset=droneRemainMin(d,now+10*60000);
    const ground=Object.assign({},d,{status:'ready'});r.ground=droneReturnState(ground,now);r.groundRemain=droneRemainMin(ground,now);
    return r;});
  check('비행 중에는 배터리 입력 뒤 흐른 시간만큼 남은 비행이 줄어듦',calc.start===29&&calc.later===19,calc);
  check('남은 비행 5분 이하 복귀 준비, 2분 이하 즉시 복귀, 항속시간 초과 표시',calc.ok==='ok'&&calc.warn==='warn'&&calc.danger==='danger'&&calc.over===true,calc);
  check('잔량을 다시 확인하면 그 시각부터 다시 계산',calc.reset===30,calc);
  check('땅에 있는 기체는 복귀 판단을 하지 않음',calc.ground===null&&calc.groundRemain===30,calc);
  /* 연습 자료: 1호기는 22분째 배터리 확인이 없어 즉시 복귀 */
  const risk=await page.evaluate(()=>droneRiskItems(Date.now()).map(i=>i.level+':'+i.reasons.join('/')));
  check('위험 요약에 즉시 복귀 사유가 들어감',risk.some(r=>r.startsWith('danger:')&&r.includes('즉시 복귀')),risk);
  /* 벽 화면 */
  const popup=context.waitForEvent('page');await page.locator('#btnOpenDisplay').click();const display=await popup;
  display.on('pageerror',e=>errors.push('현황:'+e.message));await display.setViewportSize({width:1920,height:1080});
  await display.waitForFunction(()=>typeof S==='object'&&S.drones.length>0);await display.waitForTimeout(1500);
  const card=await display.evaluate(()=>{const c=document.querySelector('.drone[data-id]');return {badge:c.querySelector('.d-ret').hidden?'':c.querySelector('.d-ret').textContent,ret:c.dataset.ret,rm:c.querySelector('.d-rm').textContent,est:c.querySelector('.d-est').hidden?'':c.querySelector('.d-est').textContent,next:document.querySelector('#droneMeta .d-next').textContent};});
  check('벽 화면 기체 카드에 즉시 복귀 배지·남은 비행·소모 추정',card.badge.includes('즉시 복귀')&&card.ret==='danger'&&/약 \d+분/.test(card.rm)&&card.est.includes('소모 추정'),card);
  check('기체 카드 제목줄에 다음 복귀 기체',card.next.includes('다음 복귀 1호기'),card);
  const chips=await display.evaluate(()=>[...document.querySelectorAll('#mapWrap .drone-chip')].map(c=>c.dataset.lv+':'+c.textContent));
  check('비행 중 기체가 담당구역 칸에 자동 표시',chips.length===1&&chips[0].includes('1호기')&&chips[0].startsWith('danger'),chips);
  await page.evaluate(()=>{S.grid.equipment=[{id:'eq_ops_d1',kind:'drone',name:'1호기',droneId:S.drones[0].id,positionRole:'reported',x:60,y:50,updatedAt:Date.now()}];commit();});
  await display.waitForTimeout(1400);
  const marked=await display.evaluate(()=>({chips:document.querySelectorAll('#mapWrap .drone-chip').length,marker:(()=>{const m=document.querySelector('#mapWrap .equipment-marker[data-kind="drone"]');return m&&m.dataset.lv+':'+m.querySelector('.equipment-label small').textContent;})()}));
  check('기체 보고 위치 표식이 있으면 칸 표 대신 표식에 상태를 붙여 두 번 보이지 않음',marked.chips===0&&marked.marker==='danger:즉시 복귀',marked);
  /* 지금 확인 */
  const attn=await display.evaluate(()=>[...document.querySelectorAll('#wallAttention .wa-item')].map(i=>i.dataset.lv+':'+i.textContent));
  check('지금 확인 줄은 위험부터 기체 복귀·교대 권고·열원감지를 모음',attn[0]&&attn[0].startsWith('danger:1호기 즉시 복귀')&&attn.some(a=>a.includes('교대 권고'))&&attn.some(a=>a.includes('열원감지')),attn);
  const h1=await display.evaluate(()=>Math.round(document.querySelector('.board .hdr').getBoundingClientRect().height));
  /* 기록자: 기체 빠른 갱신 */
  await page.locator('#tab-quick').click();
  const live=page.locator('[data-drone-quick="quick"] .dq-row:not(.swap) [data-dq-batt]');await live.fill('80');await live.press('Enter');
  check('수색 기록 탭에서 비행 중 잔량을 Enter로 확인하고 결과를 알림',await page.evaluate(()=>S.drones[0].battery===80&&Date.now()-S.drones[0].batteryUpdatedAt<5000)&&(await page.locator('[data-drone-quick="quick"] .dq-msg').innerText()).includes('남은 비행'));
  await display.waitForTimeout(1400);
  check('잔량 확인 뒤 벽 화면 즉시 복귀가 풀림',await display.evaluate(()=>{const c=document.querySelector('.drone[data-id]');return c.querySelector('.d-ret').hidden&&!document.querySelector('#wallAttention').textContent.includes('1호기');}));
  const stock=await page.evaluate(()=>({ready:S.batteries.ready,empty:S.batteries.empty}));
  const sw=page.locator('[data-drone-quick="quick"] .dq-row.swap');await sw.locator('[data-dq-batt]').fill('97');await sw.locator('[data-dq-act="swap"]').click();
  const swapped=await page.evaluate(()=>({st:S.drones[1].status,b:S.drones[1].battery,at:S.drones[1].batteryUpdatedAt>0,ready:S.batteries.ready,empty:S.batteries.empty,last:S.events.at(-1).text}));
  check('배터리 교체 완료 한 번으로 잔량·확인시각·이륙대기·재고 이동·기록',swapped.st==='ready'&&swapped.b===97&&swapped.at&&swapped.ready===stock.ready-1&&swapped.empty===stock.empty+1&&swapped.last.includes('배터리 교체 완료'),{stock,swapped});
  const bad=page.locator('[data-drone-quick="quick"] .dq-row:not(.swap) [data-dq-batt]');await bad.fill('140');await bad.press('Enter');
  check('0~100% 밖의 잔량은 저장하지 않음',await page.evaluate(()=>S.drones[0].battery===80));
  /* 기록의 구역 중복 */
  const rows=await display.evaluate(()=>[...document.querySelectorAll('#logBody .lx')].map(r=>r.textContent));
  check('기록 목록에 C3 C3처럼 구역이 겹쳐 나오지 않음',rows.length>0&&!rows.some(t=>/\b([A-L]\d{1,2}) \1\b/.test(t)),rows.slice(0,4));
  /* 입력 화면에도 지금 확인 */
  await page.evaluate(()=>{S.drones[0].battery=10;S.drones[0].batteryUpdatedAt=Date.now();commit();});await page.waitForTimeout(1200);
  check('입력 화면 숫자 줄에도 지금 확인을 보여 줌',(await page.locator('#ctKpi .ck-attn').innerText()).includes('1호기 즉시 복귀'));
  /* 경보 중 안전 띠 */
  await page.evaluate(()=>setMannedAlert(true));
  for(const [w,h] of [[1920,1080],[1366,768]]){
    await display.setViewportSize({width:w,height:h});await display.waitForTimeout(600);
    const clipped=await display.evaluate(()=>[...document.querySelectorAll('#safetyBody .sf .sv')].filter(v=>v.scrollWidth>v.clientWidth+1||v.scrollHeight>v.clientHeight+2).map(v=>v.textContent));
    check(w+'×'+h+' 유인기 경보 중에도 안전 띠 값이 잘리지 않음',clipped.length===0,clipped);
  }
  await page.evaluate(()=>setMannedAlert(false));
  /* 확인할 것이 없어도 상단 높이가 그대로 */
  await display.setViewportSize({width:1920,height:1080});
  await page.evaluate(()=>{S.drones[0].battery=95;S.drones[0].batteryUpdatedAt=Date.now();S.crew.forEach(c=>{c.inAt=localDateTime(new Date(Date.now()-30*60000));});S.events=S.events.filter(e=>e.type!=='heat');S.batteries.ready=5;commit();});
  await display.waitForTimeout(1500);
  const h2=await display.evaluate(()=>Math.round(document.querySelector('.board .hdr').getBoundingClientRect().height));
  check('확인할 것이 사라져도 상단 높이가 같아 화면이 흔들리지 않음',!await display.locator('#wallAttention').isVisible()&&Math.abs(h2-h1)<=1,{h1,h2});
  check('1920×1080 벽 화면 지도가 화면의 30% 이상',await display.evaluate(()=>{const m=document.getElementById('mapWrap').getBoundingClientRect();return m.width*m.height/(innerWidth*innerHeight)>=.30;}));
  await display.screenshot({path:path.join(out,'wall.png')});
  check('페이지 실행 오류 없음',errors.length===0,errors);
  await context.close();
}finally{await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,results},null,2));await browser.close();await new Promise(r=>server.close(r));}
assert.equal(results.filter(r=>!r.pass).length,0,'Drone operations validation failed');
