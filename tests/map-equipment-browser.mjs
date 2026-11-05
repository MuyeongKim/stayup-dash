/* Equipment placement journeys use synthetic incidents and disposable Chrome.
 * The online-map contract is exercised separately with the existing SDK double;
 * no real map key, personal browser profile, or operational data is accessed.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-map-equipment';
await mkdir(out,{recursive:true});
const onlineTests=await readFile(path.join(root,'tests/online-maps.js'),'utf8');
const onlineFixture=onlineTests.slice(onlineTests.indexOf('function onlineMapInstallSdk('),onlineTests.indexOf('async function onlineMapReady('));
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{
  try{
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep))throw Error('Invalid path');
    res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/json');
    res.setHeader('Cache-Control','no-store');res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const fileMode=process.argv.includes('--file');
const url=fileMode?pathToFileURL(path.join(root,'stayup-dash.html')).href:'http://127.0.0.1:'+server.address().port+'/stayup-dash.html';
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[],errors=[],contexts=[];
const check=(name,pass,details)=>{results.push({name,pass:!!pass,details});console.log((pass?'PASS ':'FAIL ')+name);};
async function newContext(){
  const context=await browser.newContext({viewport:{width:1366,height:1000},serviceWorkers:'block',reducedMotion:'reduce'});
  contexts.push(context);
  await context.route('**/*',route=>{const u=new URL(route.request().url());return u.protocol==='file:'||u.hostname==='127.0.0.1'?route.continue():route.abort();});
  context.on('page',p=>{p.on('pageerror',e=>errors.push(e.stack||e.message));p.on('dialog',d=>d.accept());p.setDefaultTimeout(7000);});
  return context;
}
const payload=page=>page.evaluate(()=>JSON.parse(exportPayload(true)));
function businessWithoutEquipment(raw){const value=structuredClone(raw);delete value.meta;delete value.grid.equipment;return value;}
const originalBusiness=async(page,before)=>isDeepStrictEqual(businessWithoutEquipment(await payload(page)),businessWithoutEquipment(before));
const fieldDialog=page=>page.locator('dialog.field-dialog[open]');
async function clickMap(page,x,y){
  await page.locator('#consMap').scrollIntoViewIfNeeded();
  const box=await page.locator('#consMap .mapfit').boundingBox();
  assert.ok(box&&box.width>0&&box.height>0,'사진 지도 영역이 보여야 합니다.');
  await page.mouse.click(box.x+box.width*x/100,box.y+box.height*y/100);
}
async function openKind(page,kind){
  await page.locator('[data-equipment-kind="'+kind+'"]').first().click();
  await fieldDialog(page).waitFor();
}
async function preparePlace(page,kind,name,droneId,role){
  await openKind(page,kind);
  if(droneId)await fieldDialog(page).locator('#equipmentDrone').selectOption(droneId);
  if(role)await fieldDialog(page).locator('#equipmentRole').selectOption(role);
  if(name!==undefined)await fieldDialog(page).locator('#equipmentName').fill(name);
  await fieldDialog(page).locator('[data-equipment-action="place"]').click();
  await fieldDialog(page).waitFor({state:'hidden'});
}
async function openMarker(page,id){
  await page.locator('#consMap [data-equipment-id="'+id+'"]').first().click();
  await fieldDialog(page).waitFor();
}
async function openEquipmentListItem(page,id){
  const summary=page.locator('[data-equipment-summary]');
  if(!await summary.evaluate(e=>e.parentElement.open))await summary.click();
  await page.locator('[data-equipment-open="'+id+'"]').click();
  await fieldDialog(page).waitFor();
}
async function saveBackup(page,name){
  await page.locator('#tab-data').click();
  const downloading=page.waitForEvent('download');downloading.catch(()=>{});
  await page.locator('#sec-data [data-act="export"]').click();
  const download=await downloading,file=path.join(out,name+'.json');await download.saveAs(file);
  return {file,data:JSON.parse(await readFile(file,'utf8'))};
}
let page,fatal;
try{
  const context=await newContext();page=await context.newPage();
  await page.goto(url);await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  await page.evaluate(()=>{loadSample();S.weather.auto=false;S.ui.autoSave=false;commit();});
  await page.locator('#tab-grid').click();
  const image=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=1600;c.height=1000;const g=c.getContext('2d');
    g.fillStyle='#dde8ce';g.fillRect(0,0,c.width,c.height);g.strokeStyle='#95b7d1';g.lineWidth=80;g.beginPath();g.moveTo(900,0);g.lineTo(610,1000);g.stroke();
    g.fillStyle='#6e8556';g.fillRect(120,160,360,170);g.fillStyle='#fff';g.font='40px sans-serif';g.fillText('가상 수색 지도',145,265);return c.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#mapFileInput').setInputFiles({name:'synthetic-equipment-map.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await page.waitForFunction(()=>S.grid.hasMap&&mapPayloadReady());
  await page.evaluate(()=>{
    S.mission.title='가상 장비 배치 검증';S.drones[0].name='가상 드론 1호';
    S.grid.geo={north:35.94,south:35.86,west:127.18,east:127.26,src:'manual',at:Date.now()};
    S.grid.cells.C3={s:1,by:'드론'};S.grid.pinLast={x:30,y:30};S.grid.pinFound={x:70,y:65};
    S=migrate(S);commit();
  });
  await page.waitForFunction(()=>mapPayloadReady());
  const baseline=await payload(page),droneId=baseline.drones[0].id;
  check('기존 상황에서 다섯 장비 종류가 아이콘과 쉬운 이름으로 노출',await page.locator('[data-equipment-kind]').evaluateAll(nodes=>['vehicle','pump','ambulance','command','drone'].every(kind=>nodes.some(n=>n.dataset.equipmentKind===kind&&n.textContent.trim().length>0))));
  await openKind(page,'pump');
  check('펌프차 이름을 미리 제안하고 배치 전에는 기록을 바꾸지 않음',(await fieldDialog(page).locator('#equipmentName').inputValue()).trim().length>0&&isDeepStrictEqual(await payload(page),baseline));
  await fieldDialog(page).locator('#equipmentName').fill('가상 펌프 1호');
  await fieldDialog(page).locator('[data-equipment-action="place"]').click();
  await fieldDialog(page).waitFor({state:'hidden'});
  await clickMap(page,40,45);await page.waitForFunction(()=>S.grid.equipment.length===1);
  const pump=await page.evaluate(()=>JSON.parse(JSON.stringify(S.grid.equipment[0])));
  check('장비 선택 후 지도 클릭으로 수동 배치·시각 저장',pump.kind==='pump'&&pump.name==='가상 펌프 1호'&&Math.abs(pump.x-40)<1&&Math.abs(pump.y-45)<1&&pump.updatedAt>0&&pump.droneId==='');
  check('장비 배치는 기존 구역·핀·드론·안전·활동 기록을 유지',await originalBusiness(page,baseline));
  check('배치된 아이콘에 이름을 항상 표시',await page.locator('#consMap [data-equipment-id="'+pump.id+'"]').first().innerText().then(t=>t.includes('가상 펌프 1호')));
  await openMarker(page,pump.id);
  check('아이콘 상세에 수동 위치와 수정 시각을 설명',await fieldDialog(page).innerText().then(t=>t.includes('수동')&&/\d{1,2}:\d{2}/.test(t)));
  await fieldDialog(page).locator('#equipmentName').fill('가상 펌프 1호 수정');
  await fieldDialog(page).locator('[data-equipment-action="save"]').click();
  await fieldDialog(page).waitFor({state:'hidden'});
  check('장비 이름 수정은 같은 표식·위치와 기존 업무 내용을 유지',await page.evaluate(p=>S.grid.equipment.length===1&&S.grid.equipment[0].id===p.id&&S.grid.equipment[0].name==='가상 펌프 1호 수정'&&S.grid.equipment[0].x===p.x&&S.grid.equipment[0].y===p.y,pump)&&await originalBusiness(page,baseline));
  await openMarker(page,pump.id);await fieldDialog(page).locator('[data-equipment-action="move"]').click();await fieldDialog(page).waitFor({state:'hidden'});
  await clickMap(page,60,35);
  check('명시적인 위치 옮기기 후에만 배치 좌표를 변경',await page.evaluate(id=>{const p=S.grid.equipment.find(e=>e.id===id);return Math.abs(p.x-60)<1&&Math.abs(p.y-35)<1;},pump.id)&&await originalBusiness(page,baseline));
  const beforeCancel=await payload(page);
  await preparePlace(page,'vehicle','취소할 가상 차량');await page.keyboard.press('Escape');await clickMap(page,20,50);
  check('Esc로 배치를 취소하면 다음 지도 클릭에도 추가하지 않음',isDeepStrictEqual(await payload(page),beforeCancel));
  await preparePlace(page,'vehicle','가상 지원차 1호');await clickMap(page,15,80);await page.waitForFunction(()=>S.grid.equipment.length===2);
  const vehicle=await page.evaluate(()=>JSON.parse(JSON.stringify(S.grid.equipment.find(e=>e.kind==='vehicle'))));
  check('일반 차량도 이름을 붙여 원하는 위치에 배치',vehicle.name==='가상 지원차 1호'&&Math.abs(vehicle.x-15)<1&&Math.abs(vehicle.y-80)<1&&await originalBusiness(page,baseline));
  await openMarker(page,vehicle.id);await fieldDialog(page).locator('[data-equipment-action="remove"]').click();await fieldDialog(page).waitFor({state:'hidden'});
  check('일반 차량 배치 해제는 다른 장비를 유지',await page.evaluate(id=>S.grid.equipment.length===1&&S.grid.equipment[0].id===id,pump.id));

  await openKind(page,'drone');
  check('드론 배치는 기존 등록 기체 목록을 재사용',await fieldDialog(page).locator('#equipmentDrone option[value="'+droneId+'"]').count()===1);
  check('드론을 선택하기 전에는 지도 배치를 시작할 수 없음',await fieldDialog(page).locator('[data-equipment-action="place"]').isDisabled());
  check('드론 기본 위치는 조종팀·이착륙 지점으로 구분',await fieldDialog(page).locator('#equipmentRole').inputValue()==='team'&&await fieldDialog(page).innerText().then(t=>t.includes('조종')&&t.includes('보고')));
  await fieldDialog(page).locator('#equipmentDrone').selectOption(droneId);
  await fieldDialog(page).locator('[data-equipment-action="place"]').click();await fieldDialog(page).waitFor({state:'hidden'});
  await clickMap(page,20,65);await page.waitForFunction(()=>S.grid.equipment.length===2);
  let drone=await page.evaluate(()=>JSON.parse(JSON.stringify(S.grid.equipment.find(e=>e.kind==='drone'))));
  check('등록한 기체 ID와 조종팀 위치를 연결하며 기체 상태·배터리는 보존',drone.droneId===droneId&&drone.positionRole==='team'&&await originalBusiness(page,baseline));
  await openMarker(page,drone.id);await fieldDialog(page).locator('#equipmentRole').selectOption('reported');await fieldDialog(page).locator('[data-equipment-action="save"]').click();await fieldDialog(page).waitFor({state:'hidden'});
  check('기체 보고 위치로 직접 변경해도 비행 상태를 자동 변경하지 않음',await page.evaluate(id=>S.grid.equipment.find(e=>e.id===id).positionRole==='reported',drone.id)&&await originalBusiness(page,baseline));
  await preparePlace(page,'drone',undefined,droneId,'reported');await clickMap(page,35,75);
  check('같은 기체·위치를 다시 배치하면 기존 표식만 옮겨 중복 등록하지 않음',await page.evaluate(id=>{const p=S.grid.equipment.find(e=>e.kind==='drone');return S.grid.equipment.length===2&&S.grid.equipment.filter(e=>e.kind==='drone').length===1&&p.id===id&&Math.abs(p.x-35)<1&&Math.abs(p.y-75)<1;},drone.id)&&await originalBusiness(page,baseline));
  await preparePlace(page,'vehicle','같은 지점 지원차');await page.locator('#consMap [data-equipment-id="'+drone.id+'"]').first().click();
  await page.waitForFunction(()=>S.grid.equipment.length===3);
  const shared=await page.evaluate(()=>JSON.parse(JSON.stringify(S.grid.equipment.find(e=>e.name==='같은 지점 지원차'))));
  check('장비 배치 중 기존 아이콘을 누르면 그 지점에 배치하고 정보창을 열지 않음',await fieldDialog(page).count()===0&&Math.abs(shared.x-35)<1&&Math.abs(shared.y-75)<1);
  await openEquipmentListItem(page,shared.id);await fieldDialog(page).locator('[data-equipment-action="remove"]').click();await fieldDialog(page).waitFor({state:'hidden'});
  check('같은 지점에 겹친 장비도 목록에서 선택해 해당 배치만 해제',await page.evaluate(id=>S.grid.equipment.length===2&&S.grid.equipment.some(e=>e.id===id),drone.id)&&await originalBusiness(page,baseline));
  await preparePlace(page,'ambulance','가상 구급 1호');
  await page.locator('#consMap [data-cell="B2"]').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>S.grid.equipment.length===3);
  check('키보드로도 선택한 구역에 장비를 배치',await page.evaluate(()=>S.grid.equipment.some(e=>e.kind==='ambulance'&&e.name==='가상 구급 1호'&&Math.abs(e.x-25)<1&&Math.abs(e.y-30)<1)));

  // The existing independent Mercator double is sufficient to prove that a
  // locked Naver camera still accepts deliberate equipment placement. It does
  // not validate real provider authentication or real map tiles.
  if(!fileMode){
    await page.evaluate(()=>{window.W=window;});await page.addScriptTag({content:onlineFixture});
    await page.evaluate(()=>{window.equipmentSdk=onlineMapInstallSdk(false);saveOnlineKeys({naver:'synthetic-equipment-key',google:''});applyMapSource('naver','roadmap');});
    await page.waitForFunction(()=>equipmentSdk.current()&&onlineMapReady(document.getElementById('consMap')));
    await page.evaluate(()=>{const a=equipmentSdk.current().adapter,c=a.getCenter();S.grid.viewLock={lat:c.lat,lon:c.lon,zoom:a.getZoom(),source:'naver'};commit();});
    await page.waitForFunction(()=>mapPositionLock());
  }
  const lockBefore=await payload(page);
  await preparePlace(page,'command','가상 지휘 1호');await clickMap(page,80,45);await page.waitForFunction(()=>S.grid.equipment.length===4);
  check((fileMode?'사진 지도':'네이버 화면 고정')+' 상태에서도 명시적인 장비 배치는 가능',await page.evaluate(()=>S.grid.equipment.some(e=>e.kind==='command'&&e.name==='가상 지휘 1호'))&&await originalBusiness(page,lockBefore));
  if(!fileMode)await page.evaluate(()=>{S.grid.viewLock=null;applyMapSource('image','roadmap');});

  await preparePlace(page,'vehicle','가상 경계차');await clickMap(page,5,50);await page.waitForFunction(()=>S.grid.equipment.length===5);
  const edge=await page.evaluate(()=>JSON.parse(JSON.stringify(S.grid.equipment.find(e=>e.name==='가상 경계차')))),beforeZoom=await payload(page);
  const zoomIn=page.locator('[data-map-host="consMap"][data-map-action="zoom-in"]').first();
  for(let i=0;i<7;i++)await zoomIn.click();
  const edgeMarker=page.locator('#consMap [data-equipment-id="'+edge.id+'"]');
  check('지도를 네 배 이상 확대해 장비가 화면 밖이면 아이콘과 이름표를 함께 숨김',await edgeMarker.evaluate(e=>{const r=e.getBoundingClientRect(),h=e.closest('#consMap').getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return mapViewState(document.getElementById('consMap')).zoom>=4&&(x<h.left||x>h.right||y<h.top||y>h.bottom)&&getComputedStyle(e).visibility==='hidden'&&getComputedStyle(e.querySelector('.equipment-label')).visibility==='hidden';}));
  check('확대에 따른 장비 표시 변화는 위치·기록·리비전을 바꾸지 않음',isDeepStrictEqual(await payload(page),beforeZoom));
  await page.screenshot({path:path.join(out,'equipment-offscreen.png'),scale:'css'});
  await openEquipmentListItem(page,edge.id);
  check('지도 화면 밖에 있는 장비도 목록에서 배치 정보를 확인',await fieldDialog(page).locator('#equipmentName').inputValue()==='가상 경계차');
  await fieldDialog(page).locator('[data-field-close]').last().click();
  await page.locator('[data-map-host="consMap"][data-map-action="fit"]').first().click();
  check('전체 맞춤으로 돌아오면 장비 아이콘과 이름표를 다시 표시',await edgeMarker.isVisible()&&await edgeMarker.locator('.equipment-label').isVisible()&&await page.evaluate(()=>mapViewState(document.getElementById('consMap')).zoom===1));
  await openMarker(page,edge.id);await fieldDialog(page).locator('[data-equipment-action="remove"]').click();await fieldDialog(page).waitFor({state:'hidden'});

  const afterEquipment=await payload(page);
  for(const width of [1366,390,320]){
    await page.setViewportSize({width,height:width===1366?1000:844});await page.locator('#tab-grid').click();
    check(width+'px 지도·장비 선택에서 가로 넘침 없음',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.locator('#consMap').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'equipment-'+width+'.png'),scale:'css'});
  }
  await page.setViewportSize({width:1366,height:1000});
  check('화면 크기 변경·지도 보기만으로 저장 내용은 변하지 않음',isDeepStrictEqual(await payload(page),afterEquipment));

  const popup=context.waitForEvent('page');popup.catch(()=>{});await page.locator('#btnOpenDisplay').click();const display=await popup;
  await display.waitForFunction(()=>typeof S==='object'&&S.grid.equipment.length===4&&mapPayloadReady());
  check('현황 화면에도 네 장비의 이름과 배치를 함께 표시',await display.locator('#mapWrap [data-equipment-id]').count()===4&&await display.locator('#mapWrap').innerText().then(t=>t.includes('가상 펌프 1호 수정')&&t.includes('가상 지휘 1호')));
  await display.screenshot({path:path.join(out,'equipment-display.png'),scale:'css'});await display.close();

  const viewer=await context.newPage();await viewer.goto(url+'?viewer=1');await viewer.waitForFunction(()=>typeof S==='object'&&!ownsEditorLock()&&S.grid.equipment.length===4&&mapPayloadReady());await viewer.locator('#tab-grid').click();
  check('다른 직원의 보기 전용 창은 장비 추가 조작을 잠금',await viewer.locator('[data-equipment-kind]').evaluateAll(nodes=>nodes.length>=5&&nodes.every(n=>n.disabled||n.getAttribute('aria-disabled')==='true')));
  await openMarker(viewer,pump.id);
  check('보기 전용 창에서는 장비 정보를 보되 수정·이동·해제는 잠금',await fieldDialog(viewer).locator('#equipmentName').evaluate(e=>e.disabled||e.readOnly)&&await fieldDialog(viewer).locator('[data-equipment-action="save"],[data-equipment-action="move"],[data-equipment-action="remove"]').evaluateAll(nodes=>nodes.length===0||nodes.every(n=>n.disabled)));
  await viewer.keyboard.press('Escape');await viewer.close();
  check('보기 전용 확인은 소유 창의 모든 자료를 유지',isDeepStrictEqual(await payload(page),afterEquipment));

  // Begin a real rectangle draft, then verify that equipment entry cannot erase
  // it or quietly switch the meaning of the next map gesture.
  if(!await page.locator('#fieldTools').evaluate(e=>e.open))await page.locator('[data-field-action="tools"]').click();
  await page.locator('[data-field-action="rect"]').click();
  const draftBefore=await page.evaluate(()=>JSON.stringify({fieldEdit,fieldForm}));
  await page.locator('[data-equipment-kind="vehicle"]').first().click();
  check('구역 초안 작성 중 장비 배치를 거부하고 초안을 보존',await page.evaluate(v=>fieldEdit&&JSON.stringify({fieldEdit,fieldForm})===v,draftBefore)&&await fieldDialog(page).count()===0&&isDeepStrictEqual(await payload(page),afterEquipment));
  await page.keyboard.press('Escape');

  // Pure input validation checks malformed coordinates/kinds and duplicate IDs.
  // They do not bypass the UI for the successful placement journeys above.
  const invalid=await page.evaluate(()=>{
    const raw=JSON.parse(exportPayload(true)),valid={id:'ok-one',kind:'pump',name:'유효',x:10,y:20,updatedAt:1};
    const cases=[
      {id:'invalid-kind',kind:'unknown',name:'잘못된 종류',x:10,y:20},
      {id:'invalid-x',kind:'vehicle',name:'잘못된 좌표',x:Infinity,y:20},
      {id:'invalid-y',kind:'vehicle',name:'범위 밖',x:10,y:101},null,
      {id:'invalid-time',kind:'vehicle',name:'잘못된 시각',x:10,y:20,updatedAt:-1}
    ];
    const rejected=cases.map(item=>{raw.grid.equipment=[item];try{migrate(raw);return false;}catch{return true;}});
    raw.grid.equipment=[valid];const value=migrate(raw);let duplicateRejected=false;
    raw.grid.equipment=[valid,{...valid,name:'중복 식별자'}];try{migrate(raw);}catch{duplicateRejected=true;}
    return {valid:value.grid.equipment.length===1&&value.grid.equipment[0].id==='ok-one',rejected,duplicateRejected};
  });
  check('비정상 가져오기 표식은 거부하고 유효한 종류·좌표만 허용',invalid.valid&&invalid.rejected.every(Boolean));
  check('같은 식별자의 장비를 중복으로 복원하지 않음',invalid.duplicateRejected);

  const backupBefore=await payload(page),backup=await saveBackup(page,'equipment-backup');
  check('실제 다운로드한 상황 백업에 장비·기존 사진·모든 업무 값 포함',isDeepStrictEqual(backup.data,backupBefore)&&backup.data.grid.equipment.length===4&&typeof backup.data.map==='string');
  const restoreContext=await newContext(),restored=await restoreContext.newPage();await restored.goto(url);await restored.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  const importing=restored.waitForEvent('filechooser');importing.catch(()=>{});
  await restored.locator('[data-onboard-action="import"]').click();await(await importing).setFiles(backup.file);
  await restored.waitForFunction(()=>S.mission.title==='가상 장비 배치 검증'&&S.grid.equipment.length===4&&mapPayloadReady());
  const restoredPayload=await payload(restored),restoreBusiness=v=>{const c=structuredClone(v);delete c.meta;delete c.grid.mapId;delete c.grid.mapVer;return c;};
  check('새 브라우저에서 백업을 열면 장비·드론 연결·기존 기록과 사진 복원',isDeepStrictEqual(restoreBusiness(restoredPayload),restoreBusiness(backup.data)));
  await restored.locator('#tab-grid').click();check('복원한 지도에서도 장비 네 개 표시',await restored.locator('#consMap [data-equipment-id]').count()===4);
  await restored.close();await restoreContext.close();

  const practice=await context.newPage();await practice.goto(url+'?practice=1');await practice.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  check('연습 화면은 실제 상황 장비를 가져오지 않음',await practice.evaluate(()=>PRACTICE_MODE&&S.grid.equipment.length===0));
  await practice.close();check('연습 열기·닫기는 실제 장비·입력 내용 보존',isDeepStrictEqual(await payload(page),backupBefore));
  await page.locator('#tab-grid').click();await openMarker(page,pump.id);await fieldDialog(page).locator('[data-equipment-action="remove"]').click();await fieldDialog(page).waitFor({state:'hidden'});
  check('배치 해제는 선택한 표식만 제거하고 차량 외 기존 기록 유지',await page.evaluate(id=>S.grid.equipment.length===3&&!S.grid.equipment.some(e=>e.id===id),pump.id)&&await originalBusiness(page,backupBefore));
  const beforeLifecycle=await payload(page);await openKind(page,'vehicle');
  await page.evaluate(()=>stateLifecycleSeq++);
  await fieldDialog(page).locator('[data-equipment-action="place"]').click();
  check('상황 수명주기가 바뀐 이전 장비 초안은 배치를 시작하지 않음',isDeepStrictEqual(await payload(page),beforeLifecycle));
  await page.keyboard.press('Escape');await clickMap(page,80,65);
  check('오래된 장비 초안을 닫은 뒤 지도 클릭도 기존 자료 보존',isDeepStrictEqual(await payload(page),beforeLifecycle));
  check('페이지 실행 오류 없음',errors.length===0,errors);
}catch(error){
  fatal=error.stack||String(error);check('전체 장비 배치 시나리오 완료',false,fatal);
  if(page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png'),fullPage:false}).catch(()=>{});
}finally{
  await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,results,fatal},null,2));
  await browser.close();await new Promise(r=>server.close(r));
}
assert.equal(results.filter(r=>!r.pass).length,0,'Equipment map validation failed');
