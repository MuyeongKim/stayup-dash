/* UI/UX regressions exercise operator-visible behavior in the isolated HTTP iframe. */
'use strict';

async function runUiUxFixes(){
  await uxRepeatedActions();
  await uxMapPinKeyboard();
  await uxQuickRecordAndValidation();
  await uxCanonicalValueUpdates();
  await uxVerdictGuidance();
  await uxDroneRiskVisibility();
  await uxMobileNavigation();
  await uxFarView();
}

function uxInput(selector,value,eventName){
  var el=W.document.querySelector(selector);
  if(!el)throw new Error('UI regression input missing: '+selector);
  el.value=value;el.dispatchEvent(new W.Event(eventName||'input',{bubbles:true}));
  return el;
}

function uxButton(selector){
  var el=W.document.querySelector(selector);
  if(!el)throw new Error('UI regression button missing: '+selector);
  el.focus();el.click();return el;
}

async function uxRepeatedActions(){
  await reload();W.loadSample();await wait(100);
  group('UI/UX · 반복 조작의 대상·포커스 유지');
  gotoSection('sec-drone');
  var root=W.document.getElementById('consoleRoot');
  var secondId=W.S.drones[1].id,firstBefore=JSON.stringify(W.S.drones[0].sensors.slice().sort());
  var secondBefore=JSON.stringify(W.S.drones[1].sensors.slice().sort());
  var fold=root.querySelector('details[data-fold="drone-'+secondId+'"]');
  fold.open=true;await wait(20);
  uxButton('[data-act="sens"][data-di="1"][data-s="IR"]');await wait(30);
  var active=W.document.activeElement;
  ok('2호기 센서 변경 후 같은 기체·같은 센서 버튼으로 포커스를 복원한다',
    active&&active.getAttribute('data-act')==='sens'&&active.getAttribute('data-di')==='1'
    &&active.getAttribute('data-s')==='IR');
  active.click();await wait(30);
  ok('복원된 버튼을 다시 눌러도 다른 기체의 센서를 변경하지 않는다',
    JSON.stringify(W.S.drones[0].sensors.slice().sort())===firstBefore
    &&JSON.stringify(W.S.drones[1].sensors.slice().sort())===secondBefore);

  W.S.drones[0].status='ready';W.S.drones[0].tookOffAt='';
  W.S.drones[1].status='ready';W.S.drones[1].tookOffAt='';W.commit();
  uxButton('[data-act="takeoff"][data-di="1"]');await wait(30);
  active=W.document.activeElement;
  var targetItem=active&&active.closest('.item[data-di]');
  ok('이륙 버튼이 비활성화되면 다른 기체 버튼으로 포커스를 보내지 않는다',
    W.S.drones[1].status==='flying'&&W.S.drones[0].status==='ready'
    &&targetItem&&targetItem.getAttribute('data-di')==='1'
    &&active.getAttribute('data-act')!=='land');
}

async function uxMapPinKeyboard(){
  await reload();W.loadSample();await wait(100);gotoSection('sec-grid');
  group('UI/UX · 지도 핀의 키보드 조작·취소');
  W.S.grid.cells={A1:{s:2,by:'드론'},B2:{s:1,by:'소방'}};W.commit();
  var cellBefore=JSON.stringify(W.S.grid.cells),eventsBefore=W.S.events.length;
  uxButton('[data-act="pin"][data-p="found"]');await wait(20);
  var status=W.document.getElementById('mapModeStatus');
  ok('핀 배치 중인 대상과 취소 방법을 지도 옆에 표시한다',
    !!status&&status.textContent.indexOf('발견')>=0&&!!status.querySelector('[data-act="cancelpin"]'));
  var cell=W.document.querySelector('#consMap [data-cell="B2"]');
  cell.focus();cell.click();await wait(30);
  var expectedX=(1.5/W.gridCols())*100,expectedY=(1.5/W.gridRows())*100;
  ok('키보드로 칸을 선택하면 발견 핀을 칸 중심에 놓고 수색 상태를 보존한다',
    W.S.grid.pinFound&&Math.abs(W.S.grid.pinFound.x-expectedX)<0.11
    &&Math.abs(W.S.grid.pinFound.y-expectedY)<0.11
    &&JSON.stringify(W.S.grid.cells)===cellBefore&&W.S.events.length===eventsBefore&&W.pinMode===null);
  var foundBefore=JSON.stringify(W.S.grid.pinFound);
  uxButton('[data-act="pin"][data-p="last"]');await wait(10);
  W.document.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(20);
  ok('Escape로 핀 배치를 취소해도 기존 핀과 수색 기록을 변경하지 않는다',
    W.pinMode===null&&JSON.stringify(W.S.grid.pinFound)===foundBefore
    &&JSON.stringify(W.S.grid.cells)===cellBefore&&W.S.events.length===eventsBefore);
  uxButton('[data-act="pin"][data-p="found"]');await wait(10);
  uxButton('[data-act="cancelpin"]');await wait(20);
  ok('지도 취소 버튼도 핀 배치 모드를 종료하고 기존 발견 핀을 보존한다',
    W.pinMode===null&&JSON.stringify(W.S.grid.pinFound)===foundBefore);
}

async function uxQuickRecordAndValidation(){
  await reload();W.loadSample();await wait(100);gotoSection('sec-quick');
  group('UI/UX · 기록 시각과 입력 오류 복구');
  var root=W.document.getElementById('consoleRoot');
  var beforeEvents=W.S.events.length;
  uxInput('#evType','takeoff','change');
  uxInput('#evEntity','','change');uxInput('#evText','대상 없는 기록');
  uxButton('#btnAddEv');await wait(20);
  var entity=W.document.getElementById('evEntity');
  var described=entity.getAttribute('aria-describedby');
  ok('기체 대상이 빠진 기록은 저장하지 않고 오류 설명과 대상 선택창으로 안내한다',
    W.S.events.length===beforeEvents&&W.document.activeElement===entity
    &&entity.getAttribute('aria-invalid')==='true'&&described
    &&!!W.document.getElementById(described.split(/\s+/)[0]));

  var droneBefore=JSON.stringify(W.S.drones[0]);
  uxInput('#evEntity',W.S.drones[0].id,'change');
  uxInput('#evTimeMode','custom','change');
  var customAt=W.localDateTime(new Date(Date.now()-70*60000));
  uxInput('#evTime',customAt);uxInput('#evText','사후 이륙 이력 확인');
  var label=W.document.getElementById('evTimeLabel');
  ok('사후 입력을 고르면 사건 발생시각 입력이 나타난다',label&&!label.hidden);
  var buttonText=W.document.getElementById('btnAddEv').textContent;
  uxButton('#btnAddEv');await wait(30);
  var saved=W.S.events[W.S.events.length-1];
  ok('이력만 기록은 선택한 과거 시각을 보존하고 기체 운용 상태를 바꾸지 않는다',
    buttonText.indexOf('이력만 기록')>=0&&saved.text==='사후 이륙 이력 확인'
    &&saved.t===W.tms(customAt)&&JSON.stringify(W.S.drones[0])===droneBefore);
  var mode=W.document.getElementById('evTimeMode');
  ok('저장 후 다음 기록은 현재 시각 모드로 돌아가 이전 과거 시각을 재사용하지 않는다',
    mode.value==='now'&&W.quickEv.timeAuto&&W.document.getElementById('evTimeLabel').hidden);
  uxInput('#evType','note','change');uxInput('#evText','현재 시각 기록');
  var nowBefore=Date.now();uxButton('#btnAddEv');await wait(20);
  saved=W.S.events[W.S.events.length-1];
  ok('현재 시각 기록은 제출 순간을 기록 시각으로 사용한다',
    saved.text==='현재 시각 기록'&&saved.t>=nowBefore&&saved.t<=Date.now());

  gotoSection('sec-drone');
  var battery=uxInput('[data-path="drones.0.battery"]','101');
  described=battery.getAttribute('aria-describedby');
  var error=described&&W.document.getElementById(described.split(/\s+/)[0]);
  ok('범위 밖 배터리 값은 한계 설명과 연결하고 정상 잔량으로 저장하지 않는다',
    battery.getAttribute('aria-invalid')==='true'&&error&&error.textContent.indexOf('100')>=0
    &&W.S.drones[0].battery===null&&W.S.drones[0].batteryUpdatedAt===0);
  W.renderConsole(root);
  battery=root.querySelector('[data-path="drones.0.battery"]');
  ok('다른 화면 갱신 뒤에도 미해결 숫자 입력과 오류 설명을 유지한다',
    battery.value==='101'&&battery.getAttribute('aria-invalid')==='true');
  battery=uxInput('[data-path="drones.0.battery"]','87');
  ok('유효한 값으로 고치면 오류 상태를 해제하고 저장을 재개한다',
    W.S.drones[0].battery===87&&battery.getAttribute('aria-invalid')!=='true');
  uxInput('[data-path="drones.0.battery"]','101');
  W.loadSample();await wait(100);
  battery=W.document.querySelector('[data-path="drones.0.battery"]');
  ok('상황을 바꾸면 이전 상황의 잘못된 입력 초안이 새 기체 값에 남지 않는다',
    battery.value===String(W.S.drones[0].battery)&&battery.value!=='101'
    &&battery.getAttribute('aria-invalid')!=='true');
}

async function uxVerdictGuidance(){
  await reload();await wait(30);
  group('UI/UX · 판정 이유와 해결 항목 연결');
  var root=W.document.getElementById('consoleRoot');
  var reason=root.querySelector('#consoleVerdictReason'),verdict=W.flightVerdict(new Date());
  ok('미확인 상태의 판정 이유를 툴팁을 열지 않아도 조작 화면에서 읽을 수 있다',
    reason&&reason.textContent.trim().length>0&&verdict.why.some(function(why){return reason.textContent.indexOf(why)>=0;}));
  var help=root.querySelector('#verdictHelp');help.open=true;await wait(20);
  var action=help.querySelector('[data-act="verdictnav"][data-sec="sec-mission"]');
  if(!action)throw new Error('좌표 미확인 판정의 상황 입력 바로가기 없음');
  action.focus();action.click();await wait(30);
  var target=root.querySelector('#sec-mission'),active=W.document.activeElement;
  ok('판정 해결 버튼은 접힌 입력 영역을 열고 해당 입력 또는 제목에 포커스를 둔다',
    root.querySelector('details[data-fold="mission"]').open&&target.contains(active));
}

async function uxCanonicalValueUpdates(){
  await reload();
  group('UI/UX · 확정 값으로 잘못된 입력 초안 해제');
  W.S.mission.lat=35;W.S.mission.lon=127;W.S.mission.coordsConfirmedAt=Date.now();
  W.S.crew.push({id:'ux-active-crew',name:'검증 대원',role:'조종',
    inAt:W.localDateTime(new Date(Date.now()-3600000)),outAt:''});W.commit();
  gotoSection('sec-crew');
  var invalidOut=W.localDateTime(new Date(Date.now()-7200000));
  var out=uxInput('[data-path="crew.0.outAt"]',invalidOut);
  var outWasInvalid=out.getAttribute('aria-invalid')==='true';
  uxButton('[data-act="endcrew"][data-ci="0"]');await wait(30);
  out=W.document.querySelector('[data-path="crew.0.outAt"]');
  ok('잘못된 종료시각을 입력한 뒤 교대 종료하면 확정 시각을 표시하고 이전 오류를 해제한다',
    outWasInvalid&&W.S.crew[0].outAt!==''&&W.S.crew[0].outAt!==invalidOut
    &&out.value===W.S.crew[0].outAt&&out.getAttribute('aria-invalid')!=='true');

  gotoSection('sec-safety');
  var wind=uxInput('[data-path="weather.wind"]','999');
  var windWasInvalid=wind.getAttribute('aria-invalid')==='true';
  var originalFetch=W.fetch;
  W.fetch=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve({
    current:{time:Math.floor(Date.now()/1000),temperature_2m:20,
      wind_speed_10m:3,wind_gusts_10m:4,precipitation:0}
  });}});};
  try{W.fetchWeather(true);await wait(150);}finally{W.fetch=originalFetch;}
  wind=W.document.querySelector('[data-path="weather.wind"]');
  ok('잘못된 풍속 입력 뒤 기상 갱신에 성공하면 새 관측값을 표시하고 이전 오류를 해제한다',
    windWasInvalid&&W.S.weather.wind===3&&wind.value==='3'
    &&wind.getAttribute('aria-invalid')!=='true'&&!W.wxBusy);
}

async function uxDroneRiskVisibility(){
  await reload();W.loadSample();await wait(100);
  group('UI/UX · 스크롤 밖 기체 위험의 상시 표출');
  var frame=document.getElementById('app'),oldWidth=frame.style.width,oldHeight=frame.style.height;
  frame.style.width='1920px';frame.style.height='1080px';
  var now=Date.now();
  W.S.drones.forEach(function(d){d.battery=80;d.batteryUpdatedAt=now;d.status='flying';d.tookOffAt=W.localDateTime(new Date(now-10*60000));});
  var third=W.S.drones[2];third.battery=15;
  W.S.ui.scale=1.5;W.MODE='display';W.document.body.className='mode-display';
  W.document.getElementById('consoleRoot').hidden=true;W.document.getElementById('board').hidden=false;
  W.applyUi();W.renderAll();W.scrollTo(0,0);await wait(100);
  var summary=W.document.getElementById('droneRiskSummary');
  var warning=summary&&summary.querySelector('[data-drone-risk-id="'+third.id+'"]');
  var summaryBox=summary&&summary.getBoundingClientRect();
  ok('150% 표출에서도 세 번째 저배터리 기체와 잔량이 목록 밖 위험 요약에 보인다',
    warning&&warning.textContent.indexOf(third.name)>=0&&warning.textContent.indexOf('15')>=0
    &&summaryBox.height>0&&summaryBox.top>=0&&summaryBox.bottom<W.innerHeight
    &&!W.document.getElementById('droneBody').contains(summary));
  var item=W.document.querySelector('#droneBody .drone[data-id="'+third.id+'"]');
  warning.focus();warning.click();await wait(30);
  var listBox=W.document.getElementById('droneBody').getBoundingClientRect(),itemBox=item.getBoundingClientRect();
  ok('위험 요약을 누르면 해당 기체로 목록을 이동하고 포커스를 연결한다',
    W.document.activeElement===item&&itemBox.top>=listBox.top-2&&itemBox.top<listBox.bottom);
  var sameWarning=summary.querySelector('[data-drone-risk-id="'+third.id+'"]');sameWarning.focus();
  W.refreshDroneRisks(now+6*60000);
  ok('위험 시간 갱신은 버튼과 키보드 포커스를 유지하면서 오래된 확인을 알린다',
    summary.querySelector('[data-drone-risk-id="'+third.id+'"]')===sameWarning
    &&W.document.activeElement===sameWarning&&sameWarning.textContent.indexOf('확인')>=0);
  third.battery=80;third.batteryUpdatedAt=Date.now();W.refreshDroneRisks();
  ok('저배터리 원인이 해결되면 해당 위험 항목을 제거한다',
    !summary.querySelector('[data-drone-risk-id="'+third.id+'"]'));
  frame.style.width=oldWidth;frame.style.height=oldHeight;await reload();
}

async function uxMobileNavigation(){
  await reload();W.loadSample();await wait(100);
  group('UI/UX · 좁은 화면 탐색과 판정 유지');
  var frame=document.getElementById('app'),oldWidth=frame.style.width,oldHeight=frame.style.height;
  frame.style.width='390px';frame.style.height='844px';await wait(100);
  var root=W.document.getElementById('consoleRoot');
  var nav=root.querySelector('.mobile-nav'),compact=root.querySelector('.mobile-verdict');
  W.scrollTo(0,1400);await wait(30);
  var navBox=nav.getBoundingClientRect(),compactBox=compact.getBoundingClientRect();
  ok('390px 화면을 내려도 하단 탐색과 짧은 판정 상태를 화면 안에 유지한다',
    navBox.height>0&&navBox.bottom<=W.innerHeight+2&&navBox.top>=0
    &&compactBox.height>0&&compactBox.top>=0&&compactBox.bottom<W.innerHeight
    &&W.document.documentElement.scrollWidth<=W.innerWidth+1);
  var droneNav=nav.querySelector('[data-act="nav"][data-sec="sec-drone"]');
  droneNav.focus();droneNav.click();await wait(30);
  ok('모바일 기체 메뉴는 드론 운용 영역과 제목 포커스로 이동한다',
    root.querySelector('#sec-drone').contains(W.document.activeElement));
  uxButton('#btnMoreNav');await wait(20);
  var more=root.querySelector('#mobileMore');
  ok('모바일 더보기로 나머지 설정 메뉴를 키보드에서도 펼칠 수 있다',
    more&&!more.hidden&&root.querySelector('#btnMoreNav').getAttribute('aria-expanded')==='true');
  frame.style.width=oldWidth;frame.style.height=oldHeight;await reload();
}

async function uxFarView(){
  await reload();W.loadSample();await wait(100);
  group('UI/UX · 원거리 표출 설정 보존');
  var root=W.document.getElementById('consoleRoot');
  var preset=root.querySelector('[data-path="ui.viewPreset"]');
  var hiddenParent=preset.closest('details');if(hiddenParent)hiddenParent.open=true;
  uxInput('[data-path="ui.viewPreset"]','far');await wait(30);
  ok('원거리 표출을 선택하면 저장 상태와 표출 화면에 적용한다',
    W.S.ui.viewPreset==='far'&&W.document.getElementById('board').classList.contains('far-view'));
  await reloadReviewState();
  ok('브라우저를 새로 열어도 선택한 원거리 표출을 유지한다',
    W.S.ui.viewPreset==='far'&&W.document.getElementById('board').classList.contains('far-view'));
  var preserved=W.migrate(W.S);preserved.ui.viewPreset='unexpected';
  ok('지원하지 않는 표출 설정은 기본 보기로 안전하게 정규화한다',
    W.migrate(preserved).ui.viewPreset==='standard');
}
