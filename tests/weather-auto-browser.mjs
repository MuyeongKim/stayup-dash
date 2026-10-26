/* Weather triggers and safety boundaries in real Chrome. Network responses are
 * controlled fixtures; coordinates and photos are synthetic, never staff data. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-weather-auto';await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=process.argv.includes('--file')?pathToFileURL(path.join(root,'stayup-dash.html')).href:'http://127.0.0.1:'+server.address().port+'/stayup-dash.html';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1366,height:900},serviceWorkers:'block',reducedMotion:'reduce'});
const results=[],errors=[],requests=[],gates=[],answers=[],dialogs=[];
let response={mode:'ok',wind:4,gust:6,temp:21},viewer=null,practice=null;
await context.route('**/*',async route=>{
  const request=route.request(),address=new URL(request.url());
  if(address.hostname==='api.open-meteo.com'){
    const reply={...response},time=Math.floor(Date.now()/1000)-(reply.mode==='stale'?31*60:0);
    requests.push({url:address.href,window:request.frame().page()===viewer?'viewer':request.frame().page()===practice?'practice':'owner'});
    if(reply.mode==='hold')await new Promise(resolve=>gates.push(resolve));
    const body=reply.mode==='badjson'?'{broken':JSON.stringify(reply.mode==='missing'?{current:{}}:{current:{time,temperature_2m:reply.temp,wind_speed_10m:reply.wind,wind_gusts_10m:reply.gust,precipitation:0},hourly:{time:[time],precipitation_probability:[10]}});
    try{await route.fulfill({status:reply.mode==='fail'?503:200,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body});}catch{}
    return;
  }
  return address.protocol==='file:'||address.hostname==='127.0.0.1'?route.continue():route.abort();
});
const page=await context.newPage();page.setDefaultTimeout(7000);
const observe=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('dialog',async d=>{dialogs.push(d.message());const accept=answers.length?answers.shift():true;await(accept?d.accept():d.dismiss());});};observe(page);
const check=(name,pass)=>{results.push({name,pass:!!pass});console.log((pass?'PASS ':'FAIL ')+name);};
const payload=()=>page.evaluate(()=>JSON.parse(exportPayload(true)));
const core=value=>{const c=JSON.parse(JSON.stringify(value));delete c.meta;delete c.weather;return c;};
const release=()=>{for(const done of gates.splice(0))done();};
const waitRequests=async n=>{const end=Date.now()+7000;while(requests.length<n&&Date.now()<end)await page.waitForTimeout(25);assert.ok(requests.length>=n,'Expected weather request '+n);};
const received=()=>page.waitForFunction(()=>!wxBusy&&S.weather.src==='auto'&&!S.weather.error);
async function reconnect(){await context.setOffline(true);await page.waitForFunction(()=>navigator.onLine===false);await context.setOffline(false);await page.waitForFunction(()=>navigator.onLine===true);}
try{
  await page.goto(url);await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  await page.locator('[data-onboard-action="new"]').click();await page.locator('[data-path="mission.title"]').fill('가상 기상 자동 조회 검증');await page.locator('[data-path="mission.title"]').press('Tab');await page.waitForFunction(()=>!consoleIdleTimer);
  await page.locator('#tab-data').click();await page.locator('[data-path="ui.autoSave"]').uncheck();await page.locator('#tab-safety').click();
  check('위치 미확인에서는 조회하지 않고 위치 입력 경로 안내',requests.length===0&&await page.locator('[data-weather-query]').getAttribute('data-weather-state')==='location'&&await page.locator('[data-weather-location]').isVisible());
  const beforeLocation=await payload();await page.locator('[data-weather-location]').click();check('기상 안내의 위치 이동은 입력 위치만 열고 업무 자료 보존',await page.locator('[data-path="mission.lat"]').evaluate(e=>e===document.activeElement)&&isDeepStrictEqual(await payload(),beforeLocation));
  await page.locator('#tab-grid').click();const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=400;c.height=250;c.getContext('2d').fillRect(0,0,400,250);return c.toDataURL('image/png').split(',')[1];}),photo=path.join(out,'synthetic-map.png');await writeFile(photo,Buffer.from(png,'base64'));
  const choose=page.waitForEvent('filechooser');choose.catch(()=>{});await page.getByRole('button',{name:'지도·현장 사진 넣기',exact:true}).click();await(await choose).setFiles(photo);await page.waitForFunction(()=>mapPayloadReady());
  await page.locator('#tab-mission').click();await page.locator('[data-path="mission.lat"]').fill('35.8899');await page.locator('[data-path="mission.lon"]').fill('127.2211');check('좌표 입력만으로 외부 기상 조회를 시작하지 않음',requests.length===0);
  response={mode:'hold',wind:4,gust:6,temp:21};await page.locator('[data-act="confirmcoords"]').click();await waitRequests(1);await page.locator('#tab-subject').click();await page.locator('[data-path="subject.name"]').fill('대상 A');await page.locator('[data-path="subject.name"]').press('Tab');await page.waitForFunction(()=>!consoleIdleTimer);const whileLoading=await payload();await page.locator('#tab-safety').click();
  check('현장 위치 확인 직후 즉시 조회하고 진행 상태 표시',requests.length===1&&new URL(requests[0].url).searchParams.get('latitude')==='35.8899'&&await page.locator('[data-weather-query]').getAttribute('data-weather-state')==='loading');
  await page.screenshot({path:path.join(out,'loading.png'),scale:'css'});release();await received();
  check('응답 수신은 다른 입력·지도·기록을 유지하고 현장 확인을 자동 완료하지 않음',isDeepStrictEqual(core(await payload()),core(whileLoading))&&await page.evaluate(()=>S.weather.wind===4&&S.weather.gust===6&&!S.weather.confirmed&&S.safety.approval==='unknown'));
  check('마지막 수신·자료 기준·조회 시도 시각을 구분해 표시',await page.locator('[data-weather-times]').innerText().then(t=>t.includes('마지막 수신')&&t.includes('자료 기준')&&t.includes('최근 조회 시도')));
  await page.locator('[data-act="confirmweather"]').click();const confirmedAt=await page.evaluate(()=>S.weather.confirmedAt);response={mode:'ok',wind:4,gust:6,temp:21};let n=requests.length;await reconnect();await waitRequests(n+1);await received();
  check('재연결은 즉시 한 번 조회하며 의미 있는 변화가 없으면 기존 확인 유지',requests.length===n+1&&await page.evaluate(at=>S.weather.confirmed&&S.weather.confirmedAt===at,confirmedAt));
  response={mode:'ok',wind:4,gust:13,temp:21};n=requests.length;await reconnect();await waitRequests(n+1);await received();check('한계에 영향을 주는 변화는 기존처럼 재확인 요구',await page.evaluate(()=>S.weather.gust===13&&!S.weather.confirmed&&S.safety.approval==='unknown'));
  await page.locator('[data-path="weather.wind"]').fill('7.6');await page.locator('[data-path="weather.wind"]').press('Tab');await page.waitForFunction(()=>!consoleIdleTimer);n=requests.length;const manual=await page.evaluate(()=>JSON.parse(JSON.stringify(S.weather)));await reconnect();await page.waitForTimeout(100);
  check('수동 입력은 자동 갱신을 끄고 재연결 때도 값 보호',requests.length===n&&await page.evaluate(w=>JSON.stringify(S.weather)===JSON.stringify(w)&&!S.weather.auto,manual));
  await page.locator('[data-act="confirmweather"]').click();await page.locator('[data-path="weather.auto"]').check();await page.waitForTimeout(100);const protectedPayload=await payload();
  check('확정 수동 값은 자동 갱신을 켜도 덮지 않고 보호 상태 표시',requests.length===n&&await page.locator('[data-weather-query]').getAttribute('data-weather-state')==='manual');
  answers.push(false);await page.locator('[data-act="wxnow"]').click();check('수동 값의 자동 모델 교체를 취소하면 자료·요청 모두 그대로',requests.length===n&&isDeepStrictEqual(await payload(),protectedPayload));
  response={mode:'ok',wind:4,gust:6,temp:21};answers.push(true);await page.locator('[data-act="wxnow"]').click();await waitRequests(n+1);await received();check('명시적 교체 확인 뒤에만 자동 자료로 바꾸고 현장 확인 해제',await page.evaluate(()=>S.weather.src==='auto'&&S.weather.wind===4&&!S.weather.confirmed));
  const values=await page.evaluate(()=>[S.weather.temp,S.weather.wind,S.weather.gust,S.weather.rain,S.weather.precip,S.weather.observedAt]);response={mode:'fail',wind:40,gust:50,temp:50};n=requests.length;await reconnect();await waitRequests(n+1);await page.waitForFunction(()=>!wxBusy&&!!S.weather.error);
  check('조회 실패는 기존 값을 유지하고 재시도 버튼 표시',await page.evaluate(v=>JSON.stringify([S.weather.temp,S.weather.wind,S.weather.gust,S.weather.rain,S.weather.precip,S.weather.observedAt])===JSON.stringify(v),values)&&await page.locator('[data-weather-query]').getAttribute('data-weather-state')==='failed'&&await page.locator('[data-weather-retry]').isVisible());
  await page.screenshot({path:path.join(out,'failed.png'),scale:'css'});response={mode:'ok',wind:4,gust:6,temp:22};n=requests.length;await page.locator('[data-weather-retry]').click();await waitRequests(n+1);await received();check('재시도 버튼이 실제 조회와 정상 상태 복구로 연결',await page.locator('[data-weather-query]').getAttribute('data-weather-state')==='received'&&await page.evaluate(()=>S.weather.temp===22));
  response={mode:'hold',wind:40,gust:50,temp:50};n=requests.length;await page.locator('#tab-mission').click();await page.locator('[data-act="confirmcoords"]').click();await waitRequests(n+1);await page.locator('[data-path="mission.lat"]').fill('-91');
  check('잘못된 좌표를 입력하는 중에도 이전 요청을 즉시 취소',await page.evaluate(()=>!wxBusy&&S.mission.coordsConfirmedAt===0&&S.mission.lat===null)&&requests.length===n+1);
  await page.locator('[data-path="mission.lat"]').fill('35.88');response={mode:'ok',wind:3,gust:5,temp:20};await page.locator('[data-act="confirmcoords"]').click();await waitRequests(n+2);await received();release();await page.waitForTimeout(150);
  check('좌표가 바뀌면 이전 요청 취소·새 위치 조회, 지연 응답 차단',await page.evaluate(()=>S.weather.lat===35.88&&S.weather.wind===3&&!wxBusy)&&new URL(requests.at(-1).url).searchParams.get('latitude')==='35.88');
  response={mode:'hold',wind:40,gust:50,temp:50};n=requests.length;await page.locator('[data-act="confirmcoords"]').click();await waitRequests(n+1);await page.locator('#tab-safety').click();await page.locator('[data-path="weather.wind"]').fill('1.7');await page.locator('[data-path="weather.wind"]').press('Tab');await page.waitForFunction(()=>!consoleIdleTimer);const edited=await payload();release();await page.waitForTimeout(150);
  check('조회 중 수동 입력은 진행 중 응답을 차단하고 입력·사진·기록 유지',await page.evaluate(()=>S.weather.wind===1.7&&S.weather.src==='manual'&&!S.weather.auto&&!wxBusy)&&isDeepStrictEqual(await payload(),edited));
  response={mode:'hold',wind:40,gust:50,temp:50};n=requests.length;await page.locator('[data-path="weather.auto"]').check();await waitRequests(n+1);await page.locator('[data-path="weather.wind"]').fill('-1');release();await page.waitForTimeout(150);
  check('유효하지 않은 수동 입력 중에도 자동 응답을 차단하고 입력 오류 표시 유지',await page.evaluate(()=>S.weather.wind===null&&S.weather.src==='manual'&&!S.weather.auto&&!wxBusy)&&await page.locator('[data-path="weather.wind"]').inputValue()==='-1');
  await page.locator('[data-path="weather.wind"]').fill('1.7');await page.locator('[data-path="weather.wind"]').press('Tab');await page.waitForFunction(()=>!consoleIdleTimer);
  response={mode:'ok',wind:3,gust:5,temp:20};n=requests.length;await page.locator('[data-path="weather.auto"]').check();await waitRequests(n+1);await received();check('미확정 수동 값에서 사용자가 자동 갱신을 켜면 즉시 조회',await page.evaluate(()=>S.weather.auto&&S.weather.src==='auto'&&S.weather.wind===3));
  for(const mode of ['badjson','missing']){response={mode,wind:4,gust:6,temp:21};n=requests.length;await reconnect();await waitRequests(n+1);await page.waitForFunction(()=>!wxBusy&&!!S.weather.error);check(mode+' 응답도 실패를 표시하고 조회 중 고착 없음',await page.locator('[data-weather-query]').getAttribute('data-weather-state')==='failed'&&await page.evaluate(()=>S.weather.wind===3));}
  response={mode:'hold',wind:4,gust:6,temp:21};n=requests.length;await page.locator('[data-weather-retry]').click();await waitRequests(n+1);await page.waitForFunction(()=>!wxBusy&&S.weather.error.includes('시간 초과'),null,{timeout:17000});release();
  check('실제 12초 요청 제한 후 실패·재시도 상태로 돌아옴',await page.locator('[data-weather-query]').getAttribute('data-weather-state')==='failed'&&await page.locator('[data-weather-retry]').isEnabled());
  response={mode:'stale',wind:3,gust:5,temp:20};n=requests.length;await page.locator('[data-weather-retry]').click();await waitRequests(n+1);await received();check('방금 수신해도 오래된 자료는 최신으로 표시하지 않음',await page.locator('[data-weather-query]').getAttribute('data-weather-state')==='stale'&&await page.evaluate(()=>!weatherStatus(new Date()).ok));
  response={mode:'ok',wind:3,gust:5,temp:20};n=requests.length;await page.locator('[data-weather-retry]').click();await waitRequests(n+1);await received();
  await page.locator('[data-path="weather.auto"]').uncheck();n=requests.length;await page.locator('[data-act="wxnow"]').click();await waitRequests(n+1);await received();
  check('자동 갱신을 끈 일회 조회는 수신을 알리며 정기 갱신 설정은 유지',await page.evaluate(()=>!S.weather.auto)&&await page.locator('[data-weather-label]').innerText().then(t=>t.includes('자동 기상 자료')&&t.includes('정기 갱신 꺼짐')));n=requests.length;await page.locator('[data-path="weather.auto"]').check();await waitRequests(n+1);await received();
  const beforeOffline=await payload();await context.setOffline(true);await page.waitForFunction(()=>navigator.onLine===false);check('연결 끊김은 상태만 알리고 기존 모든 자료를 유지',await page.locator('[data-weather-query]').getAttribute('data-weather-state')==='offline'&&isDeepStrictEqual(await payload(),beforeOffline));await page.screenshot({path:path.join(out,'offline.png'),scale:'css'});n=requests.length;await context.setOffline(false);await waitRequests(n+1);await received();
  viewer=await context.newPage();observe(viewer);n=requests.length;await viewer.goto(url+'?viewer=1');await viewer.waitForFunction(()=>typeof S==='object'&&!ownsEditorLock());await viewer.waitForTimeout(100);check('보기 전용 시작은 외부 조회를 요청하지 않음',requests.length===n);
  response={mode:'fail',wind:4,gust:6,temp:21};await reconnect();await waitRequests(n+1);await page.waitForFunction(()=>!wxBusy&&!!S.weather.error);await viewer.waitForFunction(()=>!!S.weather.error);await viewer.locator('#tab-safety').click();check('보기 전용은 자동 조회·재시도 잠금을 유지',requests.filter(r=>r.window==='viewer').length===0&&await viewer.locator('[data-weather-retry]').isDisabled()&&await page.evaluate(()=>ownsEditorLock()));await viewer.close();viewer=null;
  response={mode:'ok',wind:3,gust:5,temp:20};n=requests.length;await page.locator('[data-weather-retry]').click();await waitRequests(n+1);await received();const coreBeforePractice=core(await payload());
  practice=await context.newPage();observe(practice);await practice.goto(url+'?practice=1');await practice.waitForFunction(()=>typeof S==='object'&&PRACTICE_MODE&&S.drones.length>0);await practice.locator('#tab-safety').click();await practice.locator('[data-act="wxnow"]').click();await reconnect();await received();check('연습은 시작·재연결·수동 조회에서도 외부 요청과 실제 자료 간섭 없음',requests.filter(r=>r.window==='practice').length===0&&await practice.locator('[data-weather-query]').getAttribute('data-weather-state')==='practice'&&isDeepStrictEqual(core(await payload()),coreBeforePractice));await practice.close();practice=null;
  for(const [width,height,theme] of [[1366,900,'light'],[390,844,'light'],[320,800,'dark']]){await page.setViewportSize({width,height});await page.locator('[data-theme-target="console"][data-theme-value="'+theme+'"]').click();await page.locator('#tab-safety').click();const beforeView=await payload();await page.locator('[data-weather-query]').scrollIntoViewIfNeeded();check(width+'px '+theme+'에서 상태·시각·버튼이 넘치지 않고 보기 조작은 업무 자료 불변',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)&&isDeepStrictEqual(await payload(),beforeView));await page.screenshot({path:path.join(out,'status-'+width+'-'+theme+'.png'),scale:'css'});}
  const beforeBackup=await payload();await page.locator('#tab-data').click();const downloaded=page.waitForEvent('download');downloaded.catch(()=>{});await page.locator('#sec-data [data-act="export"]').click();const file=await downloaded;await file.saveAs(path.join(out,'weather-backup.json'));const backup=JSON.parse(await readFile(path.join(out,'weather-backup.json'),'utf8'));
  check('기상 포함 전체 백업을 실제 저장하고 수신 보기 상태를 업무 형식에 추가하지 않음',isDeepStrictEqual(backup,beforeBackup)&&!Object.hasOwn(backup.weather,'receivedAt')&&!Object.hasOwn(backup,'wxReceipt')&&!Object.hasOwn(backup,'wxBusy'));
  check('페이지 실행 오류 없음',errors.length===0);
}finally{release();await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,requests,results},null,2));await browser.close();await new Promise(r=>server.close(r));}
assert.equal(results.filter(r=>!r.pass).length,0,'Automatic weather validation failed');
