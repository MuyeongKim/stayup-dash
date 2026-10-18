/* Shared producer fixture and real browser storage/merge regression checks. */
async function runAICandidates(){
  await reload();group('사진 후보 파일 연계');
  ok('AI 후보 가져오기 구현',typeof W.aiImportPackage==='function');
  if(typeof W.aiImportPackage!=='function')return;
  var fixture=await (await fetch('fixtures/stayup-photo-candidates-v1.json')).json();
  function clone(v){return W.JSON.parse(JSON.stringify(v));}
  function stable(v){
    if(Array.isArray(v))return '['+v.map(stable).join(',')+']';
    if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
    return JSON.stringify(v);
  }
  async function rejects(action){try{await action();return false;}catch(e){return true;}}
  await W.loadSample();await wait(250);W.S.weather.auto=false;W.commit();
  var untouched=JSON.stringify({mission:W.S.mission,grid:W.S.grid,drones:W.S.drones,crew:W.S.crew,safety:W.S.safety}),oldEvents=clone(W.S.events);
  await W.aiImportPackage(clone(fixture),false);
  ok('후보 추가는 기존 상황·지도·기체·인원·안전 상태를 보존',untouched===JSON.stringify({mission:W.S.mission,grid:W.S.grid,drones:W.S.drones,crew:W.S.crew,safety:W.S.safety}));
  ok('기존 대응 타임라인을 유지하고 AI 유형으로 요약 1건 추가',JSON.stringify(W.S.events.slice(0,oldEvents.length))===JSON.stringify(oldEvents)&&W.S.events.length===oldEvents.length+1&&W.S.events.at(-1).type==='ai'&&W.latestFound()===null);
  ok('이미지는 별도 블롭 저장소에 보관',W.S.ai.candidates.length===2&&!JSON.stringify(W.S.ai).includes('data:image')&&(await W.mapBlobGet(W.S.ai.candidates[0].thumbnailId)).startsWith('data:image/jpeg'));
  var key=W.aiKey(W.S.ai.candidates[0]);W.aiResponseDrafts[key]={note:'C3 지상팀 통보 · 유지할 대응',status:'notified'};W.aiSaveResponse(key);
  var responseEvent=clone(W.S.events.at(-1)),revision=W.S.meta.revision,count=W.S.events.length;
  await W.aiImportPackage(clone(fixture),false);
  ok('반복 파일은 후보·타임라인·상태 리비전을 중복 생성하지 않음',W.S.ai.candidates.length===2&&W.S.events.length===count&&W.S.meta.revision===revision);
  var newer=clone(fixture);newer.run.revision=2;newer.candidates[0].review='person';
  await W.aiImportPackage(newer,false);
  ok('새 판정만 갱신하고 로컬 대응 상태·메모·이력 보존',W.S.ai.candidates[0].review==='person'&&W.S.ai.candidates[0].responseNote.includes('지상팀')&&W.S.ai.candidates[0].responseStatus==='notified'&&W.S.events.some(e=>e.id===responseEvent.id));
  var before=stable(W.S);
  ok('과거 리비전 거부',await rejects(()=>W.aiImportPackage(clone(fixture),false))&&stable(W.S)===before);
  var conflict=clone(newer);conflict.candidates[0].review='hold';
  ok('같은 리비전의 다른 내용 거부',await rejects(()=>W.aiImportPackage(conflict,false))&&stable(W.S)===before);
  for(var entry of [
    ['다른 형식',p=>p.format='detections'],['미지원 버전',p=>p.version=2],
    ['좌표 범위 오류',p=>p.candidates[0].gps.lat=91],['후보 ID 중복',p=>p.candidates.push(clone(p.candidates[0]))],
    ['잘못된 이미지',p=>p.candidates[0].thumbnail='data:image/svg+xml;base64,PHN2Zz4='],
    ['픽셀 디코딩 실패',p=>p.candidates[0].thumbnail='data:image/jpeg;base64,'+W.btoa(W.atob(p.candidates[0].thumbnail.slice(23)).slice(0,200))],
    ['잘못된 촬영 시각',p=>p.candidates[0].capturedAt='2026-02-31T10:00:00'],
    ['절대 원본 경로',p=>p.candidates[0].file='/private/a.jpg']
  ]){var bad=clone(newer);entry[1](bad);ok(entry[0]+'는 전체 반영 전 거부',await rejects(()=>W.aiImportPackage(bad,false))&&stable(W.S)===before);}
  var previousConfirm=W.confirm;W.confirm=()=>false;var rejected=clone(newer);rejected.run.revision=3;
  ok('가져오기 취소 시 기존 데이터 유지',await W.aiImportPackage(rejected)===false&&stable(W.S)===before);W.confirm=previousConfirm;
  var originalPersist=W.persistCandidate;W.persistCandidate=function(){W.setSaveStatus(false,'회귀검사 저장 실패');return false;};
  var saveFailed=clone(newer);saveFailed.run.revision=3;saveFailed.candidates[0].review='hold';
  try{ok('상태 저장 실패 시 기존 후보·대응 롤백',await rejects(()=>W.aiImportPackage(saveFailed,false))&&stable(W.S)===before);}finally{W.persistCandidate=originalPersist;W.setSaveStatus(true,'');}
  var originalPut=W.mapBlobPut,canvas=W.document.createElement('canvas');canvas.width=32;canvas.height=32;canvas.getContext('2d').fillRect(0,0,32,32);
  var imageChanged=clone(newer);imageChanged.run.revision=3;imageChanged.candidates[0].thumbnail=canvas.toDataURL('image/jpeg',.6);
  W.mapBlobPut=function(id,data){if(id.startsWith(W.AI_IMAGE_PREFIX))return W.Promise.reject(new Error('이미지 저장 실패'));return originalPut(id,data);};
  try{ok('이미지 저장 실패도 기존 기록 보존',await rejects(()=>W.aiImportPackage(imageChanged,false))&&stable(W.S)===before);}finally{W.mapBlobPut=originalPut;}
  W.mapBlobPut=async function(id,data){await originalPut(id,data);W.fileMutationSeq++;};
  try{ok('늦게 끝난 파일은 새 파일 선택 후 반영하지 않음',await rejects(()=>W.aiImportPackage(imageChanged,false))&&stable(W.S)===before);}finally{W.mapBlobPut=originalPut;}
  W.mapBlobPut=async function(id,data){await originalPut(id,data);await W.gcMapBlobs();};
  try{await W.aiImportPackage(imageChanged,false);ok('가져오기 중 이미지 GC도 저장 중인 본체를 보존',!!(await W.mapBlobGet(W.S.ai.candidates[0].thumbnailId))&&Object.keys(W.aiStaging).length===0);}finally{W.mapBlobPut=originalPut;}
  await W.gcMapBlobs();
  ok('이미지 GC 후에도 현재 후보 미리보기 유지',!!(await W.mapBlobGet(W.S.ai.candidates[0].thumbnailId)));
  var backup=clone(JSON.parse(W.exportPayload(true))),missingImage=clone(backup);delete missingImage.aiImages;
  ok('이미지 빠진 새 백업은 명시적으로 거부',await rejects(()=>W.validateImportPackage(missingImage)));
  W.validateImportPackage(backup);
  ok('구형 백업은 AI 필드 없이도 호환',(()=>{var legacy=clone(backup);legacy.meta.v=2;delete legacy.ai;delete legacy.aiImages;W.validateImportPackage(legacy);return W.migrate(legacy).ai.candidates.length===0;})());
  await W.applyStateWithMap(W.defaultState(),null,W.stateLifecycleSeq,W.SESSION_EPOCH,++W.fileMutationSeq);await W.mapBlobClear();
  ok('후보 본체까지 포함한 백업을 새 저장소에 복원',await W.applyStateWithMap(backup,null,W.stateLifecycleSeq,W.SESSION_EPOCH,++W.fileMutationSeq)&&W.S.ai.candidates[0].responseNote.includes('지상팀')&&!!(await W.mapBlobGet(W.S.ai.candidates[0].thumbnailId)));
  W.S.grid.geo={north:35.1,south:34.9,west:126.9,east:127.1,src:'manual'};W.S.grid.spatialReview=false;W.commit();
  ok('보정된 지도에서는 GPS 후보만 표시',!!W.aiLocation(W.S.ai.candidates[0]).point&&W.aiLocation(W.S.ai.candidates[1]).point===null);
  var outside=clone(W.S.ai.candidates[0]);outside.gps={lat:36,lon:128};
  ok('범위 밖 좌표를 지도 가장자리에 강제로 붙이지 않음',W.aiLocation(outside).point===null);
  var geo=W.S.grid.geo;W.S.grid.geo=null;ok('지도 미보정 시 위치 목록으로 유지',W.aiLocation(W.S.ai.candidates[0]).point===null);W.S.grid.geo=geo;
  var third=clone(newer);third.run.revision=4;var samePhoto=clone(third.candidates[0]);samePhoto.id='p1-person-2';third.candidates.push(samePhoto);
  await W.aiImportPackage(third,false);W.renderAll();
  ok('같은 사진의 후보는 지도 한 지점으로 묶음',W.document.querySelectorAll('#consMap .ai-map-pin').length===1&&W.document.querySelector('#consMap .ai-map-pin').textContent==='AI 2');
  var sdk=W.onlineSDK;onlineMapInstallSdk(false);W.saveOnlineKeys({naver:'regression_key',google:''});W.S.grid.source='naver';W.commit();await wait(250);
  ok('온라인 지도에서도 후보 사진 지점 레이어 표시',W.onlineMapReady(W.document.getElementById('consMap'))&&W.document.querySelectorAll('#consMap .ai-map-pin').length===1);
  W.S.grid.source='image';W.commit();W.onlineSDK=sdk;W.localStorage.removeItem(W.ONLINE_KEYS_KEY);
  var withdrawn=clone(third);withdrawn.run.revision=5;withdrawn.candidates=[];await W.aiImportPackage(withdrawn,false);
  ok('원본에서 빠진 후보도 대응 기록을 삭제하지 않음',W.S.ai.candidates.length===3&&W.S.ai.candidates[0].sourceMissing&&W.S.ai.candidates[0].responseNote.includes('지상팀'));
  var nextRun=clone(fixture);nextRun.run.id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';await W.aiImportPackage(nextRun,false);
  ok('다른 작업의 동일 후보 ID는 충돌하지 않음',W.S.ai.candidates.length===5&&W.S.ai.runs.length===2);
  var frame=document.getElementById('app'),oldWidth=frame.style.width;frame.style.width='390px';W.renderAll();await wait(80);
  ok('390px 화면에서 AI 후보 조작 영역 가로 넘침 없음',W.document.documentElement.scrollWidth<=W.innerWidth+1);frame.style.width=oldWidth;
  await W.applyStateWithMap(W.defaultState(),null,W.stateLifecycleSeq,W.SESSION_EPOCH,++W.fileMutationSeq);await W.mapBlobClear();
  ok('완전삭제 경로가 후보 이미지 캐시도 비움',Object.keys(W.aiCache).length===0&&!((await W.mapBlobKeys()).some(id=>id.startsWith(W.AI_IMAGE_PREFIX))));
}
