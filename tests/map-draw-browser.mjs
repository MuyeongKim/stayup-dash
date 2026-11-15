/* 지도 그리기(2026-11-15): 선 긋기(이동 경로·수색 동선·통제선), 원 범위, 사람·장소 표식, 표식 끌어 옮기기,
 * 벽 화면 지도 면적과 안전 띠, 입력 화면에서 지도가 첫 화면에 들어오는지. 연습 자료와 일회용 저장소만 사용한다.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-map-draw';await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port+'/stayup-dash.html?practice=1';
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[],errors=[];
const check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name+(pass||detail===undefined?'':' '+JSON.stringify(detail)));};
try{
  const context=await browser.newContext({viewport:{width:1366,height:900},serviceWorkers:'block',reducedMotion:'reduce'});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const confirms=[];page.on('dialog',d=>{confirms.push(d.message());d.accept();});
  await page.goto(base);await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  const close=page.locator('[data-onboard-action="close"]');if(await close.isVisible())await close.click();
  await page.locator('#tab-grid').click();
  const first=await page.evaluate(()=>{const m=document.getElementById('consMap').getBoundingClientRect();return {top:m.top,h:innerHeight};});
  check('수색 지도 탭을 열면 지도가 첫 화면 안에서 시작',first.top<first.h-250,first);
  const groups=await page.evaluate(()=>[...document.querySelectorAll('[data-equipment-tools] [data-draw-group]')].map(g=>g.dataset.drawGroup));
  check('지도 아래 그리기 도구에 선 긋기·범위 그리기·표식 놓기 묶음',groups.join()==='lines,areas,marks',groups);
  check('사람·장소 표식 종류 추가(지상팀·수색견·구조대·집결지)',await page.evaluate(()=>['team','dog','rescue','cp'].every(k=>!!document.querySelector('[data-equipment-kind="'+k+'"]'))));
  await page.locator('[data-draw-jump]').click();
  check('지도 위 바로가기로 그리기 도구에 초점 이동',await page.evaluate(()=>document.activeElement&&document.activeElement.dataset.drawLine==='route'));
  const dialog=page.locator('dialog.field-dialog[open]'),box=async()=>{/* 저장 직후 입력 화면을 다시 그리는 동안에는 지도가 잠깐 없다. 다시 잡힐 때까지 기다린다. */for(let i=0;i<30;i++){const b=await page.locator('#consMap .mapfit').boundingBox().catch(()=>null);if(b&&b.width)return b;await page.waitForTimeout(100);}throw Error('지도 영역을 찾지 못함');};
  const at=async(fx,fy)=>{const b=await box();return [b.x+b.width*fx,b.y+b.height*fy];};
  const before=await page.evaluate(()=>exportPayload(true));
  await page.locator('[data-draw-line="route"]').click();await dialog.waitFor();
  check('선 긋기 창은 세 종류와 이름을 보여 주고 이동 경로를 기본으로 선택',await page.locator('[data-line-kind="route"]').getAttribute('aria-checked')==='true'&&await page.locator('#lineName').inputValue()==='이동 경로 1');
  await page.locator('[data-line-action="start"]').click();await page.locator('.line-editbar').waitFor();
  for(const [fx,fy] of [[.12,.8],[.3,.62],[.45,.55],[.62,.35],[.8,.2]]){const [x,y]=await at(fx,fy);await page.mouse.click(x,y);}
  check('지도를 누를 때마다 점이 늘고 저장 전에는 업무 자료가 그대로',await page.evaluate(()=>lineDraft.points.length)===5&&await page.evaluate(b=>exportPayload(true)===b,before));
  {const [x,y]=await at(.45,.55),[x2,y2]=await at(.47,.7);await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x2,y2,{steps:5});await page.mouse.up();}
  check('찍은 점은 끌어서 옮기고 점 수는 그대로',await page.evaluate(()=>lineDraft.points.length===5&&Math.abs(lineDraft.points[2].y-.7)<.02));
  await page.locator('[data-draw-action="line-undo"]').click();
  check('점 취소는 마지막 점만 지움',await page.evaluate(()=>lineDraft.points.length)===4);
  await page.locator('[data-draw-action="line-save"]').click();
  const saved=await page.evaluate(()=>S.grid.lines.map(l=>({kind:l.kind,name:l.name,n:l.points.length})));
  check('선 저장 뒤 이동 경로 1개(점 4개)가 남음',saved.length===1&&saved[0].kind==='route'&&saved[0].n===4,saved);
  check('저장 안내에 길이를 함께 알림',/이동 경로 1 · 약 [\d.]+(km|m) 저장/.test(await page.locator('.map-msg').first().innerText().catch(()=>'')||await page.evaluate(()=>document.body.innerText)));
  await page.locator('[data-draw-line="control"]').click();await dialog.waitFor();await page.locator('[data-line-action="start"]').click();await page.locator('.line-editbar').waitFor();
  {const [x,y]=await at(.55,.9);await page.mouse.click(x,y);}
  await page.keyboard.press('Escape');
  check('Esc는 그리던 선만 취소하고 저장된 선은 그대로',await page.evaluate(()=>!lineDraft&&S.grid.lines.length===1));
  await page.locator('[data-draw-line="control"]').click();await dialog.waitFor();await page.locator('[data-line-action="start"]').click();await page.locator('.line-editbar').waitFor();
  for(const [fx,fy] of [[.55,.92],[.95,.6]]){const [x,y]=await at(fx,fy);await page.mouse.click(x,y);}
  await page.locator('[data-draw-action="line-save"]').click();
  /* 선 정보 창: 이름·종류 바꾸기 */
  await page.locator('#consMap .map-line[data-line-id] .hit').first().dispatchEvent('click');await dialog.waitFor();
  await page.locator('#lineName').fill('1조 귀환로');await page.locator('[data-line-kind="search"]').click();await page.locator('[data-line-action="save"]').click();
  check('지도에서 선을 누르면 정보 창에서 이름·종류를 바꿈',await page.evaluate(()=>S.grid.lines.some(l=>l.name==='1조 귀환로'&&l.kind==='search')));
  /* 원 범위 */
  await page.locator('[data-draw-area="circle"]').click();await dialog.waitFor();
  await page.locator('#areaName').fill('C4 반경 수색');await page.locator('#areaBy').fill('수색견');await page.locator('[data-area-action="start"]').click();await page.locator('.line-editbar').waitFor();
  {const [x,y]=await at(.68,.55),[x2,y2]=await at(.78,.55);await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x2,y2,{steps:8});
   check('원 범위는 끄는 동안 반경을 보여 줌',(await page.locator('.line-editbar').innerText()).includes('반경'));await page.mouse.up();}
  check('원 범위를 놓으면 24점 구역 초안으로 바뀌고 저장 전에는 구역이 늘지 않음',await page.evaluate(()=>fieldEdit&&fieldEdit.points.length===24&&S.grid.regions.length===0));
  await page.locator('.field-editbar [data-field-action="region-apply"]').click();
  check('구역 저장으로 이름·담당이 있는 원 범위가 자유 구역으로 남음',await page.evaluate(()=>S.grid.regions.some(r=>r.name==='C4 반경 수색'&&r.by==='수색견'&&r.points.length===24)));
  /* 표식 놓기·끌어 옮기기 */
  await page.locator('[data-equipment-kind="team"]').click();await dialog.waitFor();await page.locator('#equipmentName').fill('지상 1조');await page.locator('[data-equipment-action="place"]').click();await page.locator('#consMap .equipment-placing').waitFor();
  {const [x,y]=await at(.3,.7);await page.mouse.click(x,y);}
  const placed=await page.evaluate(()=>S.grid.equipment.find(p=>p.kind==='team'));
  check('지상팀 표식을 지도에 놓음',placed&&placed.name==='지상 1조'&&Math.abs(placed.x-30)<2&&Math.abs(placed.y-70)<2,placed);
  check('사람 표식은 주황 원형으로 그림',await page.locator('#consMap [data-kind="team"]').evaluate(e=>e.dataset.group==='people'&&getComputedStyle(e).borderRadius==='50%'));
  const marker=page.locator('#consMap [data-kind="team"]'),mb=await marker.boundingBox();
  await page.mouse.move(mb.x+mb.width/2,mb.y+mb.height/2);await page.mouse.down();await page.mouse.move(mb.x+mb.width/2+120,mb.y+mb.height/2-60,{steps:8});await page.mouse.up();
  const moved=await page.evaluate(()=>S.grid.equipment.find(p=>p.kind==='team'));
  check('표식을 끌면 위치가 옮겨지고 정보 창은 열리지 않음',moved.x>placed.x+5&&moved.y<placed.y-3&&await dialog.count()===0,{placed,moved});
  await page.locator('#consMap [data-kind="team"]').click();
  check('끌지 않고 누르면 정보 창이 열림',await dialog.count()===1);await page.locator('dialog.field-dialog [data-field-close]').last().click();
  /* 보관·복원 */
  const exported=JSON.parse(await page.evaluate(()=>exportPayload(true)));
  check('백업에 선이 함께 들어감',exported.grid.lines.length===2);
  check('구버전처럼 선이 없거나 잘못된 선은 버리고 열림',await page.evaluate(()=>{const raw=JSON.parse(exportPayload(true));raw.grid.lines=[{id:'bad',kind:'x',points:[]},{id:'ok_line',kind:'route',name:'a',points:[{x:.1,y:.1},{x:.2,y:.2}],updatedAt:1}];return migrate(raw).grid.lines.map(l=>l.id).join();})==='ok_line');
  /* 표시 설정에서 선 숨기기 */
  await page.locator('[data-map-tools="consMap"] .map-options>summary').click();
  await page.locator('[data-map-tools="consMap"] [data-map-layer="lines"]').uncheck();
  check('표시 설정의 선 끄기로 선만 숨김',await page.locator('#consMap .map-line').count()===0&&await page.evaluate(()=>S.grid.lines.length===2));
  await page.locator('[data-map-tools="consMap"] [data-map-layer="lines"]').check();
  /* 벽 화면 */
  const popup=context.waitForEvent('page');await page.locator('#btnOpenDisplay').click();const display=await popup;
  display.on('pageerror',e=>errors.push('현황:'+e.message));
  await display.setViewportSize({width:1920,height:1080});await display.waitForFunction(()=>typeof S==='object'&&(S.grid.lines||[]).length===2);await display.waitForTimeout(1200);
  const wall=await display.evaluate(()=>{const m=document.getElementById('mapWrap').getBoundingClientRect();return {share:m.width*m.height/(innerWidth*innerHeight),lines:document.querySelectorAll('#mapWrap .map-line').length,marks:document.querySelectorAll('#mapWrap .equipment-marker').length,hit:document.querySelectorAll('#mapWrap .map-line .hit').length};});
  check('벽 화면에 선·표식이 보이고 누를 수 있는 선 영역은 없음',wall.lines===2&&wall.marks>=1&&wall.hit===0,wall);
  check('1920×1080 벽 화면 지도가 화면의 30% 이상',wall.share>=.30,wall);
  const z=await display.evaluate(()=>{const m=document.querySelector('#mapWrap .equipment-layer'),l=document.querySelector('#mapWrap .field-line-layer');return {m:+getComputedStyle(m).zIndex,l:+getComputedStyle(l).zIndex};});
  check('표식이 선 위에 그려져 이름표가 가려지지 않음',z.m>z.l,z);
  for(const [w,h] of [[1920,1080],[1366,768]]){
    await display.setViewportSize({width:w,height:h});await display.waitForTimeout(400);
    const clipped=await display.evaluate(()=>[...document.querySelectorAll('#safetyBody .sf .sv')].filter(v=>v.scrollWidth>v.clientWidth+1||v.scrollHeight>v.clientHeight+2).map(v=>v.textContent));
    check(w+'×'+h+' 안전·기상 띠 값이 잘리지 않음',clipped.length===0,clipped);
  }
  await display.screenshot({path:path.join(out,'wall-1366.png')});
  /* 보기 전용 창 */
  const viewer=await context.newPage();viewer.on('pageerror',e=>errors.push('보기:'+e.message));await viewer.goto(base);await viewer.waitForFunction(()=>typeof S==='object'&&!ownsEditorLock());
  const vc=viewer.locator('[data-onboard-action="close"]');if(await vc.isVisible())await vc.click();await viewer.locator('#tab-grid').click();
  check('보기 전용 창에서는 선·범위 그리기 단추가 꺼져 있음',await viewer.evaluate(()=>[...document.querySelectorAll('[data-draw-line],[data-draw-area]')].every(b=>b.disabled)));
  await page.screenshot({path:path.join(out,'console-map.png')});
  check('페이지 실행 오류 없음',errors.length===0,errors);
  await context.close();
}finally{await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,results},null,2));await browser.close();await new Promise(r=>server.close(r));}
assert.equal(results.filter(r=>!r.pass).length,0,'Map draw validation failed');
