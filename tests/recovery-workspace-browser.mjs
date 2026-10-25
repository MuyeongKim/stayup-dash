/* Restore/import real-mode and practice-mode synthetic photos in one profile.
 * All browser storage and files belong to this disposable test workflow.
 */
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-recovery-workspace';await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=process.argv.includes('--file')?pathToFileURL(path.join(root,'stayup-dash.html')).href:'http://127.0.0.1:'+server.address().port+'/stayup-dash.html';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1366,height:900},deviceScaleFactor:3,serviceWorkers:'block',reducedMotion:'reduce'});
const results=[],errors=[],dialogs=[],cancelNext=new Set();
const check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name);};
function observe(page,mode){page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push({mode,type:d.type(),message:d.message()});if(d.type()==='confirm'&&cancelNext.has(page)){cancelNext.delete(page);await d.dismiss();}else if(d.type()==='prompt')await d.dismiss();else await d.accept();});}
const payload=page=>page.evaluate(()=>exportPayload(true));
function content(raw){const value=JSON.parse(raw);delete value.meta;delete value.appVersion;delete value.grid.mapId;delete value.grid.mapVer;return value;}
async function sameContent(page,raw){return isDeepStrictEqual(content(await payload(page)),content(raw));}
async function data(page){await page.locator('#tab-data').click();}
async function title(page,value){await page.locator('#tab-mission').click();await page.locator('[data-path="mission.title"]').fill(value);await data(page);}
async function reset(page){await data(page);await page.locator('[data-act="reset"]').click();await page.waitForFunction(()=>!S.mission.title&&!S.grid.hasMap);}
async function choice(page,name,reason){return page.locator('#recoveryPick option').evaluateAll((nodes,{name,reason})=>{const o=nodes.find(n=>n.textContent.includes(name)&&n.textContent.includes(reason));return o?{value:o.value,label:o.textContent}:null;},{name,reason});}
async function restore(page,name,reason){await data(page);const c=await choice(page,name,reason);assert.ok(c,'Missing visible recovery choice');await page.locator('#recoveryPick').selectOption(c.value);await page.locator('[data-act="recover"]').click();await page.waitForFunction(name=>S.mission.title===name&&mapPayloadReady(),name);return c;}
async function prepare(page,practice,name,color,cell){
  observe(page,practice?'practice':'live');await page.goto(base+(practice?'?practice=1':''));await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  if(await page.locator('#onboardingGuide').isVisible())await page.locator('[data-onboard-action="close"]').click();
  if(practice)await reset(page);
  await page.evaluate(()=>{S.weather.auto=false;commitLight();});
  await title(page,name);if(!practice&&await page.locator('[data-path="ui.autoSave"]').isChecked())await page.locator('[data-path="ui.autoSave"]').uncheck();
  await page.locator('#tab-crew').click();await page.locator('#btnAddCrew').click();await page.locator('[data-path="crew.0.name"]').fill(name+' 조종');
  await page.locator('#tab-drone').click();await page.locator('#btnAddDrone').click();await page.locator('[data-pilot-target="drones.0.pilot"]').selectOption(name+' 조종');
  await page.locator('#tab-grid').click();
  const png=await page.evaluate(color=>{const c=document.createElement('canvas');c.width=1000;c.height=600;c.getContext('2d').fillStyle=color;c.getContext('2d').fillRect(0,0,1000,600);return c.toDataURL('image/png').split(',')[1];},color);
  await page.locator('#mapFileInput').setInputFiles({name:'가상-'+(practice?'연습':'실제')+'-사진.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await page.waitForFunction(()=>S.grid.hasMap&&mapPayloadReady());
  await page.locator('[data-act="pin"][data-p="last"]').click();await page.locator('#consMap [data-cell="'+cell+'"]').press('Enter');await data(page);
}
async function exportFile(page,name){const ready=page.waitForEvent('download',d=>!d.suggestedFilename().includes('자동보관'));await page.locator('[data-act="export"]').click();const file=await ready;const destination=path.join(out,name+'.json');await file.saveAs(destination);return {path:destination,name:file.suggestedFilename(),data:JSON.parse(await readFile(destination,'utf8'))};}
async function importFile(page,file,name){await data(page);await page.locator('#importFile').setInputFiles(file);await page.waitForFunction(name=>S.mission.title===name&&mapPayloadReady(),name);}
async function display(page){const ready=page.waitForEvent('popup');await page.locator('#btnOpenDisplay').click();const view=await ready;await view.waitForFunction(()=>typeof S==='object'&&S.grid.hasMap&&mapPayloadReady());return view;}
try{
  const live=await context.newPage(),practice=await context.newPage();
  await prepare(live,false,'가상 실제 A','#b9d8ee','B2');await prepare(practice,true,'가상 연습 B','#efd4bb','C3');
  const liveOriginal=await payload(live),practiceOriginal=await payload(practice);
  check('실제·연습의 사진·핀·인원·기체를 서로 다른 가상 자료로 준비',await live.evaluate(()=>PRACTICE_MODE===false&&S.crew[0].name==='가상 실제 A 조종')&&await practice.evaluate(()=>PRACTICE_MODE===true&&S.crew[0].name==='가상 연습 B 조종')&&JSON.parse(liveOriginal).map!==JSON.parse(practiceOriginal).map);
  await live.evaluate(()=>{if(!createSnapshot('가상 자동 기준 A'))throw Error('snapshot failed');});
  const liveFile=await exportFile(live,'live-backup'),practiceFile=await exportFile(practice,'practice-backup');
  check('JSON 백업의 사진·기록을 포함하고 실제·연습 파일명 구분',!liveFile.name.startsWith('연습-')&&practiceFile.name.startsWith('연습-')&&liveFile.data.mission.title==='가상 실제 A'&&practiceFile.data.mission.title==='가상 연습 B'&&!!liveFile.data.map&&!!practiceFile.data.map);
  const liveView=await display(live),practiceView=await display(practice);observe(liveView,'live-view');observe(practiceView,'practice-view');
  await liveView.waitForFunction(()=>S.mission.title==='가상 실제 A'&&S.grid.hasMap&&mapPayloadReady());await practiceView.waitForFunction(()=>S.mission.title==='가상 연습 B'&&S.grid.hasMap&&mapPayloadReady());
  const displayDetails={liveTitle:await liveView.locator('#hMission').innerText(),practiceTitle:await practiceView.locator('#hMission').innerText(),liveImage:await liveView.evaluate(()=>MAPDATA)===liveFile.data.map,practiceImage:await practiceView.evaluate(()=>MAPDATA)===practiceFile.data.map};
  check('두 표출 창도 각 공간의 상황·사진과 연습 표식을 표시',displayDetails.liveTitle==='가상 실제 A'&&displayDetails.practiceTitle==='[연습] 가상 연습 B'&&displayDetails.liveImage&&displayDetails.practiceImage,displayDetails);
  await title(live,'가상 실제 A 수정본');await reset(live);
  check('초기화 안내는 현재 상황을 비우고 복구본을 유지함을 명시',dialogs.some(d=>d.mode==='live'&&d.type==='confirm'&&d.message.includes('빈 상태')&&d.message.includes('복구본'))&&await live.locator('[data-reset-help]').innerText().then(t=>t.includes('복구본을 유지')&&t.includes('사진·지도·복구본까지 삭제')));
  await liveView.waitForFunction(()=>!S.mission.title);
  check('실제 초기화는 연습 원본·사진·표출을 바꾸지 않음',await payload(practice)===practiceOriginal&&await practiceView.evaluate(()=>S.mission.title==='가상 연습 B'&&mapPayloadReady()));
  const automatic=await choice(live,'가상 실제 A','가상 자동 기준 A'),manual=await choice(live,'가상 실제 A 수정본','전체 초기화 전');
  check('복구 목록에 과거 자동본과 직전 작업본의 상황명·사유를 구분',!!automatic&&!!manual&&automatic.value!==manual.value&&automatic.label.includes('자동'));
  await restore(live,'가상 실제 A','가상 자동 기준 A');
  check('직전 수정본 대신 선택한 과거 자동본의 모든 내용·사진·핀을 복원',await sameContent(live,liveOriginal));
  check('복구 완료 문구가 선택 적용과 상황·지도·기록 확인을 안내',dialogs.some(d=>d.mode==='live'&&d.type==='alert'&&d.message.includes('선택한 복구본을 적용')&&d.message.includes('상황·지도·최근 기록')));
  await liveView.waitForFunction(()=>S.mission.title==='가상 실제 A'&&mapPayloadReady());
  check('복구된 사진의 새 저장 참조와 두 공간의 사진 DB 원본을 확인',await live.evaluate(async()=>await mapBlobGet(S.grid.mapId)===MAPDATA)&&await practice.evaluate(async()=>await mapBlobGet(S.grid.mapId)===MAPDATA)&&await payload(practice)===practiceOriginal);
  await title(live,'가상 실제 A 파일 복원 전');await importFile(live,liveFile.path,'가상 실제 A');
  check('실제 JSON 파일 불러오기는 내용·사진·핀을 복원하고 연습 자료 유지',await sameContent(live,liveOriginal)&&await payload(practice)===practiceOriginal);
  const liveRestored=await payload(live);
  await title(practice,'가상 연습 B 파일 복원 전');await importFile(practice,practiceFile.path,'가상 연습 B');
  check('연습 JSON 파일 불러오기도 내용·사진·핀을 복원하고 실제 자료 유지',await sameContent(practice,practiceOriginal)&&await payload(live)===liveRestored);
  await reset(practice);await practiceView.waitForFunction(()=>!S.mission.title);
  check('연습 초기화는 실제 상황·사진·표출을 유지',await payload(live)===liveRestored&&await liveView.evaluate(()=>S.mission.title==='가상 실제 A'&&mapPayloadReady()));
  const names=await practice.locator('#recoveryPick').innerText();
  check('연습 복구 목록에 실제 상황의 복구본을 섞지 않음',names.includes('가상 연습 B')&&!names.includes('가상 실제 A'));
  await restore(practice,'가상 연습 B','전체 초기화 전');
  check('연습의 작업 전 복구는 연습 사진·인원·기체만 복원',await sameContent(practice,practiceOriginal)&&await payload(live)===liveRestored);
  await practiceView.waitForFunction(()=>S.mission.title==='가상 연습 B'&&mapPayloadReady());
  check('복구와 파일 불러오기 후 두 표출의 사진·핀 분리 유지',await liveView.evaluate(()=>MAPDATA)===liveFile.data.map&&await practiceView.evaluate(()=>MAPDATA)===practiceFile.data.map&&isDeepStrictEqual(await liveView.evaluate(()=>S.grid.pinLast),liveFile.data.grid.pinLast)&&isDeepStrictEqual(await practiceView.evaluate(()=>S.grid.pinLast),practiceFile.data.grid.pinLast));
  const beforeCancel=await payload(live);cancelNext.add(live);await live.locator('[data-act="recover"]').click();
  check('복구 확인 취소는 현재 자료·사진과 다른 공간을 유지',await payload(live)===beforeCancel&&await sameContent(practice,practiceOriginal));
  const longTitle='가상 긴 수색 상황명 '.repeat(8).slice(0,80);await title(live,longTitle);await live.evaluate(()=>{if(!createSnapshot('가상 긴 이름 기준'))throw Error('snapshot failed');});await importFile(live,liveFile.path,'가상 실제 A');
  const longChoice=await choice(live,longTitle,'가상 긴 이름 기준');check('긴 상황명도 복구 목록에서 상황·시각·사유 정보로 보존',!!longChoice);
  for(const [w,h,theme] of [[390,844,'light'],[320,800,'dark']]){
    await live.setViewportSize({width:w,height:h});await live.locator('[data-theme-target="console"][data-theme-value="'+theme+'"]').click();await live.locator('#recoveryPick').selectOption(longChoice.value);await live.locator('#recoveryPick').scrollIntoViewIfNeeded();
    const box=await live.locator('#recoveryPick').boundingBox();check(w+'px·'+theme+'에서 긴 복구 선택과 구분 설명이 가로 넘침 없이 보임',box.x>=0&&box.x+box.width<=w&&await live.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)&&await live.locator('[data-reset-help]').isVisible());
    if(w===390){await live.locator('#recoveryPick').selectOption(automatic.value);await live.evaluate(()=>{const pick=document.querySelector('#recoveryPick'),bar=document.querySelector('.console-workspace-bar');window.scrollBy(0,pick.getBoundingClientRect().top-bar.getBoundingClientRect().bottom-12);});const p=await live.locator('#recoveryPick').boundingBox(),end=await live.locator('[data-reset-help]').boundingBox();await live.screenshot({path:path.join(out,'recovery-choice-preview.png'),clip:{x:p.x-2,y:p.y-2,width:p.width+4,height:end.y+end.height-p.y+4},scale:'device'});}
    await live.screenshot({path:path.join(out,'recovery-'+w+'.png'),scale:'css'});
  }
  check('보기·선택 조작도 두 공간의 운영 내용과 편집권을 보존',await sameContent(live,liveOriginal)&&await sameContent(practice,practiceOriginal)&&await live.evaluate(()=>ownsEditorLock())&&await practice.evaluate(()=>ownsEditorLock()));
  check('페이지 실행 오류 없음',errors.length===0,errors);
}finally{await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,dialogs,results},null,2));await browser.close();await new Promise(r=>server.close(r));}
assert.equal(results.filter(r=>!r.pass).length,0,'Recovery-workspace validation failed');
