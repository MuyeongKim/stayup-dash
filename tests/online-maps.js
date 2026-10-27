/* Online-map contract tests. No provider key or network request is used.
   The SDK double implements Web Mercator independently so a regular CSS grid
   cannot accidentally pass the latitude-row and inverse-coordinate checks. */
'use strict';

async function runOnlineMaps(){
  await onlineMapSettings();
  await onlineMapGeometry('naver');
  await onlineMapGeometry('google');
  await onlineMapAsyncFit();
  await onlineMapZoomLimit();
  await onlineMapReadonly();
  await onlineMapUnavailable();
  await onlineMapNewArea();
}

function onlineMapValue(value){return W.JSON.parse(JSON.stringify(value));}
function onlineMapNear(actual,expected,tolerance){
  return Number.isFinite(actual)&&Number.isFinite(expected)&&Math.abs(actual-expected)<(tolerance||0.35);
}
function onlineMapSignature(){return JSON.stringify({
  cells:W.S.grid.cells,pinLast:W.S.grid.pinLast,pinFound:W.S.grid.pinFound,
  ref1:W.S.grid.ref1,ref2:W.S.grid.ref2,geo:W.S.grid.geo,
  generation:W.S.grid.generation,events:W.S.events,drones:W.S.drones
});}
function onlineMapInstallSdk(unavailable,delayedFit){
  var realm=W,instances=[],loads=[];
  function mercator(point){
    var lat=Math.max(-85,Math.min(85,point.lat)),sin=Math.sin(lat*Math.PI/180);
    return {x:(point.lon+180)/360,y:0.5-Math.log((1+sin)/(1-sin))/(4*Math.PI)};
  }
  function inverse(point){
    return {lat:Math.atan(Math.sinh(Math.PI*(1-2*point.y)))*180/Math.PI,lon:point.x*360-180};
  }
  realm.onlineSDK={
    load:function(provider,key){
      loads.push({provider:provider,key:key});
      return unavailable?realm.Promise.reject(new Error('회귀검사: 지도 연결 불가')):realm.Promise.resolve();
    },
    create:function(provider,element,options,onDraw,onError){
      if(unavailable)return realm.Promise.reject(new Error('회귀검사: 지도 생성 불가'));
      options=options||{};
      var center=options.center?{lat:options.center.lat,lon:options.center.lon}:{lat:0,lon:0};
      var zoom=Number.isFinite(options.zoom)?options.zoom:8,destroyed=false,queued=false,created=false;
      function draw(){
        if(queued||destroyed)return;queued=true;
        realm.setTimeout(function(){queued=false;if(!destroyed&&typeof onDraw==='function')onDraw();},0);
      }
      function size(){var rect=element.getBoundingClientRect();return {w:rect.width||800,h:rect.height||400};}
      function project(point){
        var a=mercator(point),c=mercator(center),s=size(),scale=256*Math.pow(2,zoom);
        return {x:s.w/2+(a.x-c.x)*scale,y:s.h/2+(a.y-c.y)*scale};
      }
      function unproject(point){
        var c=mercator(center),s=size(),scale=256*Math.pow(2,zoom);
        return inverse({x:c.x+(point.x-s.w/2)/scale,y:c.y+(point.y-s.h/2)/scale});
      }
      var adapter={
        project:project,unproject:unproject,
        getZoom:function(){return zoom;},
        setZoom:function(value){zoom=Math.max(1,Math.min(21,value));draw();},
        getCenter:function(){return {lat:center.lat,lon:center.lon};},
        setCenter:function(value){center={lat:value.lat,lon:value.lon};draw();},
        panBy:function(x,y){
          if(typeof x==='object'){y=x.y;x=x.x;}
          var s=size();center=unproject({x:s.w/2+x,y:s.h/2+y});draw();
        },
        fitBounds:function(bounds){
          var nw=mercator({lat:bounds.north,lon:bounds.west});
          var se=mercator({lat:bounds.south,lon:bounds.east}),s=size();
          var nextCenter=inverse({x:(nw.x+se.x)/2,y:(nw.y+se.y)/2});
          var nextZoom=Math.max(1,Math.min(21,
            Math.log2(Math.max(1,s.w-32)/(256*Math.abs(se.x-nw.x))),
            Math.log2(Math.max(1,s.h-32)/(256*Math.abs(se.y-nw.y)))));
          return new realm.Promise(function(resolve){
            function apply(){if(!destroyed){center=nextCenter;zoom=nextZoom;draw();}resolve();}
            if(delayedFit&&created)realm.setTimeout(apply,45);else apply();
          });
        },
        resize:draw,
        destroy:function(){destroyed=true;},
        setMapType:function(){draw();}
      };
      instances.push({provider:provider,element:element,adapter:adapter,isDestroyed:function(){return destroyed;}});
      if(options.geo&&(!options.center||!Number.isFinite(options.zoom)))adapter.fitBounds(options.geo);
      created=true;
      draw();return realm.Promise.resolve(adapter);
    }
  };
  return {instances:instances,loads:loads,current:function(){
    var host=realm.document.getElementById('consMap');
    return instances.filter(function(item){return !item.isDestroyed()&&item.element.isConnected&&host&&host.contains(item.element);}).pop();
  }};
}
async function onlineMapReady(mock){
  for(var i=0;i<30;i++){await wait(30);if(mock.current()){await wait(40);return mock.current();}}
  return null;
}
function onlineMapScreenPoint(mock,x,y){
  var current=mock.current();if(!current)return null;
  var point=current.adapter.project(W.geoAt(x/100,y/100)),rect=current.element.getBoundingClientRect();
  var host=workspaceHost().getBoundingClientRect();
  return {x:rect.left+point.x,y:rect.top+point.y,hx:host.left,hy:host.top};
}
async function onlineMapSetup(){
  await workspaceSetup();
  W.saveOnlineKeys(onlineMapValue({naver:'regression-naver-browser-key',google:'regression-google-browser-key'}));
  /* Two degrees at high latitude make a false equal-height row layout visible. */
  W.S.grid.geo=onlineMapValue({west:24,east:26,north:62,south:60,src:'manual',at:12345});
  W.S.grid.pinLast=onlineMapValue({x:45,y:45});W.S.grid.pinFound=onlineMapValue({x:55,y:55});
  W.S.grid.cells=onlineMapValue({C3:{s:2,by:'드론'}});
  W.commit();gotoSection('sec-grid');await wait(50);
}

async function onlineMapSettings(){
  await workspaceSetup();group('온라인 지도 · 설정과 자료 보호');
  var before=JSON.stringify(W.S),keys={naver:'regression-naver-browser-key',google:'regression-google-browser-key'};
  var saved=W.saveOnlineKeys(onlineMapValue(keys)),loaded=W.getOnlineKeys();
  ok('지도 연결 키는 브라우저 설정에 저장하고 출동 상태를 바꾸지 않는다',
    saved===true&&loaded.naver===keys.naver&&loaded.google===keys.google&&JSON.stringify(W.S)===before);
  var exported=W.exportPayload(true);
  ok('JSON 보관 파일에 네이버·구글 연결 키가 들어가지 않는다',
    exported.indexOf(keys.naver)<0&&exported.indexOf(keys.google)<0);
  var raw=onlineMapValue(W.S);raw.grid.source='https://untrusted.example/map';raw.grid.mapType='arbitrary';
  var clean=W.migrate(raw);
  ok('지원하지 않는 지도 공급자와 지도 종류를 안전한 기본값으로 정규화한다',
    clean.grid.source==='image'&&clean.grid.mapType==='roadmap');
  delete raw.grid.source;delete raw.grid.mapType;
  ok('기존 JSON은 이미지 지도 모드로 읽는다',W.migrate(raw).grid.source==='image');
  raw=onlineMapValue(W.S);raw.grid.source='naver';raw.grid.mapType='satellite';
  raw.grid.geo=onlineMapValue({west:127.1,east:127.2,north:35.2,south:35.1,src:'online',at:12345});
  clean=W.migrate(raw);
  ok('온라인 지도의 공급자·종류와 고정 수색 범위를 저장 자료에서 복원한다',
    clean.grid.source==='naver'&&clean.grid.mapType==='satellite'&&clean.grid.geo
    &&clean.grid.geo.src==='online'&&clean.grid.geo.west===127.1&&clean.grid.geo.north===35.2);
  W.S.grid.geo=null;W.commit();before=JSON.stringify(W.S);
  ok('좌표 없는 이미지의 표식을 임의의 온라인 위치로 옮기지 않는다',
    W.applyMapSource('naver','roadmap')===false&&JSON.stringify(W.S)===before);
  W.S.grid.geo=onlineMapValue({west:127.1,east:127.2,north:35.2,south:35.1,src:'manual',at:12345});
  W.commit();W.saveOnlineKeys(onlineMapValue({naver:'',google:''}));before=JSON.stringify(W.S);
  ok('연결 키가 없으면 출동 자료를 바꾸지 않고 온라인 전환을 거부한다',
    W.applyMapSource('google','roadmap')===false&&JSON.stringify(W.S)===before);
}

async function onlineMapGeometry(provider){
  await onlineMapSetup();group('온라인 지도 · '+provider+' 위치와 편집');
  var mock=onlineMapInstallSdk(false),before=onlineMapSignature(),image=W.MAPDATA;
  var selected=W.applyMapSource(provider,'roadmap'),mounted=await onlineMapReady(mock);
  ok(provider+' 지도 전환은 기존 핀·격자·기록과 오프라인 이미지를 보존한다',
    selected===true&&W.S.grid.source===provider&&mounted&&mounted.provider===provider
    &&onlineMapSignature()===before&&W.MAPDATA===image);
  if(!mounted)return;
  var host=workspaceHost(),revision=W.S.meta.revision;
  W.setMapView(host,{zoom:2,x:20,y:10});await wait(80);
  var pin=host.querySelector('.pin.found'),actual=pin&&pin.getBoundingClientRect();
  var expected=onlineMapScreenPoint(mock,55,55);
  ok(provider+' 확대·이동한 핀은 원래 위경도의 투영 위치를 가리킨다',
    actual&&expected&&onlineMapNear(actual.left,expected.x)&&onlineMapNear(actual.top,expected.y));
  var point=onlineMapScreenPoint(mock,47,52),inverse=point&&W.getMapPoint(host,point.x,point.y);
  ok(provider+' 화면 좌표를 원래 격자 좌표로 역변환한다',
    inverse&&onlineMapNear(inverse.x,47,0.00001)&&onlineMapNear(inverse.y,52,0.00001));
  ok(provider+' 확대·이동은 고정 수색 범위·출동 기록·저장 판을 바꾸지 않는다',
    onlineMapSignature()===before&&W.S.meta.revision===revision);
  W.resetMapView(host);await wait(80);
  var cell=host.querySelector('[data-cell="C3"]'),cellBox=cell&&cell.getBoundingClientRect();
  var nw=onlineMapScreenPoint(mock,2/6*100,2/5*100),se=onlineMapScreenPoint(mock,3/6*100,3/5*100);
  var firstRow=host.querySelector('[data-cell="A3"]'),lastRow=host.querySelector('[data-cell="E3"]');
  ok(provider+' 격자 모서리는 실제 위경도 투영과 일치한다',cellBox&&nw&&se
    &&onlineMapNear(cellBox.left,nw.x)&&onlineMapNear(cellBox.top,nw.y)
    &&onlineMapNear(cellBox.right,se.x)&&onlineMapNear(cellBox.bottom,se.y));
  ok(provider+' 위도에 따른 투영 차이를 각 격자 행 높이에 반영한다',
    firstRow&&lastRow&&firstRow.getBoundingClientRect().height>lastRow.getBoundingClientRect().height+0.3);
  W.setMapView(host,{zoom:2,x:10,y:-10});await wait(70);
  W.setPinMode('last');point=onlineMapScreenPoint(mock,47,52);workspaceTap(point);await wait(90);
  ok(provider+' 확대 화면에서 놓은 핀을 원래 지리 범위의 좌표로 저장한다',
    W.S.grid.pinLast&&onlineMapNear(W.S.grid.pinLast.x,47,0.00001)
    &&onlineMapNear(W.S.grid.pinLast.y,52,0.00001));
  await onlineMapReady(mock);host=workspaceHost();W.resetMapView(host);await wait(70);
  W.setMapEditMode('view');before=onlineMapSignature();
  var start=onlineMapScreenPoint(mock,25,70),end=onlineMapScreenPoint(mock,42,70);
  workspacePointer('pointerdown',start);workspacePointer('pointermove',end);workspacePointer('pointerup',end);await wait(40);
  ok(provider+' 보기 모드에서 쓸어도 수색 상태·핀·이력을 바꾸지 않는다',onlineMapSignature()===before);
  W.resetMapView(workspaceHost());await wait(70);W.setMapEditMode('paint');
  /* The palette and preparation controls change the map's document position.
     Hit-tested gestures must target visible cells, as real pointer input does. */
  workspaceHost().scrollIntoView({block:'center',behavior:'instant'});await wait(30);
  W.S.ui.paintS=2;W.S.ui.paintBy='지상';
  var cellsBefore=JSON.stringify(W.S.grid.cells),count=W.S.events.length;
  start=onlineMapScreenPoint(mock,25,70);end=onlineMapScreenPoint(mock,42,70);
  workspacePointer('pointerdown',start);workspacePointer('pointermove',end);
  ok(provider+' 칠하기 도중에는 확정 상태와 활동 기록을 저장하지 않는다',
    JSON.stringify(W.S.grid.cells)===cellsBefore&&W.S.events.length===count);
  workspacePointer('pointerup',end);await wait(90);
  ok(provider+' 완료한 쓸기만 해당 구역과 한 건의 완료 기록으로 저장한다',
    W.S.grid.cells.D2&&W.S.grid.cells.D2.s===2&&W.S.grid.cells.D2.by==='지상'
    &&W.S.grid.cells.D3&&W.S.grid.cells.D3.s===2&&W.S.events.length===count+1);
  W.undoSweep();await wait(80);
  ok(provider+' 쓸기 되돌리기가 원래 상태를 복원하고 완료 이력을 무효화한다',
    JSON.stringify(W.S.grid.cells)===cellsBefore&&W.S.events[count]&&W.S.events[count].voided===true);
  before=onlineMapSignature();W.applyMapSource('image','roadmap');await wait(80);
  ok(provider+'에서 이미지로 돌아와도 같은 수색 자료와 원본 이미지를 유지한다',
    W.S.grid.source==='image'&&onlineMapSignature()===before&&W.MAPDATA===image);
}

async function onlineMapUnavailable(){
  await onlineMapSetup();group('온라인 지도 · 연결 실패');
  var mock=onlineMapInstallSdk(true),before=onlineMapSignature(),image=W.MAPDATA;
  W.applyMapSource('google','roadmap');await wait(150);
  ok('지도 SDK 연결 실패가 기존 좌표·핀·수색 상태·활동 기록을 지우지 않는다',
    mock.loads.length>0&&onlineMapSignature()===before&&W.MAPDATA===image);
  W.applyMapSource('image','roadmap');await wait(50);
  ok('온라인 연결에 실패해도 이미지 모드로 돌아갈 수 있다',
    W.S.grid.source==='image'&&!!workspaceHost().querySelector('.mapimg')&&onlineMapSignature()===before);

  mock=onlineMapInstallSdk(false);W.applyMapSource('naver','roadmap');
  var mounted=await onlineMapReady(mock);before=onlineMapSignature();
  if(mounted){
    W.setMapEditMode('paint');W.S.ui.paintS=2;
    var point=onlineMapScreenPoint(mock,25,70);
    workspacePointer('pointerdown',point);
    W.dispatchEvent(new W.Event('offline'));
    workspacePointer('pointerup',point);await wait(50);
    ok('칠하기 도중 인터넷이 끊기면 미확정 입력을 취소하고 기록을 보존한다',
      !W.painting&&onlineMapSignature()===before);
    var host=workspaceHost(),overlay=host.querySelector('.online-overlays'),notice=host.querySelector('.online-status');
    ok('연결이 끊긴 지도는 표식을 숨기고 새 핀·구역 편집을 막는다',
      overlay&&overlay.hidden&&notice&&!notice.hidden&&W.mapEditsAllowed()===false
      &&W.getMapPoint(host,point.x,point.y)===null);
  }else{
    ok('칠하기 도중 인터넷이 끊기면 미확정 입력을 취소하고 기록을 보존한다',false);
    ok('연결이 끊긴 지도는 표식을 숨기고 새 핀·구역 편집을 막는다',false);
  }
}

async function onlineMapReadonly(){
  await onlineMapSetup();group('온라인 지도 · 읽기 전용');
  var mock=onlineMapInstallSdk(false);W.applyMapSource('naver','roadmap');
  var mounted=await onlineMapReady(mock);if(!mounted){ok('읽기 전용 검사 지도 준비',false);return;}
  W.releaseEditorLock();W.buildGrid(workspaceHost(),false);await wait(60);
  var before=onlineMapSignature(),host=workspaceHost(),oldZoom=W.mapViewState(host).zoom;
  W.setMapView(host,{zoom:2,x:15,y:10});await wait(50);
  ok('편집권 없는 화면도 온라인 지도를 확대·이동해 볼 수 있다',
    !W.ownsEditorLock()&&W.mapViewState(host).zoom>oldZoom&&onlineMapSignature()===before);
  var state=JSON.stringify(W.S),keys=JSON.stringify(W.getOnlineKeys());
  ok('읽기 전용 화면에서 배경·수색 범위·연결 키 변경을 거부한다',
    W.applyMapSource('google','roadmap')===false
    &&W.createOnlineArea(35.9,127.2,2,'google')===false
    &&W.saveOnlineKeys(onlineMapValue({naver:'replacement-key',google:''}))===false
    &&JSON.stringify(W.S)===state&&JSON.stringify(W.getOnlineKeys())===keys);
  W.acquireEditorLock();
}

async function onlineMapAsyncFit(){
  await onlineMapSetup();group('온라인 지도 · 비동기 전체 맞춤');
  var mock=onlineMapInstallSdk(false,true);W.applyMapSource('google','roadmap');
  var mounted=await onlineMapReady(mock);if(!mounted){ok('비동기 맞춤 검사 지도 준비',false);return;}
  var host=workspaceHost(),width=host.querySelector('.mapfit').getBoundingClientRect().width,before=onlineMapSignature();
  W.setMapView(host,{zoom:2,x:40,y:10});await wait(70);
  W.resetMapView(host);await wait(100);
  ok('SDK의 전체 맞춤이 비동기로 끝나도 원래 수색 범위를 표시한다',
    onlineMapNear(host.querySelector('.mapfit').getBoundingClientRect().width,width)
    &&onlineMapSignature()===before);
  W.setMapView(host,{zoom:2,x:0,y:0});await wait(70);
  ok('비동기 전체 맞춤 뒤 다시 확대하면 맞춤 기준의 두 배가 된다',
    onlineMapNear(host.querySelector('.mapfit').getBoundingClientRect().width,width*2));
}

async function onlineMapZoomLimit(){
  await onlineMapSetup();group('온라인 지도 · 공급자 최대 확대');
  W.S.grid.geo=onlineMapValue({west:127.2,east:127.2005,north:35.9005,south:35.9,src:'manual',at:12345});
  W.commit();gotoSection('sec-grid');await wait(30);
  var mock=onlineMapInstallSdk(false);W.applyMapSource('google','roadmap');
  W.setMapView(workspaceHost(),{zoom:16});
  var mounted=await onlineMapReady(mock);if(!mounted){ok('최대 확대 검사 지도 준비',false);return;}
  var host=workspaceHost();
  ok('지도 준비 전에 누른 확대도 준비 후 실제 최대 배율로 맞춘다',
    onlineMapNear(W.mapViewState(host).zoom,W.mapMaxZoom(host),0.000001)
    &&onlineMapNear(mounted.adapter.getZoom(),21,0.000001));
  W.resetMapView(host);await wait(70);
  var base=mounted.adapter.getZoom(),expected=Math.min(16,Math.pow(2,21-base));
  var width=host.querySelector('.mapfit').getBoundingClientRect().width,before=onlineMapSignature();
  W.setMapView(host,{zoom:16,x:0,y:0});await wait(70);
  ok('작은 수색 범위는 공급자가 지원하는 최대 확대까지만 허용한다',
    expected<16&&onlineMapNear(W.mapViewState(host).zoom,expected,0.000001)
    &&onlineMapNear(mounted.adapter.getZoom(),21,0.000001));
  ok('최대 확대의 표시 배율이 실제 지도 크기와 일치하고 수색 좌표는 유지된다',
    onlineMapNear(host.querySelector('.mapfit').getBoundingClientRect().width,width*expected,0.6)
    &&onlineMapSignature()===before);
}

async function onlineMapNewArea(){
  await onlineMapSetup();group('온라인 지도 · 새 수색 범위와 복구');
  onlineMapInstallSdk(false);
  var before=JSON.stringify(W.S),confirm=W.confirm,saveRecovery=W.saveRecoveryPoint;
  var savedKeys=W.getOnlineKeys();W.saveOnlineKeys(onlineMapValue({naver:'',google:''}));
  ok('온라인 연결 키가 없으면 기존 자료를 지우는 새 범위 작업을 시작하지 않는다',
    W.createOnlineArea(35.9,127.2,2,'naver')===false&&JSON.stringify(W.S)===before);
  W.saveOnlineKeys(savedKeys);
  W.confirm=function(){return false;};
  ok('새 수색 범위 설정을 취소하면 기존 지도를 포함한 상태를 보존한다',
    W.createOnlineArea(35.9,127.2,2,'naver')===false&&JSON.stringify(W.S)===before);
  W.confirm=function(){return true;};W.saveRecoveryPoint=function(){return false;};
  ok('작업 전 복구본을 만들지 못하면 새 수색 범위를 적용하지 않는다',
    W.createOnlineArea(35.9,127.2,2,'naver')===false&&JSON.stringify(W.S)===before);
  W.saveRecoveryPoint=saveRecovery;
  var old=onlineMapValue(W.S),changed=W.createOnlineArea(35.9,127.2,2,'naver','satellite');await wait(90);
  var geo=W.S.grid.geo,recovery=W.JSON.parse(W.localStorage.getItem(W.RECOVERY_KEY)||'null');
  ok('새 온라인 수색 범위는 지정 중심을 포함한 정북 위경도 범위로 저장한다',
    changed===true&&W.S.grid.source==='naver'&&W.S.grid.mapType==='satellite'&&geo&&geo.src==='online'
    &&geo.west<127.2&&geo.east>127.2&&geo.south<35.9&&geo.north>35.9);
  ok('새 장소에서는 이전 격자·담당·핀·좌표 기준점을 초기화한다',
    !W.S.grid.pinLast&&!W.S.grid.pinFound&&!W.S.grid.ref1&&!W.S.grid.ref2
    &&Object.keys(W.S.grid.cells).length===0&&W.S.grid.generation!==old.grid.generation
    &&W.S.drones.every(function(drone){return !drone.zone;}));
  ok('새 범위를 설정해도 기존 활동 이력과 출동 정보는 유지한다',
    JSON.stringify(W.S.events)===JSON.stringify(old.events)&&W.S.mission.title===old.mission.title);
  ok('새 범위 적용 전의 핀·구역·이미지 참조를 복구본에 보관한다',
    recovery&&recovery.state&&JSON.stringify(recovery.state.grid.pinFound)===JSON.stringify(old.grid.pinFound)
    &&JSON.stringify(recovery.state.grid.cells)===JSON.stringify(old.grid.cells)
    &&recovery.state.grid.mapId===old.grid.mapId);
  var payload=W.exportPayload(true),rawRecovery=W.localStorage.getItem(W.RECOVERY_KEY)||'';
  ok('온라인 수색 자료와 복구본에도 연결 키를 포함하지 않는다',
    payload.indexOf('regression-naver-browser-key')<0&&payload.indexOf('regression-google-browser-key')<0
    &&rawRecovery.indexOf('regression-naver-browser-key')<0&&rawRecovery.indexOf('regression-google-browser-key')<0);
  W.confirm=confirm;
}
