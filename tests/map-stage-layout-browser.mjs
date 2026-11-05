/* Map preparation and full-screen tool panels. Synthetic data, disposable Chrome. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-ux-five-fixes-20261105/stage-layout';await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{try{const f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!f.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(f));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/stayup-dash.html';
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[],errors=[],contexts=[];
const check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name);};
async function fresh(width=1366,height=900,touch=false){
  const c=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch,serviceWorkers:'block',reducedMotion:'reduce'});contexts.push(c);
  await c.route('**/*',r=>{const u=new URL(r.request().url());return u.hostname==='127.0.0.1'?r.continue():r.abort();});
  const p=await c.newPage();p.setDefaultTimeout(7000);p.on('dialog',d=>d.accept());p.on('pageerror',e=>errors.push(e.stack));
  await p.goto(url);await p.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());await p.locator('[data-onboard-action="new"]').click();
  await p.evaluate(()=>{S.weather.auto=false;S.ui.autoSave=false;commitLight();});await p.locator('#tab-grid').click();return p;
}
const payload=p=>p.evaluate(()=>exportPayload(true));
async function photo(p){
  const png=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=750;const x=c.getContext('2d');x.fillStyle='#d6e3d5';x.fillRect(0,0,1200,750);x.strokeStyle='#8d8e7c';x.lineWidth=15;x.beginPath();x.moveTo(0,600);x.lineTo(1200,100);x.stroke();return c.toDataURL('image/png').split(',')[1];});
  await p.locator('#mapFileInput').setInputFiles({name:'가상 지도.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await p.waitForFunction(()=>S.grid.hasMap&&mapPayloadReady());
}
async function settle(p){await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function bounds(p){return p.locator('#consMap').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});}
try{
  const p=await fresh();
  check('빈 지도는 사진·온라인·저장 세 선택부터 표시',await p.locator('.map-stage-choices>button:visible').count()===3&&await p.locator('[data-map-source-choices]').evaluate(e=>e.open)&&!await p.locator('[data-position-action="open"]').isVisible());
  check('지도 준비 전에는 장비·편집 도구를 앞세우지 않음',!await p.locator('[data-equipment-tools]').isVisible()&&!await p.locator('#fieldTools').isVisible()&&!await p.locator('[data-map-tools="consMap"]').isVisible());
  const empty=await payload(p);await p.locator('[data-stage-action="online"]').click();
  check('온라인을 선택하면 네이버 위치맞추기가 해당 단계에 표시',await p.locator('[data-position-action="open"]').isVisible()&&await payload(p)===empty);
  await p.screenshot({path:path.join(out,'prepare-online-1366.png'),scale:'css'});
  await photo(p);const stored=await payload(p);
  check('사진 적용 후 현재 지도만 표시하고 선택 목록 접기',await p.locator('[data-map-stage-current]').innerText()==='사용 중: 사진 지도'&&!await p.locator('[data-map-source-choices]').evaluate(e=>e.open)&&!await p.locator('[data-position-action="open"]').isVisible());
  await p.locator('[data-stage-action="change"]').click();await p.locator('[data-stage-action="online"]').click();
  check('지도 바꾸기·온라인 선택만으로 사진·구역·기록을 바꾸지 않음',await payload(p)===stored&&await p.locator('[data-position-action="open"]').isVisible());
  await p.locator('[data-stage-action="change"]').click();
  check('선택을 접으면 현재 사진과 일반 장비 도구 유지',!await p.locator('[data-map-source-choices]').evaluate(e=>e.open)&&await p.locator('[data-equipment-tools]').isVisible()&&await payload(p)===stored);
  await p.locator('[data-map-host="consMap"][data-map-action="expand"]').click();
  check('큰 지도는 닫기·지도도구·안전상태를 표시',await p.getByRole('button',{name:'지도 도구',exact:true}).isVisible()&&await p.getByRole('button',{name:'지도 닫기',exact:true}).isVisible()&&await p.locator('.map-dialog-status').isVisible());
  const large=await bounds(p);await p.locator('[data-map-tools-toggle]').click();await settle(p);
  check('도구 열어도 큰 지도 크기와 위치 유지',JSON.stringify(await bounds(p))===JSON.stringify(large)&&await payload(p)===stored);
  await p.locator('[data-map-tools-close]').click();
  check('지도로 돌아가면 패널만 접고 도구 버튼에 초점 복귀',!await p.locator('[data-map-tools-panel]').isVisible()&&await p.locator('[data-map-tools-toggle]').evaluate(e=>e===document.activeElement));
  await p.getByRole('button',{name:'지도 닫기',exact:true}).click();
  check('큰 지도 종료 후 원래 도구와 현재 지도 복원',await p.locator('[data-equipment-tools]').isVisible()&&await p.locator('[data-map-host="consMap"][data-map-action="expand"]').isVisible()&&await payload(p)===stored);

  const m=await fresh(320,800,true);await photo(m);await m.locator('[data-theme-target="console"][data-theme-value="dark"]').click();
  check('320px 현재 지도 이름과 바꾸기 버튼이 나란히 화면 안에 보임',await m.locator('.map-stage-current').evaluate(e=>{const title=e.querySelector('strong').getBoundingClientRect(),button=e.querySelector('button').getBoundingClientRect();return title.width>90&&title.height<70&&title.right<=button.left+1&&button.right<=innerWidth&&button.height>=44;}));
  const mobileStored=await payload(m);await m.locator('[data-map-host="consMap"][data-map-action="expand"]').tap();await settle(m);
  const first=await bounds(m);
  check('320px 큰 지도의 실제 지도 높이는 화면 절반 이상',first.height>=400,first);
  check('320px에서 닫기와 지도 도구가 잘리지 않음',await m.locator('.map-dialog-head').evaluate(e=>[...e.querySelectorAll('button')].every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height>=44;})));
  await m.screenshot({path:path.join(out,'large-320-dark.png'),scale:'css'});
  await m.locator('[data-map-tools-toggle]').tap();await settle(m);const withTools=await bounds(m),panel=await m.locator('[data-map-tools-panel]').boundingBox();
  check('320px 도구는35vh 이내 내부스크롤이며 지도영역을 밀지 않음',panel.height<=282&&JSON.stringify(first)===JSON.stringify(withTools),{map:first,panel});
  check('편집은 도구 안에, 최소 보기 조작은 지도 곁에 유지',await m.locator('[data-map-tools-panel] [data-equipment-tools]').count()===1&&await m.locator('[data-map-tools-panel] #fieldTools').count()===1&&await m.locator('[data-map-view-controls] [data-map-action="zoom-in"]').isVisible());
  await m.screenshot({path:path.join(out,'tools-320-dark.png'),scale:'css'});
  await m.locator('[data-map-tools-panel] [data-equipment-tools]>summary').tap();await m.locator('[data-equipment-kind="pump"]').tap();await m.locator('#equipmentName').fill('가상 펌프 1');await m.locator('[data-equipment-action="place"]').tap();
  check('장비 위치 선택 단계에서는 도구 패널이 접혀 지도 노출',!await m.locator('[data-map-tools-panel]').isVisible()&&await m.locator('.equipment-placing').isVisible());
  await m.locator('#consMap [data-cell="B2"]').tap();await settle(m);
  check('넓어진 지도에서 실제 터치 배치 후 계속 지도 유지',await m.evaluate(()=>S.grid.equipment.length===1)&&await m.locator('dialog.field-dialog[open]').count()===0&&await m.locator('.map-dialog').isVisible());
  const viewBefore=await m.evaluate(()=>JSON.stringify(mapViewState($('consMap')))),beforeZoom=await payload(m),fitBefore=await m.locator('#consMap .mapfit').boundingBox();
  await m.locator('[data-map-view-controls] [data-map-action="zoom-in"]').tap();await settle(m);const fitAfter=await m.locator('#consMap .mapfit').boundingBox();
  check('320px에서 도구를 열지 않고 사진과 표식을 실제 확대할 수 있음',fitAfter.width>fitBefore.width&&await m.evaluate(old=>JSON.stringify(mapViewState($('consMap')))!==old,viewBefore)&&await payload(m)===beforeZoom,{before:fitBefore,after:fitAfter});
  await m.locator('[data-map-view-controls] [data-map-action="fit"]').tap();await settle(m);
  check('전체 맞춤은 보기만 되돌리고 장비·기록을 유지',await payload(m)===beforeZoom&&await m.evaluate(()=>mapViewState($('consMap')).zoom===1));
  const placed=await payload(m);await m.locator('[data-map-tools-toggle]').tap();await m.keyboard.press('Escape');
  check('첫 Esc는 도구만 접고 큰 지도와 자료 유지',!await m.locator('[data-map-tools-panel]').isVisible()&&await m.locator('.map-dialog').isVisible()&&await payload(m)===placed);
  await m.keyboard.press('Escape');check('두번째 Esc는 큰 지도만 닫고 배치 보존',await m.locator('.map-dialog').count()===0&&await payload(m)===placed);
  for(const [width,height] of [[390,844],[390,400],[1366,900]]){
    await m.setViewportSize({width,height});await m.locator('[data-map-host="consMap"][data-map-action="expand"]').tap();await settle(m);const box=await bounds(m);
    check(width+'×'+height+' 큰 지도에서 지도·닫기 접근 및 가로 넘침 없음',box.height>=Math.min(400,height*.5)&&await m.getByRole('button',{name:'지도 닫기',exact:true}).isVisible()&&await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),box);
    await m.screenshot({path:path.join(out,'large-'+width+'x'+height+'.png'),scale:'css'});await m.getByRole('button',{name:'지도 닫기',exact:true}).tap();
  }
  check('크기·테마·도구 왕복이 기체·구역·기록·배치 값을 바꾸지 않음',await payload(m)===placed);
  await m.locator('[data-map-host="consMap"][data-map-action="expand"]').tap();await m.locator('[data-map-tools-toggle]').tap();await m.evaluate(()=>{S.safety.manned=true;commit();});
  check('도구를 열어도 기존 유인기 긴급 경보가 도구 밖에 보임',await m.locator('.map-dialog-alert').isVisible()&&await m.locator('.map-dialog-alert').innerText().then(t=>t.includes('유인기 진입')));
  check('실행 중 JavaScript 오류 없음',errors.length===0,errors);
}catch(e){check('전체 시나리오 완료',false,e.stack);}finally{await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(x=>x.pass).length,total:results.length,results,errors},null,2));await browser.close();await new Promise(r=>server.close(r));}
assert.equal(results.filter(x=>!x.pass).length,0,JSON.stringify(results.filter(x=>!x.pass)));
