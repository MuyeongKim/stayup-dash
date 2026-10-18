/* App-level offline map contracts. Provider projection uses the independent
 * Mercator double from online-maps.js; real persistence/network is separately
 * exercised by offline-browser.mjs and the offline engine tests. */
'use strict';

async function runOfflineMaps(){
  await offlineMapSavedMode();
  await offlineMapFallbackMode();
  await offlineMapColdStartLatch();
  await offlineMapSaveProtection();
  await offlineMapMissingAndReadonly();
}

function offlineMapInstall(options){
  options=options||{};
  var realm=W,mock=onlineMapInstallSdk(false),packs=onlineMapValue([{
    id:'region-test-ready',status:'ready',bbox:[24,60,26,62],minZoom:0,maxZoom:14,
    bytes:1024,tileCount:20,createdAt:'2026-10-18T00:00:00.000Z',
    source:{date:'2026-03-03',attribution:'OpenStreetMap contributors · Protomaps'}
  }]);
  var downloads=[],pending=[];
  realm.STAYUP_OFFLINE={
    init:function(){return realm.Promise.resolve();},
    estimate:function(){return {tileCount:20};},
    list:function(){return realm.Promise.resolve(packs.slice());},
    createMap:function(element,settings,draw,fail){
      if(options.rendererFailure)return realm.Promise.reject(new Error('회귀검사: 저장 지도 누락'));
      return realm.onlineSDK.create('offline',element,{geo:settings.bounds,center:settings.center,zoom:settings.zoom},draw,fail);
    },
    download:function(settings){
      downloads.push(settings);
      if(options.downloadFailure)return realm.Promise.reject(new Error('회귀검사: 저장 공간 부족'));
      if(options.delayedDownload)return new realm.Promise(function(resolve,reject){pending.push({resolve:resolve,reject:reject,settings:settings});});
      return realm.Promise.resolve(packs[0]);
    }
  };
  realm.prepareOfflineShell=function(){realm.offlineShell={ready:true,waiting:false,build:'fixture',message:'테스트 준비 완료'};return realm.Promise.resolve(realm.offlineShell);};
  realm.offlinePacks=packs.slice();realm.offlineCatalogLoaded=true;realm.offlineFallback=false;
  return {sdk:mock,packs:packs,downloads:downloads,pending:pending};
}
async function offlineMapSetup(options){await onlineMapSetup();return offlineMapInstall(options);}
function offlineMapState(){return JSON.stringify(W.S);}

async function offlineMapSavedMode(){
  var fixture=await offlineMapSetup();group('저장한 지역 지도 · 위치와 편집 유지');
  var before=onlineMapSignature(),image=W.MAPDATA;
  var selected=W.selectOfflinePack(fixture.packs[0].id),mounted=await onlineMapReady(fixture.sdk);
  ok('저장 지도 선택은 기존 핀·구역·담당·기록과 사진을 유지한다',selected===true&&mounted
    &&W.S.grid.source==='offline'&&W.S.grid.offlineId===fixture.packs[0].id
    &&onlineMapSignature()===before&&W.MAPDATA===image);
  if(!mounted)return;
  var migrated=W.migrate(W.S);
  ok('상황 JSON은 저장 지도 참조를 보존한다',migrated.grid.source==='offline'&&migrated.grid.offlineId===fixture.packs[0].id);
  var host=workspaceHost(),revision=W.S.meta.revision;
  W.setMapView(host,{zoom:2,x:20,y:10});await wait(60);
  var pin=host.querySelector('.pin.found').getBoundingClientRect(),expected=onlineMapScreenPoint(fixture.sdk,55,55);
  ok('저장 지도 확대·이동 후 핀은 같은 위경도 지점에 붙어 있다',expected
    &&onlineMapNear(pin.left,expected.x)&&onlineMapNear(pin.top,expected.y));
  ok('저장 지도 확대·이동은 출동 자료와 저장 판을 바꾸지 않는다',onlineMapSignature()===before&&W.S.meta.revision===revision);
  W.resetMapView(host);await wait(60);
  var point=onlineMapScreenPoint(fixture.sdk,47,52),inverse=W.getMapPoint(host,point.x,point.y);
  ok('저장 지도 화면 위치를 수색 원본 좌표로 역변환한다',inverse&&onlineMapNear(inverse.x,47,0.00001)&&onlineMapNear(inverse.y,52,0.00001));
  W.setPinMode('found');point=onlineMapScreenPoint(fixture.sdk,47,52);workspaceTap(point);await wait(70);
  ok('저장 지도에서 배치한 핀은 원래 수색 좌표로 저장된다',W.S.grid.pinFound
    &&onlineMapNear(W.S.grid.pinFound.x,47,0.00001)&&onlineMapNear(W.S.grid.pinFound.y,52,0.00001));
  W.setMapEditMode('paint');
  var first=onlineMapScreenPoint(fixture.sdk,4/6*100+2,2/5*100+2),last=onlineMapScreenPoint(fixture.sdk,5/6*100+2,2/5*100+2);
  var eventCount=W.S.events.length;
  workspacePointer('pointerdown',first);workspacePointer('pointermove',last);workspacePointer('pointerup',last);await wait(70);
  ok('저장 지도에서도 칠하기가 한 번의 구역 변경 기록으로 저장된다',W.S.events.length===eventCount+1
    &&W.S.grid.cells.C5&&W.S.grid.cells.C6);
}

async function offlineMapFallbackMode(){
  var fixture=await offlineMapSetup();group('통신 단절 · 배경 자동 전환');
  W.S.grid.offlineId=fixture.packs[0].id;W.commit();
  W.applyMapSource('google','roadmap');await onlineMapReady(fixture.sdk);
  W.setMapView(workspaceHost(),{zoom:2,x:18,y:9});await wait(60);
  var before=onlineMapSignature(),revision=W.S.meta.revision,center=fixture.sdk.current().adapter.getCenter(),zoom=fixture.sdk.current().adapter.getZoom();
  try{
    Object.defineProperty(W.navigator,'onLine',{configurable:true,value:false});
    W.dispatchEvent(new W.Event('offline'));await onlineMapReady(fixture.sdk);
    var current=fixture.sdk.current(),afterCenter=current&&current.adapter.getCenter();
    ok('통신이 끊기면 저장 지도 배경으로 전환하고 온라인 선택을 보존한다',
      W.effectiveMapSource()==='offline'&&W.S.grid.source==='google'&&current&&current.provider==='offline');
    ok('자동 전환은 핀·칠한 구역·담당·기록과 저장 판을 바꾸지 않는다',onlineMapSignature()===before&&W.S.meta.revision===revision);
    ok('자동 전환은 보고 있던 중심과 확대 수준을 유지한다',afterCenter
      &&onlineMapNear(afterCenter.lat,center.lat,0.00001)&&onlineMapNear(afterCenter.lon,center.lon,0.00001)
      &&onlineMapNear(current.adapter.getZoom(),zoom,0.00001));
    W.setMapEditMode('paint');
    ok('인터넷이 끊겨도 저장 지도에서 편집을 시작할 수 있다',W.onlineMapReady(workspaceHost())&&W.mapEditMode==='paint'&&W.mapEditsAllowed()===true);
    W.setMapEditMode('view');
    Object.defineProperty(W.navigator,'onLine',{configurable:true,value:true});W.dispatchEvent(new W.Event('online'));await wait(50);
    ok('통신 복구 이벤트만으로 편집 중인 지도를 강제 전환하지 않는다',W.effectiveMapSource()==='offline'&&onlineMapSignature()===before);
  }finally{delete W.navigator.onLine;}
}

async function offlineMapSaveProtection(){
  var fixture=await offlineMapSetup({downloadFailure:true});group('지역 지도 저장 · 실패와 늦은 완료 보호');
  var before=offlineMapState(),result=await W.saveOfflineRegion(14);
  ok('지역 저장 실패는 기존 지도 참조·핀·구역·기록을 변경하지 않는다',result===false&&offlineMapState()===before&&!W.offlineJob);
  fixture=offlineMapInstall({delayedDownload:true});
  var pending=W.saveOfflineRegion(14);await wait(20);
  var ignored=await W.saveOfflineRegion(15);
  ok('저장 중 같은 작업을 중복 시작하지 않는다',ignored===false&&fixture.downloads.length===1);
  W.S.grid.generation='different-region';W.commit();before=offlineMapState();
  fixture.pending[0].resolve(fixture.packs[0]);await pending;
  ok('저장 중 수색 범위가 바뀌면 늦게 받은 지도를 현재 상황에 연결하지 않는다',offlineMapState()===before&&W.S.grid.offlineId!==fixture.packs[0].id&&!W.offlineJob);
  fixture=offlineMapInstall({delayedDownload:true});before=offlineMapState();pending=W.saveOfflineRegion(14);await wait(20);
  W.offlineJob.controller.abort();fixture.pending[0].reject(new W.DOMException('cancel','AbortError'));await pending;
  ok('저장 취소는 이전 지도·핀·구역을 유지하고 작업 잠금을 해제한다',offlineMapState()===before&&!W.offlineJob);
}

async function offlineMapColdStartLatch(){
  var fixture=await offlineMapSetup();group('오프라인 재실행 · 사용자가 선택할 때만 온라인 복귀');
  W.S.grid.source='google';W.S.grid.offlineId=fixture.packs[0].id;
  W.offlinePacks=[];W.offlineFallback=false;
  if('offlineFallbackScope' in W)W.offlineFallbackScope='';
  var before=onlineMapSignature(),revision=W.S.meta.revision;
  try{
    // A cold launch receives no transition-to-offline event. The catalog arrives
    // asynchronously after the saved mission has already selected Google.
    Object.defineProperty(W.navigator,'onLine',{configurable:true,value:false});
    await W.refreshOfflinePacks(false);await onlineMapReady(fixture.sdk);
    ok('통신 단절 이벤트 없이 재실행해도 보관함을 읽은 뒤 저장 지도를 사용한다',
      W.effectiveMapSource()==='offline'&&fixture.sdk.current()&&fixture.sdk.current().provider==='offline'
      &&W.S.grid.source==='google'&&onlineMapSignature()===before);
    W.setMapView(workspaceHost(),{zoom:2,x:12,y:-6});await wait(50);
    var camera=fixture.sdk.current().adapter.getCenter(),zoom=fixture.sdk.current().adapter.getZoom();
    Object.defineProperty(W.navigator,'onLine',{configurable:true,value:true});
    W.dispatchEvent(new W.Event('online'));W.renderGridAll();await wait(60);
    ok('오프라인으로 재실행한 화면은 통신 복구 뒤에도 저장 지도와 출동 자료를 유지한다',
      W.effectiveMapSource()==='offline'&&fixture.sdk.current()&&fixture.sdk.current().provider==='offline'
      &&onlineMapSignature()===before&&W.S.meta.revision===revision);
    var reconnect=W.document.querySelector('[data-offline-action="reconnect"]');
    if(reconnect)reconnect.click();await onlineMapReady(fixture.sdk);
    ok('사용자가 다시 연결을 누른 경우에만 온라인 지도로 돌아간다',reconnect
      &&W.effectiveMapSource()==='google'&&fixture.sdk.current()&&fixture.sdk.current().provider==='google'
      &&onlineMapSignature()===before&&W.S.meta.revision===revision);
    var restored=fixture.sdk.current()&&fixture.sdk.current().adapter.getCenter();
    ok('온라인 다시 연결도 보던 위치와 확대 수준을 유지한다',restored
      &&onlineMapNear(restored.lat,camera.lat,0.00001)&&onlineMapNear(restored.lon,camera.lon,0.00001)
      &&onlineMapNear(fixture.sdk.current().adapter.getZoom(),zoom,0.00001));
    W.activateOfflineFallback('회귀검사');W.S.grid.generation='next-cold-start-scope';
    ok('다른 수색 세대에 이전 화면의 자동 전환 상태를 적용하지 않는다',W.effectiveMapSource()==='google');
  }finally{delete W.navigator.onLine;}
}

async function offlineMapMissingAndReadonly(){
  var fixture=await offlineMapSetup();group('저장 지도 · 범위와 편집권 확인');
  fixture.packs.push(onlineMapValue({id:'region-wrong-place',status:'ready',bbox:[127,35,128,36],maxZoom:14,bytes:100}));
  W.offlinePacks=fixture.packs.slice();var before=offlineMapState();
  ok('다른 지역 지도는 기존 수색 범위에 억지로 맞추지 않는다',W.selectOfflinePack('region-wrong-place')===false&&offlineMapState()===before);
  W.offlinePacks=[];before=offlineMapState();
  ok('현재 수색 범위의 저장 지도가 없으면 배경 전환을 거부한다',W.applyMapSource('offline','roadmap')===false&&offlineMapState()===before);
  W.offlinePacks=fixture.packs.slice();
  var ensure=W.ensureEditor;W.ensureEditor=function(){return false;};before=offlineMapState();
  ok('보기 전용 화면에서 저장 지도를 연결하거나 새로 내려받지 않는다',W.selectOfflinePack(fixture.packs[0].id)===false&&(await W.saveOfflineRegion(14))===false&&offlineMapState()===before);
  W.ensureEditor=ensure;
  fixture=offlineMapInstall({rendererFailure:true});before=onlineMapSignature();
  W.selectOfflinePack(fixture.packs[0].id);await wait(100);
  ok('저장 지도 조각을 읽지 못하면 편집을 막고 기존 자료를 보존한다',!W.onlineMapReady(workspaceHost())
    &&W.mapEditsAllowed()===false&&onlineMapSignature()===before);
}
