/* Guidance only: safety reasons reveal the relevant field without confirming it.
 * Artificial weather, isolated Chrome contexts and no external weather requests.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-safety-guidance';await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=(process.argv.includes('--file')?pathToFileURL(path.join(root,'stayup-dash.html')).href:'http://127.0.0.1:'+server.address().port+'/stayup-dash.html')+'?practice=1';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1366,height:900},deviceScaleFactor:3,serviceWorkers:'block',reducedMotion:'reduce'});
const results=[],errors=[],alerts=[];
const check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name);};
async function stage(page,kind){await page.evaluate(kind=>{const now=Date.now();S.safety.approval='unknown';S.safety.agencies='';S.weather.auto=false;S.weather.src='manual';S.weather.lat=S.mission.lat;S.weather.lon=S.mission.lon;S.weather.wind=4.2;S.weather.gust=7.8;S.weather.rain=false;S.weather.confirmed=true;S.weather.confirmedAt=now;S.weather.observedAt=kind==='missing'?0:kind==='future'?now+10*60000:now-31*60000;commit();},kind);}
async function revealReason(page){await page.locator('#tab-quick').click();if(!await page.locator('#verdictHelp').evaluate(e=>e.open))await page.locator('#verdictHelp>summary').click();await page.locator('#verdictReasons [data-path-target="weather.observedAt"]').click();}
async function position(page){return page.locator('[data-path="weather.observedAt"]').evaluate(e=>{const r=e.getBoundingClientRect(),b=document.querySelector('.console-workspace-bar'),s=document.querySelector('.mobile-verdict'),n=document.querySelector('.ct-nav'),bottom=document.querySelector('.mobile-nav');const top=getComputedStyle(b).position==='sticky'?b.getBoundingClientRect().bottom:Math.max(getComputedStyle(s).position==='fixed'?s.getBoundingClientRect().bottom:0,getComputedStyle(n).position==='sticky'?n.getBoundingClientRect().bottom:0);return {focused:e===document.activeElement||e.disabled&&document.activeElement===e.closest('label'),disabled:e.disabled,top:r.top,bottom:r.bottom,width:r.width,limitTop:top,limitBottom:bottom&&getComputedStyle(bottom).position==='fixed'?bottom.getBoundingClientRect().top:innerHeight};});}
const fits=p=>p.focused&&p.top>=p.limitTop&&p.bottom<=p.limitBottom;
try{
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{alerts.push(d.message());await d.accept();});
  await page.goto(url);await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());await page.locator('[data-onboard-action="close"]').click();
  await stage(page,'stale');
  const initial=await page.evaluate(()=>exportPayload(true));
  for(const [w,h,theme] of [[1366,900,'light'],[390,844,'light'],[320,800,'dark'],[390,400,'dark']]){
    await page.setViewportSize({width:w,height:h});await page.locator('[data-theme-target="console"][data-theme-value="'+theme+'"]').click();await revealReason(page);
    const p=await position(page);
    check(w+'×'+h+' '+theme+': 관측 사유가 실제 보이는 관측시각 칸으로 이동',fits(p),p);
    check(w+'×'+h+': 안내 이동은 관측값·확인·승인·리비전을 변경하지 않음',await page.evaluate(()=>exportPayload(true))===initial&&await page.evaluate(()=>!weatherStatus(new Date()).ok&&S.safety.approval==='unknown'));
    if(w<=600)check(w+'×'+h+': 날짜·시간을 읽을 단일 입력 너비와 가로 폭 확보',p.width>=250&&await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),p.width);
    await page.screenshot({path:path.join(out,'weather-'+w+'-'+h+'.png'),scale:'css'});
    if(w===390&&h===844){const start=await page.locator('[data-path="weather.observedAt"]').evaluate(e=>e.closest('label').getBoundingClientRect().toJSON()),end=await page.locator('[data-act="confirmweather"]').boundingBox();await page.screenshot({path:path.join(out,'weather-guidance-preview.png'),clip:{x:23,y:start.y-3,width:w-46,height:end.y+end.height-start.y+6},scale:'device'});}
  }
  await page.setViewportSize({width:1366,height:900});
  for(const kind of ['missing','future']){
    await stage(page,kind);const before=await page.evaluate(()=>exportPayload(true));await revealReason(page);
    check(kind+': 누락·미래 관측시각 사유도 해당 입력으로 연결하며 판정 보류 유지',fits(await position(page))&&await page.evaluate(()=>exportPayload(true))===before&&await page.evaluate(()=>!weatherStatus(new Date()).ok));
  }
  await stage(page,'stale');await revealReason(page);const old=await page.evaluate(()=>exportPayload(true));
  await page.locator('[data-act="confirmweather"]').click();
  check('오래된 관측값에서 확인 버튼만 누르면 계속 거부하고 자료 보존',alerts.some(t=>t.includes('관측시각'))&&await page.evaluate(()=>exportPayload(true))===old&&await page.evaluate(()=>!weatherStatus(new Date()).ok));
  const observed=await page.evaluate(()=>localDateTime(new Date()));
  await page.locator('[data-path="weather.wind"]').fill('5.1');await page.locator('[data-path="weather.gust"]').fill('6.2');await page.locator('[data-path="weather.rain"]').selectOption('false');await page.locator('[data-path="weather.observedAt"]').fill(observed);
  check('가상 재관측값·시각을 입력해도 현장 확인 전에는 확인 상태 해제',await page.evaluate(()=>S.weather.wind===5.1&&S.weather.gust===6.2&&!S.weather.confirmed&&!weatherStatus(new Date()).ok));
  await page.locator('[data-act="confirmweather"]').click();
  check('명시적 기상 확인 후에도 별도의 미확인 비행승인을 자동 처리하지 않음',await page.evaluate(()=>weatherStatus(new Date()).ok&&S.weather.confirmed&&S.safety.approval==='unknown'&&flightVerdict(new Date()).lv!=='ok'));
  await stage(page,'stale');await page.evaluate(()=>{S.weather.lat+=.1;commit();});
  await page.locator('#tab-quick').click();if(!await page.locator('#verdictHelp').evaluate(e=>e.open))await page.locator('#verdictHelp>summary').click();
  check('관측 위치 불일치는 기존 현장 좌표 확인 경로 유지',await page.locator('#verdictReasons [data-path-target="mission.lat"]').count()>0);
  await stage(page,'stale');const owner=await page.evaluate(()=>exportPayload(true));
  const viewer=await context.newPage();viewer.on('pageerror',e=>errors.push(e.message));await viewer.goto(url);await viewer.waitForFunction(()=>typeof S==='object'&&!ownsEditorLock());
  if(await viewer.locator('#onboardingGuide').isVisible())await viewer.locator('[data-onboard-action="close"]').click();await viewer.setViewportSize({width:320,height:800});await revealReason(viewer);
  const readonly=await position(viewer);
  check('읽기 전용 안내는 비활성 입력의 라벨에 초점을 두고 권한·자료 유지',fits(readonly)&&readonly.disabled&&await page.evaluate(()=>ownsEditorLock())&&await page.evaluate(()=>exportPayload(true))===owner,readonly);
  check('새 관측값과 함께 시각을 입력한다는 안내 명시',await viewer.locator('[data-path="weather.observedAt"]').evaluate(e=>e.closest('label').textContent.includes('새로 관측한 기상값')));
  check('페이지 실행 오류 없음',errors.length===0,errors);
}finally{await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,results},null,2));await browser.close();await new Promise(r=>server.close(r));}
assert.equal(results.filter(r=>!r.pass).length,0,'Safety-guidance validation failed');
