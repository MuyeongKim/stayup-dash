/* Review regressions run in the same isolated HTTP iframe as regression.html.
   These cases exercise loss/failure boundaries and visible UI outcomes. */
'use strict';

async function reloadReviewState(){
  var frame=document.getElementById('app');
  await new Promise(function(resolve){
    frame.onload=function(){
      W=frame.contentWindow;
      W.__alerts=[];W.__dl=[];W.__dlBytes=[];W.__dlText=[];
      W.alert=function(message){W.__alerts.push(String(message));};
      W.confirm=function(){return true;};
      W.download=function(name,text){W.__dl.push(name);W.__dlBytes.push(text?text.length:0);W.__dlText.push(text||'');};
      setTimeout(resolve,350);
    };
    frame.src='../stayup-dash.html?review-reload='+Date.now();
  });
}

async function runReviewFixes(){
  await reload();
  group('검토 보완 · 비행 한계 누락');
  var unsafeLimits=[null,'',' ',0,-1,1000,'잘못된 값'];
  ok('누락·공란·범위 밖 비행 한계를 기본값으로 채우지 않는다',unsafeLimits.every(function(value){
    var raw=W.defaultState();raw.safety.windLimit=value;raw.safety.gustLimit=value;
    var normalized=W.migrate(raw);
    return normalized.safety.windLimit===null&&normalized.safety.gustLimit===null;
  }));
  var lowLimit=W.defaultState();lowLimit.safety.windLimit=0.5;lowLimit.safety.gustLimit=0.5;
  var normalizedLow=W.migrate(lowLimit);
  ok('입력창이 허용하는 0.5m/s 한계를 저장 후에도 유지한다',
    normalizedLow.safety.windLimit===0.5&&normalizedLow.safety.gustLimit===0.5);
  var legacyLimit=W.defaultState();delete legacyLimit.safety.windLimit;delete legacyLimit.safety.gustLimit;
  var normalizedLegacy=W.migrate(legacyLimit);
  ok('한계 필드 자체가 없는 구버전만 기존 기본값을 유지한다',
    normalizedLegacy.safety.windLimit===12&&normalizedLegacy.safety.gustLimit===12);
  W.loadSample();await wait(150);
  var missingLimit=W.migrate(W.S);
  missingLimit.safety.windLimit=null;missingLimit.safety.gustLimit=null;
  missingLimit.meta.revision=W.S.meta.revision+1;missingLimit.meta.updated=Date.now()+1;
  ok('상대 창 상태 채택에서도 누락 한계가 되살아나지 않는다',
    W.adopt(missingLimit,true)&&W.S.safety.windLimit===null&&W.S.safety.gustLimit===null);
  W.commit();
  await reloadReviewState();
  ok('실제 새로고침 후에도 비행 한계가 미설정으로 남는다',
    W.S.safety.windLimit===null&&W.S.safety.gustLimit===null);
  var missingReasons=W.flightVerdict(new Date()).why.join(' / ');
  ok('비행 판정에 지속풍·돌풍 한계 미설정을 모두 표시한다',
    missingReasons.indexOf('지속풍 한계 미설정')>=0&&missingReasons.indexOf('돌풍 한계 미설정')>=0);
  ok('활동 보고서도 누락한 비행 한계를 숫자 기본값으로 바꾸지 않는다',
    W.buildReport().indexOf('지속풍/돌풍 한계 미설정/미설정')>=0);
  await reviewMapPersistence();
  await reviewBackupLifecycle();
  await reviewEventIdentity();
  await reviewEventHistoryAndEmergency();
  await reviewBatteryConfirmation();
  await reviewConsoleAndDisplay();
}

function reviewMapImage(color){
  var canvas=W.document.createElement('canvas');canvas.width=8;canvas.height=4;
  var context=canvas.getContext('2d');context.fillStyle=color;context.fillRect(0,0,8,4);
  return canvas.toDataURL('image/png');
}

async function reviewMapPersistence(){
  await reload();
  group('검토 보완 · 지도 이관·좌표계');
  var legacyKey='review-idb-migration',legacyData=reviewMapImage('#245');
  var realIdbReq=W.idbReq;
  W.localStorage.setItem(W.MAP_PREFIX+legacyKey,legacyData);
  W.idbReq=function(mode){return mode==='readwrite'?Promise.reject(new Error('IDB 쓰기 실패')):Promise.resolve(undefined);};
  var readableOnFailure=await W.mapBlobGet(legacyKey);await wait(40);
  ok('IndexedDB 이관 쓰기 실패 시 유일한 localStorage 지도 본체를 보존한다',
    readableOnFailure===legacyData&&W.localStorage.getItem(W.MAP_PREFIX+legacyKey)===legacyData);
  var readCount=0;
  W.idbReq=function(mode){return Promise.resolve(mode==='readonly'?(++readCount===1?undefined:'다른 데이터'):undefined);};
  await W.mapBlobGet(legacyKey);await wait(40);
  ok('IndexedDB 이관 후 본체가 일치하지 않으면 원본을 삭제하지 않는다',
    W.localStorage.getItem(W.MAP_PREFIX+legacyKey)===legacyData);
  W.idbReq=realIdbReq;W.localStorage.removeItem(W.MAP_PREFIX+legacyKey);

  W.loadSample();await wait(100);
  var firstImage=reviewMapImage('#168'),secondImage=reviewMapImage('#e64');
  var mapMeta={w:8,h:4,natW:8,natH:4};
  await W.saveMap(firstImage,mapMeta);
  W.S.grid.cells={A1:{s:2,by:'드론'}};
  W.S.grid.pinLast={x:20,y:30};W.S.grid.pinFound={x:70,y:60};
  W.S.grid.geo={west:127.1,east:127.2,north:35.2,south:35.1,src:'manual',at:Date.now()};
  W.S.grid.ref1={x:0,y:0,lat:35.2,lon:127.1};W.S.grid.ref2={x:100,y:100,lat:35.1,lon:127.2};
  W.S.drones[0].zone='A1';W.commit();
  var beforeReplace=JSON.stringify(W.S),firstGeneration=W.S.grid.generation;
  W.confirm=function(){return false;};
  var cancelledMap=await W.saveMap(secondImage,mapMeta);
  ok('다른 지도 적용을 취소하면 지도·수색칸·핀·기체 구역을 보존한다',
    cancelledMap===false&&JSON.stringify(W.S)===beforeReplace&&W.MAPDATA===firstImage);
  W.confirm=function(){return true;};
  var replaced=await W.saveMap(secondImage,mapMeta);
  ok('다른 지도를 적용하면 이전 장소의 칸·핀·기체 구역·보정을 제거한다',
    replaced===true&&Object.keys(W.S.grid.cells).length===0&&!W.S.grid.pinLast&&!W.S.grid.pinFound
    &&W.S.drones.every(function(drone){return !drone.zone;})&&!W.S.grid.geo&&!W.S.grid.ref1&&!W.S.grid.ref2
    &&W.S.grid.generation!==firstGeneration&&W.MAPDATA===secondImage);
  var mapRestored=await W.restoreRecovery();await wait(80);
  ok('지도 교체 전 복구본은 이전 지도와 수색 정보를 함께 되돌린다',
    mapRestored===true&&W.MAPDATA===firstImage&&W.S.grid.cells.A1.s===2
    &&W.S.grid.pinLast.x===20&&W.S.grid.pinFound.x===70&&W.S.drones[0].zone==='A1'&&!!W.S.grid.geo);
  var beforeDimensions=JSON.stringify(W.S),oldGeneration=W.S.grid.generation;
  var oldPins=JSON.stringify([W.S.grid.pinLast,W.S.grid.pinFound,W.S.grid.geo]);
  W.confirm=function(){return false;};
  var cancelledDimensions=W.applyGridDimensions(4,4);
  ok('격자 크기 변경을 취소하면 완료칸과 기체 구역을 보존한다',
    cancelledDimensions===false&&JSON.stringify(W.S)===beforeDimensions);
  W.confirm=function(){return true;};
  var realRecovery=W.saveRecoveryPoint;
  W.saveRecoveryPoint=function(){return false;};
  var failedDimensions=W.applyGridDimensions(4,4);W.saveRecoveryPoint=realRecovery;
  ok('복구본 저장 실패 시 격자 크기를 변경하지 않는다',
    failedDimensions===false&&JSON.stringify(W.S)===beforeDimensions);
  var changedDimensions=W.applyGridDimensions(4,4);
  ok('격자 크기 적용은 칸·기체 구역을 비우고 같은 이미지의 핀·보정은 유지한다',
    changedDimensions===true&&W.S.grid.rows===4&&W.S.grid.cols===4
    &&Object.keys(W.S.grid.cells).length===0&&W.S.drones.every(function(drone){return !drone.zone;})
    &&W.S.grid.generation!==oldGeneration&&JSON.stringify([W.S.grid.pinLast,W.S.grid.pinFound,W.S.grid.geo])===oldPins);
  var dimensionsRestored=await W.restoreRecovery();await wait(80);
  ok('격자 크기 변경 전 복구본은 완료칸과 기존 격자 크기를 함께 복원한다',
    dimensionsRestored===true&&W.S.grid.rows===JSON.parse(beforeDimensions).grid.rows
    &&W.S.grid.cols===JSON.parse(beforeDimensions).grid.cols&&W.S.grid.cells.A1.s===2&&W.S.drones[0].zone==='A1');
}

async function reviewBackupLifecycle(){
  await reload();
  group('검토 보완 · 자동 보관 파일 수명');
  W.loadSample();await wait(100);
  var writes=0,closes=0,aborts=0;
  var oldHandle={createWritable:function(){return Promise.resolve({
    write:function(){writes++;return Promise.resolve();},
    close:function(){closes++;return Promise.resolve();},
    abort:function(){aborts++;return Promise.resolve();}
  });}};
  W.autoSaveHandle=oldHandle;
  var nextIncident=W.defaultState();nextIncident.mission.title='새 상황 검증';
  var switched=await W.applyStateWithMap(nextIncident,null);
  ok('다른 상황으로 전환하면 이전 자동 보관 파일 연결을 해제한다',
    switched===true&&W.autoSaveHandle===null&&writes===0);

  var resolvePicker,realPicker=W.showSaveFilePicker;
  W.showSaveFilePicker=function(){return new Promise(function(resolve){resolvePicker=resolve;});};
  W.pickAutoSaveFile();W.resetAutoSaveSession();resolvePicker(oldHandle);await wait(50);
  ok('상황 전환 전에 연 파일 선택기의 늦은 응답은 이전 파일을 재연결하지 않는다',
    W.autoSaveHandle===null&&writes===0);
  W.showSaveFilePicker=realPicker;

  var resolveWritable;
  W.autoSaveHandle={createWritable:function(){return new Promise(function(resolve){resolveWritable=resolve;});}};
  W.S.ui.autoSave=true;W.autoSaveAt=0;W.lastAutoSavedRev=-1;W.acquireEditorLock();W.autoSaveTick();
  await wait(10);
  var writeWasPending=typeof resolveWritable==='function'&&W.autoSaveBusy;
  W.resetAutoSaveSession();
  var lockedWhilePending=W.autoSaveBusy;
  resolveWritable({write:function(){writes++;return Promise.resolve();},close:function(){closes++;return Promise.resolve();},
    abort:function(){aborts++;return Promise.resolve();}});
  await wait(60);
  ok('진행 중 보관이 상황 전환 뒤 열리면 쓰기·확정을 취소하고 대기 상태를 해제한다',
    writeWasPending&&lockedWhilePending&&writes===0&&closes===0&&aborts===1
    &&W.autoSaveHandle===null&&!W.autoSaveBusy&&W.autoSaveAt===0);

  W.autoSaveHandle=oldHandle;W.prompt=function(){return '완전삭제';};
  var purged=await W.purgeIncidentData();
  ok('완전삭제는 이전 자동 보관 파일 연결도 해제한다',purged===true&&W.autoSaveHandle===null&&writes===0);
}

async function reviewEventIdentity(){
  await reload();
  group('검토 보완 · 기록 대상과 구역 정정');
  W.loadSample();await wait(100);
  W.S.events=[];W.S.crew=[];W.S.drones=W.S.drones.slice(0,2);
  W.S.drones[0].id='review-drone-one';W.S.drones[0].name='1호기';W.S.drones[0].status='ready';
  W.S.drones[1].id='review-drone-eleven';W.S.drones[1].name='11호기';W.S.drones[1].status='ready';
  W.addEvent('takeoff','11호기 이륙','',true,Date.now()-10000);W.commit();
  var legacyDroneMatches=W.stateMismatches().filter(function(m){return m.kind==='takeoff';});
  ok('구버전 11호기 이륙 기록을 1호기에 잘못 연결하지 않는다',
    legacyDroneMatches.length===1&&legacyDroneMatches[0].ref==='review-drone-eleven');
  W.S.events=[];W.S.drones[0].name='같은 이름';W.S.drones[1].name='같은 이름';
  W.addEvent('takeoff','같은 이름 이륙','',true,Date.now()-10000);W.commit();
  ok('동명이 기체의 구버전 자유문 기록은 대상을 추측해 상태 반영하지 않는다',
    W.stateMismatches().filter(function(m){return m.kind==='takeoff';}).length===0);
  W.S.events=[];W.S.drones[0].name='1호기';W.S.drones[1].name='11호기';
  W.addEvent('takeoff','선택한 기체 이륙','',true,Date.now()-10000,
    W.JSON.parse(JSON.stringify({entityType:'drone',entityId:'review-drone-eleven'})));
  W.S.drones[1].name='이름을 바꾼 기체';W.commit();
  var linkedMatches=W.stateMismatches().filter(function(m){return m.kind==='takeoff';});
  ok('기체 이름이 바뀌어도 명시한 대상 ID로 기록을 연결한다',
    linkedMatches.length===1&&linkedMatches[0].ref==='review-drone-eleven'
    &&W.migrate(W.S).events[0].entityId==='review-drone-eleven');

  gotoSection('sec-quick');
  var typeInput=W.document.getElementById('evType');typeInput.value='takeoff';
  typeInput.dispatchEvent(new W.Event('change',{bubbles:true}));
  var entityInput=W.document.getElementById('evEntity');
  ok('이륙 빠른기록에서 기체 대상을 명시적으로 선택할 수 있다',
    !!entityInput&&!entityInput.hidden&&!!Array.prototype.find.call(entityInput.options,function(option){return option.value==='review-drone-one';}));
  entityInput.value='review-drone-one';entityInput.dispatchEvent(new W.Event('change',{bubbles:true}));
  var quickText=W.document.getElementById('evText');quickText.value='대상 선택 기록';
  quickText.dispatchEvent(new W.Event('input',{bubbles:true}));
  W.document.getElementById('btnAddEv').click();
  var selectedEvent=W.S.events[W.S.events.length-1];
  ok('빠른기록 저장은 선택한 기체의 식별자를 함께 보관한다',
    selectedEvent.type==='takeoff'&&selectedEvent.entityType==='drone'&&selectedEvent.entityId==='review-drone-one');

  W.S.events=[];W.S.drones=[];W.S.grid.cells={A1:{s:2,by:''}};
  W.addEvent('zone','A1 구역 수색완료','A1',true,Date.now()-10000,
    W.JSON.parse(JSON.stringify({zoneStates:{A1:2},gridGeneration:W.S.grid.generation})));W.commit();
  gotoSection('sec-grid');W.S.ui.paintS=0;W.S.ui.paintBy=null;
  W.painting={touched:{},done:[],before:{}};
  W.paintCell(W.document.querySelector('#consMap [data-cell="A1"]'));W.finishPaint();
  ok('완료 구역을 의도적으로 미수색으로 정정하면 오래된 완료 기록을 재반영하지 않는다',
    W.S.grid.cells.A1.s===0&&!W.stateMismatches().some(function(m){return m.kind==='zone'&&m.ref==='A1';})
    &&W.S.events.some(function(event){return event.zoneStates&&event.zoneStates.A1===0;}));
  W.S.events=W.S.events.slice(0,1);W.S.grid.generation='review-new-grid';W.S.grid.cells={};W.commit();
  ok('다른 지도·격자 세대의 구역 완료 기록을 새 격자에 반영하지 않는다',
    !W.stateMismatches().some(function(m){return m.kind==='zone'&&m.ref==='A1';}));
}

async function reviewEventHistoryAndEmergency(){
  await reload();
  group('검토 보완 · 전체 이력과 긴급 경보');
  W.loadSample();await wait(100);W.S.events=[];
  var baseTime=Date.now()-60000;
  for(var index=0;index<45;index++)W.addEvent('note',index===0?'과거기록 찾기 대상':'최근기록 '+index,'',true,baseTime+index*1000);
  var oldestId=W.S.events[0].id;W.commit();gotoSection('sec-quick');
  var historyFold=W.document.querySelector('details[data-fold="event-history"]');
  if(historyFold){historyFold.open=true;await wait(10);}
  var historySearch=W.document.getElementById('eventSearch');
  historySearch.value='과거기록 찾기 대상';historySearch.dispatchEvent(new W.Event('input',{bubbles:true}));
  var oldEdit=W.document.querySelector('#eventHistory [data-act="correctevent"][data-eid="'+oldestId+'"]');
  ok('최근 30건 밖의 기록도 전체 이력 검색으로 찾아 정정할 수 있다',!!oldEdit);
  W.prompt=function(message){return message.indexOf('사유')>=0?'과거기록 검증 사유':'과거기록 정정된 내용';};
  oldEdit.click();
  var originalEvent=W.S.events.find(function(event){return event.id===oldestId;});
  ok('오래된 기록 정정은 원본 무효화·대체 내용·정정 사유를 함께 남긴다',
    originalEvent.voided&&W.S.events.some(function(event){return event.text==='과거기록 정정된 내용';})
    &&W.S.events.some(function(event){return event.type==='correction'&&event.text.indexOf('과거기록 검증 사유')>=0;}));
  historySearch=W.document.getElementById('eventSearch');historySearch.value='';
  historySearch.dispatchEvent(new W.Event('input',{bubbles:true}));
  var nextPage=W.document.querySelector('#eventHistory [data-act="eventpage"][data-page="1"]');
  if(nextPage)nextPage.click();
  var oldPage=W.document.querySelector('#eventHistory [data-act="eventpage"][data-page="2"]');
  if(oldPage)oldPage.click();
  ok('전체 기록 페이지 이동으로 첫 페이지 밖의 기록에 접근한다',
    !!nextPage&&!!oldPage&&W.eventHistory.page===2);
  var statusFilter=W.document.getElementById('eventStatusFilter');statusFilter.value='voided';
  statusFilter.dispatchEvent(new W.Event('change',{bubbles:true}));
  ok('무효 기록 필터에서 과거에 정정한 원본을 확인할 수 있다',
    W.document.getElementById('eventHistory').textContent.indexOf('과거기록 찾기 대상')>=0);

  var normalLimit=W.MAX_EVENTS;W.MAX_EVENTS=W.S.events.filter(function(event){return !event.emergency;}).length;
  var countBeforeRefused=W.S.events.length;
  ok('일반 기록 한도에서는 새 일반 기록을 거부한다',
    W.addEvent('note','한도 초과 일반 기록','',true)===false&&W.S.events.length===countBeforeRefused);
  W.S.safety.manned=false;W.commit();
  var warningLimit=W.EMERGENCY_EVENT_RESERVE;W.EMERGENCY_EVENT_RESERVE=1;
  var firstAlarm=W.setMannedAlert(true),clearAlarm=W.setMannedAlert(false),nextAlarm=W.setMannedAlert(true);
  var emergencyEvents=W.S.events.filter(function(event){return event.emergency;});
  ok('일반 한도와 긴급 보관 안내 한도를 넘어도 유인기 경보·해제를 저장한다',
    firstAlarm&&clearAlarm&&nextAlarm&&W.S.safety.manned&&emergencyEvents.length===3);
  var emergencyPackage=W.JSON.parse(W.exportPayload(true)),importAccepted=true;
  try{W.validateImportPackage(emergencyPackage);}catch(error){importAccepted=false;}
  ok('긴급 추가 기록이 포함된 백업을 다시 가져와도 기록이 누락되지 않는다',
    importAccepted&&W.migrate(emergencyPackage).events.length===W.S.events.length);
  W.MAX_EVENTS=normalLimit;W.EMERGENCY_EVENT_RESERVE=warningLimit;
}

async function reviewConsoleAndDisplay(){
  await reload();
  group('검토 보완 · 조작 흐름·확대 표출');
  W.loadSample();await wait(100);
  var root=W.document.getElementById('consoleRoot');
  var visibleSectionOrder=Array.prototype.map.call(root.querySelectorAll('.cons>.sec'),function(section){return section.id;});
  ok('현장 반복 조작을 빠른기록·기체·배터리·격자 순서로 배치한다',
    visibleSectionOrder.slice(0,4).join(',')==='sec-quick,sec-drone,sec-batt,sec-grid');
  ok('상황·실종자·인원·데이터 설정은 키보드로 여는 기본 접힘 영역이다',
    ['mission','subject','crew','data'].every(function(key){
      var fold=root.querySelector('details[data-fold="'+key+'"]');
      return !!fold&&!fold.open&&!!fold.querySelector(':scope>summary');
    }));
  gotoSection('sec-mission');
  var missionHeading=root.querySelector('#sec-mission>h2');
  ok('상단 메뉴는 접힌 설정을 열고 해당 제목으로 포커스를 이동한다',
    root.querySelector('details[data-fold="mission"]').open&&W.document.activeElement===missionHeading
    &&root.querySelector('.ct-nav [data-sec="sec-mission"]').getAttribute('aria-current')==='location');
  W.renderConsole(root);
  ok('값 저장으로 패널이 다시 그려져도 열어 둔 설정을 유지한다',
    root.querySelector('details[data-fold="mission"]').open);

  var frame=document.getElementById('app'),oldWidth=frame.style.width,oldHeight=frame.style.height;
  frame.style.width='1920px';frame.style.height='1080px';
  W.MODE='display';W.document.body.className='mode-display';
  W.document.getElementById('consoleRoot').hidden=true;W.document.getElementById('board').hidden=false;W.scrollTo(0,0);
  W.S.ui.scale=1.5;W.S.subject.missingAt=W.localDateTime(new Date(Date.now()-8*3600000));
  W.S.mission.dispatchedAt=W.localDateTime(new Date(Date.now()-6*3600000));
  W.S.safety.manned=true;W.applyUi();W.renderAll();await wait(100);
  var mapRect=W.document.getElementById('mapWrap').getBoundingClientRect();
  ok('1920×1080 글자 1.5배에서도 수색지도에 충분한 폭과 높이를 남긴다',
    mapRect.width>=480&&mapRect.height>=240,Math.round(mapRect.width)+'×'+Math.round(mapRect.height));
  var clippedKpis=Array.prototype.filter.call(W.document.querySelectorAll('.kpi-v'),function(value){
    var panel=value.closest('.kpi').getBoundingClientRect(),rect=value.getBoundingClientRect();
    return value.scrollWidth>value.clientWidth+2||rect.right>panel.right+2||rect.bottom>panel.bottom+2;
  });
  var headerBelowBanner=W.document.querySelector('#board .hdr').getBoundingClientRect().top
    >=W.document.getElementById('alertBanner').getBoundingClientRect().bottom;
  ok('글자 1.5배에서 핵심 KPI가 잘리거나 유인기 경보에 가리지 않는다',
    clippedKpis.length===0&&headerBelowBanner,
    clippedKpis.map(function(value){return value.id;}).join(', ')+(headerBelowBanner?'':'경보가 KPI 헤더를 가림'));
  var footerTop=W.document.querySelector('#board .ticker').getBoundingClientRect().top;
  var overflowingCards=Array.prototype.filter.call(W.document.querySelectorAll('#board .col>.card'),function(card){
    return card.getBoundingClientRect().bottom>footerTop+2;
  });
  ok('글자 1.5배에서도 출동 인원을 포함한 모든 카드가 하단 지휘부 지시를 침범하지 않는다',
    overflowingCards.length===0,overflowingCards.map(function(card){return card.querySelector('h2').textContent;}).join(', '));
  var firstDrone=W.document.querySelector('#droneBody .drone');
  var clippedMetrics=Array.prototype.filter.call(firstDrone.querySelectorAll('.d-rows b'),function(metric){
    return metric.scrollWidth>metric.clientWidth+2;
  });
  ok('글자 1.5배에서도 첫 기체의 비행시간·잔여시간 등 운용 수치가 생략되지 않는다',
    clippedMetrics.length===0,clippedMetrics.map(function(metric){return metric.textContent;}).join(', '));
  frame.style.width=oldWidth;frame.style.height=oldHeight;
  await reload();
}

async function reviewBatteryConfirmation(){
  await reload();
  group('검토 보완 · 배터리 수동 확인');
  W.loadSample();await wait(100);gotoSection('sec-drone');
  var batteryInput=W.document.querySelector('[data-path="drones.0.battery"]'),inputStarted=Date.now();
  batteryInput.value='87';batteryInput.dispatchEvent(new W.Event('input',{bubbles:true}));
  var recordedBatteryAt=W.S.drones[0].batteryUpdatedAt;
  await reloadReviewState();
  ok('배터리 잔량을 수동 입력한 확인시각과 값이 새로고침 후에도 남는다',
    W.S.drones[0].battery===87&&W.S.drones[0].batteryUpdatedAt===recordedBatteryAt&&recordedBatteryAt>=inputStarted);
  ok('배터리 표시는 실시간 계측처럼 보이지 않고 마지막 수동 확인 경과를 알린다',
    W.batteryStamp(W.S.drones[0],recordedBatteryAt+31*60000)==='배터리 수동 입력 · 31분 전 확인');
  gotoSection('sec-drone');batteryInput=W.document.querySelector('[data-path="drones.0.battery"]');
  batteryInput.focus();var realNow=W.Date.now;
  W.Date.now=function(){return recordedBatteryAt+6*60000;};W.refreshBatteryStamps();W.Date.now=realNow;
  var batteryLabel=W.document.querySelector('#consoleRoot [data-battery-stamp="'+W.S.drones[0].id+'"]');
  ok('조작 중에도 배터리 확인 경과만 갱신해 입력창과 키보드 포커스를 유지한다',
    batteryLabel.textContent.indexOf('6분 전')>=0&&W.document.activeElement===batteryInput
    &&W.document.querySelector('[data-path="drones.0.battery"]')===batteryInput);
  batteryInput.value='';batteryInput.dispatchEvent(new W.Event('input',{bubbles:true}));
  ok('배터리 값을 지우면 이전 확인시각도 제거해 최신 확인으로 오해하지 않게 한다',
    W.S.drones[0].batteryUpdatedAt===0&&W.batteryStamp(W.S.drones[0]).indexOf('확인시각 없음')>=0);
}
