/* Folder permission errors and async boundaries are injected; filesystem E2E
   lives in ai-folder-browser.mjs and uses an actual Chrome directory handle. */
async function runAIFolder(){
  await reload();group('같은 PC 사진 후보 폴더 연결');
  ok('자동 폴더 읽기 구현',typeof W.aiFolderConnect==='function');
  if(typeof W.aiFolderConnect!=='function')return;
  var base=await (await fetch('fixtures/stayup-photo-candidates-v1.json')).json(),files={},permission='granted',reads=0;
  function clone(v){return W.JSON.parse(JSON.stringify(v));}
  function put(name,pack){files[name]=JSON.stringify(pack);}
  var name='stayup-ai-candidates-'+base.run.id+'.json';put(name,base);
  var handle={name:'현장 후보',queryPermission:async()=>permission,async *entries(){
    for(let name of Object.keys(files))yield [name,{kind:'file',getFile:async()=>({size:files[name].length,text:async()=>{reads++;return files[name];}})}];
  }};
  var picker=W.showDirectoryPicker,options;
  W.showDirectoryPicker=async opt=>{options=opt;return handle;};
  try{
    W.S.mission.title='보존할 상황';W.commit();var events=W.S.events.length;
    await W.aiFolderConnect();
    ok('폴더는 읽기 전용으로 선택하고 최초 후보 반영',options.mode==='read'&&W.S.ai.candidates.length===2&&W.S.mission.title==='보존할 상황');
    var count=W.S.events.length,revision=W.S.meta.revision;
    await W.aiFolderPoll();
    ok('반복 확인은 후보·이력·상태 버전을 늘리지 않음',W.S.events.length===count&&W.S.meta.revision===revision&&count===events+1);
    var key=W.aiKey(W.S.ai.candidates[0]);W.aiResponseDrafts[key]={note:'자동 갱신에도 보존',status:'notified'};W.aiSaveResponse(key);
    var newer=clone(base);newer.run.revision++;newer.candidates[0].review='hold';put(name,newer);
    files['other-backup.json']='bad';files['stayup-ai-candidates-junk.json']='bad';
    files['stayup-ai-candidates.json']='{broken';
    await W.aiFolderPoll();
    ok('잘못된 파일을 제외하고 새 판정·대응 보존',W.S.ai.candidates[0].review==='hold'&&W.S.ai.candidates[0].responseNote==='자동 갱신에도 보존'&&W.aiFolder.message.includes('오류 1'));
    var second=clone(base);second.run.id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';put('stayup-ai-candidates-'+second.run.id+'.json',second);
    await W.aiFolderPoll();ok('여러 분석 작업은 누적',W.S.ai.runs.length===2&&W.S.ai.candidates.length===4);
    delete files[name];delete files['stayup-ai-candidates.json'];await W.aiFolderPoll();
    ok('폴더 파일 삭제는 후보·대응을 삭제하지 않음',W.S.ai.candidates.length===4&&W.S.ai.candidates[0].responseNote==='자동 갱신에도 보존');
    var earlier=clone(base);put(name,earlier);await W.aiFolderPoll();
    ok('과거 파일 거부·오류 표시 후 최신 판정 유지',W.S.ai.candidates[0].review==='hold'&&W.aiFolder.message.includes('오류 1'));
    W.aiFolderStop();var oldCount=W.S.events.length;put(name,newer);await W.aiFolderPoll();
    ok('연결 해제는 이후 읽기를 중단·기존 기록 유지',!W.aiFolder.session&&W.S.events.length===oldCount);
    await W.aiFolderConnect();permission='denied';await W.aiFolderPoll();
    ok('권한 회수 시 연결 해제와 수동 안내',!W.aiFolder.session&&W.aiFolder.message.includes('권한'));
    permission='granted';await W.aiFolderConnect();
    var oldText=handle.entries,release,entered;
    handle.entries=async function*(){yield [name,{kind:'file',getFile:async()=>({size:10,text:()=>new W.Promise(resolve=>{entered=true;release=resolve;})})}];};
    var pending=W.aiFolderPoll();while(!entered)await wait(10);await W.aiFolderPoll();
    ok('진행 중인 폴더 확인을 겹쳐 실행하지 않음',W.aiFolder.session.busy);
    W.aiFolderStop();release(JSON.stringify(second));await pending;
    ok('해제 전 시작한 늦은 파일은 반영하지 않음',!W.aiFolder.session&&W.S.events.length===oldCount);
    var cancelImage=clone(newer),canvas=W.document.createElement('canvas');canvas.width=16;canvas.height=16;
    canvas.getContext('2d').fillRect(0,0,16,16);cancelImage.run.revision++;
    cancelImage.candidates[0].thumbnail=canvas.toDataURL('image/jpeg',.6);
    handle.entries=async function*(){yield [name,{kind:'file',getFile:async()=>({size:100,text:async()=>JSON.stringify(cancelImage)})}];};
    var originalPut=W.mapBlobPut;
    W.mapBlobPut=async function(id,data){await originalPut(id,data);W.aiFolderStop();};
    try{await W.aiFolderConnect();ok('이미지 저장 중 해제해도 후보·이력을 반영하지 않고 예약 해제',!W.aiFolder.session&&W.S.events.length===oldCount&&Object.keys(W.aiStaging).length===0);}finally{W.mapBlobPut=originalPut;}
    handle.entries=oldText;await W.aiFolderConnect();
    W.resetAutoSaveSession(true);ok('같은 상황의 백업 파일 재지정은 후보 폴더 연결 유지',!!W.aiFolder.session);
    W.resetAutoSaveSession();ok('상황 교체 경로는 자동 읽기 연결도 해제',!W.aiFolder.session);
    await W.aiFolderConnect();W.confirm=()=>false;await W.aiReadFile({size:10,text:async()=>JSON.stringify(second)});
    ok('수동 불러오기는 자동 연결 해제 후 기존 확인 절차 유지',!W.aiFolder.session&&W.S.ai.runs.length===2);
    W.confirm=()=>true;await W.aiFolderConnect();
    var lock=W.ownsEditorLock;W.ownsEditorLock=()=>false;await W.aiFolderPoll();W.ownsEditorLock=lock;
    ok('편집권 상실 시 자동 연결 중지',!W.aiFolder.session);
    W.showDirectoryPicker=async()=>{throw new W.DOMException('cancel','AbortError');};await W.aiFolderConnect();
    ok('폴더 선택 취소 시 기록 불변',W.S.ai.runs.length===2&&!W.aiFolder.session);
    W.showDirectoryPicker=async()=>handle;
    permission='denied';await W.aiFolderConnect();
    ok('최초 연결 권한 거부도 기존 기록 보존',!W.aiFolder.session&&W.S.ai.runs.length===2);permission='granted';
    var originalEntries=handle.entries,tooLargeRead=false;
    handle.entries=async function*(){yield [name,{kind:'file',getFile:async()=>({size:W.AI_MAX_BYTES+1,text:async()=>{tooLargeRead=true;return '{}';}})}];};
    await W.aiFolderConnect();
    ok('개별 한도 초과 파일은 본문 읽기 없이 거부',!tooLargeRead&&W.aiFolder.message.includes('오류 1'));
    W.aiFolderStop();handle.entries=async function*(){
      for(let i=0;i<5;i++)yield ['stayup-ai-candidates-00000000-0000-4000-8000-'+String(i).padStart(12,'0')+'.json',{kind:'file',getFile:async()=>({size:W.AI_MAX_BYTES,text:async()=>{throw Error('읽으면 안 됨');}})}];
    };
    await W.aiFolderConnect();ok('폴더 전체 바이트 한도는 반영 전 중단',!W.aiFolder.session&&W.aiFolder.message.includes('64 MiB')&&W.S.ai.runs.length===2);
    handle.entries=async function*(){
      for(let i=0;i<501;i++)yield ['stayup-ai-candidates-00000000-0000-4000-8000-'+String(i).padStart(12,'0')+'.json',{kind:'file',getFile:async()=>({size:0,text:async()=>''})}];
    };
    await W.aiFolderConnect();ok('파일 500개 한도는 기존 상황을 바꾸기 전 중단',!W.aiFolder.session&&W.aiFolder.message.includes('500개')&&W.S.ai.runs.length===2);
    handle.entries=originalEntries;W.showDirectoryPicker=undefined;await W.aiFolderConnect();
    ok('미지원 브라우저는 수동 불러오기 안내',!W.aiFolder.session&&W.aiFolder.message.includes('수동 불러오기'));
    var frame=document.getElementById('app'),width=frame.style.width;frame.style.width='390px';W.aiFolder.message='자동 읽기 오류 · '+String('a').repeat(200);W.renderAll();await wait(50);
    ok('390px에서 폴더 연결 버튼·상태 가로 넘침 없음',W.document.documentElement.scrollWidth<=W.innerWidth+1);frame.style.width=width;
    ok('폴더 핸들은 백업에 포함되지 않음',!W.exportPayload(true).includes('queryPermission')&&!W.exportPayload(true).includes('현장 후보'));
  }finally{W.aiFolderStop();W.showDirectoryPicker=picker;}
}
