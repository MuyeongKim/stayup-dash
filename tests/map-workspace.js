/* Map regressions cover coordinates and unintended edits in the real browser.
   Pointer events use rendered image positions, not precomputed state mutations. */
'use strict';

async function runMapWorkspace(){
  await mapWorkspaceGeometry();
  await mapWorkspaceGestures();
  await mapWorkspaceEdges();
  await mapWorkspaceControls();
  await mapWorkspaceAlerts();
  await mapWorkspaceLegacy();
}

function workspaceHost(){return W.document.getElementById('consMap');}
function workspacePoint(x,y){
  var rect=workspaceHost().querySelector('.mapfit').getBoundingClientRect(),host=workspaceHost().getBoundingClientRect();
  return {x:rect.left+rect.width*x/100,y:rect.top+rect.height*y/100,hx:host.left,hy:host.top};
}
function workspacePointer(type,point,id,kind){
  /* 좌표 검산은 순수하게 유지하고, 조작할 때만 지도를 화면 안으로 옮긴다. */
  var root=W.document.getElementById('consoleRoot');
  if(type==='pointerdown'&&root.contains(workspaceHost()))W.scrollToSection(root,workspaceHost());
  var rect=workspaceHost().getBoundingClientRect(),x=point.x,y=point.y;
  if(typeof point.hx==='number'){x+=rect.left-point.hx;y+=rect.top-point.hy;}
  workspaceHost().dispatchEvent(new W.PointerEvent(type,{bubbles:true,cancelable:true,
    pointerId:id||51,pointerType:kind||'mouse',isPrimary:!id||id===51,button:0,
    buttons:type==='pointerup'||type==='pointercancel'?0:1,clientX:x,clientY:y}));
}
function workspaceTap(point){
  workspacePointer('pointerdown',point);workspacePointer('pointerup',point);
}
function workspaceSignature(){return JSON.stringify({cells:W.S.grid.cells,pinLast:W.S.grid.pinLast,
  pinFound:W.S.grid.pinFound,ref1:W.S.grid.ref1,ref2:W.S.grid.ref2,geo:W.S.grid.geo,events:W.S.events});}
function workspaceNear(a,b,tolerance){return Math.abs(a-b)<(tolerance||0.15);}
async function workspaceSetup(width,height){
  await reload();W.loadSample();await wait(100);
  await loadMap(width||1600,height||900,'#17445a');
  gotoSection('sec-grid');await wait(100);
}

async function mapWorkspaceGeometry(){
  await workspaceSetup();group('지도 작업공간 · 확대와 원본 좌표 일치');
  W.S.grid.pinFound={x:45,y:45};W.commit();
  var host=workspaceHost(),before=workspaceSignature(),revision=W.S.meta.revision;
  W.setMapView(host,{zoom:2,x:20,y:10});
  var fit=host.querySelector('.mapfit').getBoundingClientRect();
  var image=host.querySelector('.mapimg').getBoundingClientRect();
  var layers=host.querySelector('.gridlayer').getBoundingClientRect();
  ok('확대·이동한 사진과 격자는 같은 사각형을 차지한다',
    workspaceNear(fit.left,image.left)&&workspaceNear(fit.top,image.top)
    &&workspaceNear(fit.width,image.width)&&workspaceNear(fit.height,image.height)
    &&workspaceNear(fit.left,layers.left)&&workspaceNear(fit.width,layers.width));
  var pin=host.querySelector('.pin.found').getBoundingClientRect();
  ok('기존 발견 핀은 확대·이동한 사진의 같은 지형 좌표를 가리킨다',
    workspaceNear(pin.left,image.left+image.width*0.45)
    &&workspaceNear(pin.top,image.top+image.height*0.45));
  var visible=workspacePoint(45,45),inverse=W.getMapPoint(host,visible.x,visible.y);
  ok('확대 화면의 지점을 원본 이미지 좌표로 역변환한다',
    inverse&&workspaceNear(inverse.x,45)&&workspaceNear(inverse.y,45));
  ok('지도 보기 배율·이동은 저장된 핀·수색 기록을 변경하지 않는다',
    workspaceSignature()===before&&W.S.meta.revision===revision);
  W.setPinMode('last');workspaceTap(workspacePoint(55,55));await wait(80);
  ok('200% 확대 상태에서 놓은 핀은 원본 이미지 위치로 저장한다',
    W.S.grid.pinLast&&workspaceNear(W.S.grid.pinLast.x,55)&&workspaceNear(W.S.grid.pinLast.y,55));
  W.resetMapView(workspaceHost());
  var atFit=workspacePoint(55,55),fitPoint=W.getMapPoint(workspaceHost(),atFit.x,atFit.y);
  ok('전체 맞춤 후에도 같은 지형을 가리키는 핀 좌표를 보존한다',
    W.S.grid.pinLast&&fitPoint&&workspaceNear(fitPoint.x,W.S.grid.pinLast.x)
    &&workspaceNear(fitPoint.y,W.S.grid.pinLast.y));

  W.setMapView(workspaceHost(),{zoom:2,x:0,y:0});
  W.setPinMode('ref1');workspaceTap(workspacePoint(40,40));await wait(40);
  W.setPinMode('ref2');workspaceTap(workspacePoint(60,60));await wait(40);
  ok('확대한 화면에서 선택한 두 기준점도 원본 좌표로 저장한다',
    W.S.grid.ref1&&W.S.grid.ref2&&workspaceNear(W.S.grid.ref1.x,40)
    &&workspaceNear(W.S.grid.ref1.y,40)&&workspaceNear(W.S.grid.ref2.x,60)
    &&workspaceNear(W.S.grid.ref2.y,60));
  W.S.grid.ref1.lat=35.900;W.S.grid.ref1.lon=127.200;
  W.S.grid.ref2.lat=35.890;W.S.grid.ref2.lon=127.220;
  W.document.querySelector('[data-act="geoapply"]').click();await wait(80);
  var coordinate=W.geoAt(0.55,0.55);
  ok('확대 중 2점 보정 후 핀 위경도가 손계산과 일치한다',
    coordinate&&workspaceNear(coordinate.lat,35.8925,0.000001)
    &&workspaceNear(coordinate.lon,127.215,0.000001));
  W.setMapView(workspaceHost(),{zoom:3,x:15,y:-10});
  var afterZoom=W.geoAt(W.S.grid.pinLast.x/100,W.S.grid.pinLast.y/100);
  ok('보정 후에도 확대·이동할 수 있고 핀의 위경도는 바뀌지 않는다',
    W.mapViewState(workspaceHost()).zoom===3&&afterZoom
    &&workspaceNear(afterZoom.lat,coordinate.lat,0.000001)
    &&workspaceNear(afterZoom.lon,coordinate.lon,0.000001));
  W.renderConsole(W.document.getElementById('consoleRoot'));
  ok('다른 입력으로 조작 패널을 다시 그려도 지도 배율을 유지한다',
    W.mapViewState(workspaceHost()).zoom===3);
}

async function mapWorkspaceGestures(){
  await workspaceSetup();group('지도 작업공간 · 보기와 편집의 분리');
  ok('새 지도는 보기·이동 모드로 시작한다',W.mapEditMode==='view'&&!W.pinMode);
  var before=workspaceSignature();
  var first=workspacePoint(40,40),last=workspacePoint(60,60);
  workspacePointer('pointerdown',first,51,'touch');workspacePointer('pointermove',last,51,'touch');
  workspacePointer('pointerup',last,51,'touch');
  ok('보기 모드의 터치 쓸기는 수색칸·핀·이력을 변경하지 않는다',workspaceSignature()===before);
  var cell=workspaceHost().querySelector('[data-cell="B2"]');cell.click();
  ok('보기 모드의 키보드 칸 선택도 수색 상태를 바꾸지 않는다',workspaceSignature()===before);

  W.resetMapView(workspaceHost());W.setMapEditMode('paint');
  W.S.ui.paintS=2;W.S.ui.paintBy='지상';
  var p1=workspacePoint(75,30),p2=workspacePoint(92,50);
  workspacePointer('pointerdown',p1,51,'touch');workspacePointer('pointermove',p2,51,'touch');
  ok('칠하기 도중의 임시 표시를 완료 전 저장 상태에 반영하지 않는다',workspaceSignature()===before);
  workspacePointer('pointercancel',p2,51,'touch');await wait(60);
  ok('브라우저가 터치를 취소하면 칠하기와 완료 이벤트를 함께 취소한다',
    workspaceSignature()===before&&!W.painting&&Array.prototype.every.call(workspaceHost().querySelectorAll('.gcell'),function(el){
      return el.classList.contains('s'+((W.S.grid.cells[el.dataset.cell]||{}).s||0));
    }));
  workspacePointer('pointerdown',p1,51,'touch');workspacePointer('pointermove',p2,51,'touch');
  workspacePointer('pointerdown',p2,52,'touch');
  workspacePointer('pointerup',p2,52,'touch');workspacePointer('pointerup',p2,51,'touch');
  ok('칠하기 중 두 번째 손가락이 들어오면 실수로 완료 기록을 남기지 않는다',workspaceSignature()===before);

  workspacePointer('pointerdown',p1);workspacePointer('pointermove',p2);
  W.S.mission.title='다른 입력 중 화면 갱신';W.commit();
  workspacePointer('pointerup',p2);
  ok('칠하기 도중 다른 입력이 화면을 갱신하면 임시 칠하기를 저장하지 않는다',
    workspaceSignature()===before&&!W.painting);

  W.setMapEditMode('paint');var n=W.S.events.length;
  workspacePointer('pointerdown',p1);workspacePointer('pointermove',p2);workspacePointer('pointerup',p2);
  ok('명시적 칠하기 모드에서 끝낸 한 번의 쓸기만 한 줄로 기록한다',
    W.S.events.length===n+1&&W.S.events[n].type==='zone');
  W.undoSweep();
  ok('새 칠하기 경로에서도 직전 쓸기 되돌리기가 원래 칸 상태를 복원한다',
    JSON.stringify(W.S.grid.cells)===JSON.stringify(JSON.parse(before).cells));

  W.setMapEditMode('view');W.setMapView(workspaceHost(),{zoom:2,x:0,y:0});
  W.releaseEditorLock();W.buildGrid(workspaceHost(),false);
  before=workspaceSignature();var viewBefore=JSON.stringify(W.mapViewState(workspaceHost()));
  p1=workspacePoint(50,50);p2={x:p1.x+40,y:p1.y+20};
  workspacePointer('pointerdown',p1);workspacePointer('pointermove',p2);workspacePointer('pointerup',p2);
  ok('편집권 없는 지도도 이동해서 볼 수 있고 기록은 변경하지 않는다',
    !W.ownsEditorLock()&&JSON.stringify(W.mapViewState(workspaceHost()))!==viewBefore
    &&workspaceSignature()===before);
  W.acquireEditorLock();
}

async function mapWorkspaceEdges(){
  await workspaceSetup(2000,250);group('지도 작업공간 · 여백과 가장자리');
  W.setPinMode('found');
  var host=workspaceHost(),rect=host.getBoundingClientRect(),fit=host.querySelector('.mapfit').getBoundingClientRect();
  var gap={x:rect.left+rect.width/2,y:(rect.top+fit.top)/2},before=workspaceSignature();
  workspaceTap(gap);
  ok('파노라마 사진 위쪽 빈 여백 클릭은 핀으로 저장하지 않는다',
    fit.top>rect.top+5&&W.getMapPoint(host,gap.x,gap.y)===null&&workspaceSignature()===before&&W.pinMode==='found');
  var invalid=W.placeMapPoint(-1,50);
  ok('사진 경계 밖 좌표를 가장자리 값으로 억지 보정해 저장하지 않는다',
    invalid===false&&workspaceSignature()===before);
  W.setPinMode('found');workspaceTap(workspacePoint(1,1));await wait(80);
  var label=workspaceHost().querySelector('.pin.found .plb');
  var labelRect=label&&label.getBoundingClientRect(),hostRect=workspaceHost().getBoundingClientRect();
  ok('사진 가장자리에서 놓은 핀의 설명은 지도 작업공간 안에서 보인다',
    W.S.grid.pinFound&&workspaceNear(W.S.grid.pinFound.x,1)&&labelRect
    &&W.getComputedStyle(label).visibility!=='hidden'
    &&labelRect.left>=hostRect.left-1&&labelRect.right<=hostRect.right+1
    &&labelRect.top>=hostRect.top-1&&labelRect.bottom<=hostRect.bottom+1);
  W.setPinMode('found');workspaceTap(workspacePoint(99,99));await wait(60);
  label=workspaceHost().querySelector('.pin.found .plb');labelRect=label.getBoundingClientRect();
  ok('오른쪽 아래 가장자리에서도 핀 설명이 잘리지 않는다',
    workspaceNear(W.S.grid.pinFound.x,99)&&W.getComputedStyle(label).visibility!=='hidden'&&labelRect.right<=hostRect.right+1
    &&labelRect.bottom<=hostRect.bottom+1);
}

async function mapWorkspaceControls(){
  await workspaceSetup();group('지도 작업공간 · 크게 보기와 표시 설정');
  var button=W.document.querySelector('[data-map-action="expand"][data-map-host="consMap"]');
  var before=workspaceSignature();
  W.setMapView(workspaceHost(),{zoom:2,x:10,y:10});
  button.focus();button.click();await wait(80);
  var dialog=W.document.querySelector('.map-dialog'),largeRect=workspaceHost().getBoundingClientRect();
  ok('지도 크게 보기는 같은 지도를 대화상자에서 넓게 연다',
    W.mapExpandedTarget==='consMap'&&dialog&&dialog.open&&dialog.contains(workspaceHost())
    &&largeRect.width>W.innerWidth*0.75&&largeRect.height>W.innerHeight*0.5);
  ok('크게 보기를 열어도 기존 지도 배율과 수색 데이터는 유지된다',
    W.mapViewState(workspaceHost()).zoom===2&&workspaceSignature()===before);
  W.setPinMode('found');workspaceTap(workspacePoint(50,50));await wait(80);
  dialog=W.document.querySelector('.map-dialog');before=workspaceSignature();
  ok('크게 보기 안에서 핀을 저장한 뒤에도 열린 지도와 배율을 유지한다',
    W.S.grid.pinFound&&workspaceNear(W.S.grid.pinFound.x,50)&&dialog&&dialog.open
    &&dialog.contains(workspaceHost())&&W.mapViewState(workspaceHost()).zoom===2);
  W.closeMapWorkspace();await wait(60);
  var active=W.document.activeElement;
  ok('크게 보기를 닫으면 원래 확대 버튼에 포커스를 돌려준다',
    !dialog.open&&!W.mapExpandedTarget&&active&&active.getAttribute('data-map-action')==='expand'
    &&active.getAttribute('data-map-host')==='consMap');

  var controls=W.document.querySelectorAll('#consMapWorkspace [data-map-layer]');
  Array.prototype.forEach.call(controls,function(control){
    if(control.type==='checkbox')control.checked=!control.checked;else control.value='20';
    control.dispatchEvent(new W.Event('input',{bubbles:true}));
    control.dispatchEvent(new W.Event('change',{bubbles:true}));
  });
  ok('격자·담당·반경·채움 표시 설정은 실제 수색 상태와 이력을 바꾸지 않는다',
    controls.length>=4&&workspaceSignature()===before);
  W.setPinMode('found');
  ok('격자를 숨긴 뒤 핀을 배치할 때 키보드로 고를 격자를 다시 표시한다',
    !workspaceHost().querySelector('.mapfit').classList.contains('hide-grid'));
  W.setPinMode(null);
  var oldZoom=W.mapViewState(workspaceHost()).zoom;
  W.document.querySelector('[data-map-action="zoom-in"][data-map-host="consMap"]').click();
  ok('지도 툴바 확대 버튼은 지도 배율만 변경한다',
    W.mapViewState(workspaceHost()).zoom>oldZoom&&workspaceSignature()===before);
  W.document.querySelector('[data-map-action="fit"][data-map-host="consMap"]').click();
  ok('전체 맞춤 버튼은 지도 이동과 확대를 초기화하고 수색 데이터는 보존한다',
    W.mapViewState(workspaceHost()).zoom===1&&W.mapViewState(workspaceHost()).x===0
    &&W.mapViewState(workspaceHost()).y===0&&workspaceSignature()===before);
}

async function mapWorkspaceLegacy(){
  await workspaceSetup();group('지도 작업공간 · 구버전 위치 재확인');
  var legacy=W.JSON.parse(JSON.stringify(W.S));
  delete legacy.grid.viewportVersion;legacy.grid.mapZoom=200;legacy.grid.mapX=25;legacy.grid.mapY=-10;
  legacy.grid.geo=null;legacy.grid.pinFound={x:40,y:60};legacy.grid.cells={A1:{s:2,by:'드론'}};
  /* Import uses the app realm's JSON parser; reproduce that plain-object boundary. */
  legacy=W.JSON.parse(JSON.stringify(legacy));
  var migrated=W.migrate(legacy);
  ok('과거 사진만 확대된 저장분은 위치 재확인 대상으로 표시한다',
    migrated.grid.spatialReview===true&&migrated.grid.viewportVersion===1);
  ok('구버전 확대값은 제거하되 기존 수색칸·핀 위치 기록은 보존한다',
    migrated.grid.mapZoom===100&&migrated.grid.mapX===0&&migrated.grid.mapY===0
    &&JSON.stringify(migrated.grid.cells)===JSON.stringify(legacy.grid.cells)
    &&JSON.stringify(migrated.grid.pinFound)===JSON.stringify(legacy.grid.pinFound));
  var normal=W.JSON.parse(JSON.stringify(legacy));normal.grid.mapZoom=100;normal.grid.mapX=0;normal.grid.mapY=0;
  var calibrated=W.JSON.parse(JSON.stringify(legacy));
  calibrated.grid.geo={west:127.1,east:127.2,north:35.2,south:35.1,src:'manual',at:Date.now()};
  ok('확대·보정이 없었던 구버전 저장분에는 위치 재확인 경고를 붙이지 않는다',
    !W.migrate(normal).grid.spatialReview);
  calibrated.grid.mapZoom=100;calibrated.grid.mapX=0;calibrated.grid.mapY=0;
  ok('과거 확대 중 보정했을 가능성이 있는 구버전 좌표도 재확인을 요구한다',
    W.migrate(W.JSON.parse(JSON.stringify(calibrated))).grid.spatialReview===true);
  W.S=migrated;W.commit();gotoSection('sec-grid');await wait(50);
  var before=workspaceSignature();
  W.setMapEditMode('paint');W.setPinMode('found');workspaceTap(workspacePoint(50,50));
  ok('위치 재확인 전에는 경고를 표시하고 새 수색칸·핀 편집을 막는다',
    !!W.document.getElementById('mapReviewNotice')&&W.ensureMapReviewed()===false
    &&workspaceSignature()===before);
  W.setPinMode('ref1');workspaceTap(workspacePoint(30,30));await wait(30);
  ok('위치 재확인 중에도 좌표를 바로잡는 기준점 선택은 허용한다',
    W.S.grid.ref1&&workspaceNear(W.S.grid.ref1.x,30)&&workspaceNear(W.S.grid.ref1.y,30));
  W.confirm=function(){return false;};
  W.document.querySelector('[data-act="confirmmapreview"]').click();await wait(50);
  ok('위치 확인을 취소하면 재확인 경고를 유지한다',W.S.grid.spatialReview===true);
  W.confirm=function(){return true;};
  W.document.querySelector('[data-act="confirmmapreview"]').click();await wait(120);
  ok('사용자가 위치 확인을 마치면 새 편집을 허용한다',
    W.S.grid.spatialReview===false&&W.ensureMapReviewed()===true);
}

async function mapWorkspaceAlerts(){
  await workspaceSetup();group('지도 작업공간 · 크게 보기 중 긴급·저장 알림');
  W.openMapWorkspace('consMap');
  W.addEvent('found','지도 집중 중 발견 확인 필요','B1');await wait(60);
  var dialog=W.document.querySelector('.map-dialog'),notice=dialog.querySelector('.map-dialog-alert');
  ok('지도 크게 보기 안에서도 미확인 발견 경보와 전체 상태로 돌아갈 버튼을 제공한다',
    notice&&!notice.hidden&&notice.textContent.indexOf('지도 집중 중 발견 확인 필요')>=0
    &&!!notice.querySelector('[data-map-action="close"]'));
  W.setSaveStatus(false,'지도 회귀검사 저장 실패');
  ok('지도 대화상자 위에 저장 실패를 즉시 표시하고 발견 경보도 유지한다',
    notice.textContent.indexOf('지도 회귀검사 저장 실패')>=0
    &&notice.textContent.indexOf('지도 집중 중 발견 확인 필요')>=0);
  var ackBefore=W.S.ui.ackFound,event=W.latestFound();
  notice.querySelector('[data-map-action="close"]').click();
  ok('경보 안내로 지도를 닫는 동작은 발견 확인을 대신하지 않는다',
    !W.mapExpandedTarget&&W.S.ui.ackFound===ackBefore&&W.S.ui.ackFound<W.foundAlarmKey(event));
  W.setSaveStatus(true,'');
}
