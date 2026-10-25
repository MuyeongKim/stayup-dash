/* Native date/time values across field groups and responsive layouts.
 * Synthetic practice data and disposable Chrome storage only.
 */
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-datetime';await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=(process.argv.includes('--file')?pathToFileURL(path.join(root,'stayup-dash.html')).href:'http://127.0.0.1:'+server.address().port+'/stayup-dash.html')+'?practice=1';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1366,height:900},deviceScaleFactor:3,serviceWorkers:'block',reducedMotion:'reduce'});
const results=[],errors=[];
const check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name);};
async function reveal(page,item){await page.locator('#tab-'+item.sec).click();if(item.sec==='drone'){const fold=page.locator('#sec-drone details').first();if(!await fold.evaluate(e=>e.open))await fold.locator('summary').click();}return page.locator(item.selector);}
try{
  const page=await context.newPage();page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>ownsEditorLock()&&S.drones.length===3);await page.locator('[data-onboard-action="close"]').click();
  const crewIndex=await page.evaluate(()=>S.crew.findIndex(c=>c.role!=='조종'));
  assert.ok(crewIndex>=0,'Practice fixture needs a non-pilot crew member');
  const fields=[
    {sec:'mission',path:'mission.dispatchedAt',name:'출동시각',minutes:10},
    {sec:'subject',path:'subject.missingAt',name:'실종시각',minutes:65},
    {sec:'drone',path:'drones.0.tookOffAt',name:'이륙시각',minutes:5},
    {sec:'crew',path:'crew.'+crewIndex+'.inAt',name:'투입시각',minutes:30},
    {sec:'crew',path:'crew.'+crewIndex+'.outAt',name:'종료시각',minutes:15},
    {sec:'safety',path:'weather.observedAt',name:'관측시각',minutes:2}
  ].map(item=>({...item,selector:'[data-path="'+item.path+'"]'}));
  for(const item of fields){item.value=await page.evaluate(m=>localDateTime(new Date(Date.now()-m*60000)),item.minutes);const input=await reveal(page,item);await input.fill(item.value);}
  await page.locator('#tab-quick').click();await page.locator('#evType').selectOption('note');await page.locator('#evTimeMode').selectOption('custom');
  const quickTime=await page.evaluate(()=>localDateTime(new Date(Date.now()-3*60000)));await page.locator('#evTime').fill(quickTime);await page.locator('#evZone').fill('A1');await page.locator('#evText').fill('가상 과거 사건 시각 검증');
  fields.push({sec:'quick',selector:'#evTime',name:'과거 사건시각',value:quickTime});
  const stored=await page.evaluate(items=>items.map(item=>({path:item.path,value:item.path?getPath(item.path):quickEv.time,expected:item.path==='weather.observedAt'?tms(item.value):item.value})),fields);
  check('일곱 시각을 실제 입력해 기존 문자열·관측시각 저장 규칙과 일치',stored.every(x=>x.value===x.expected),stored);
  const before=await page.evaluate(()=>({state:exportPayload(true),draft:JSON.stringify(quickEv)}));
  for(const [w,h,theme] of [[1366,900,'light'],[1024,768,'light'],[844,400,'dark'],[390,844,'light'],[320,800,'dark']]){
    await page.setViewportSize({width:w,height:h});await page.locator('[data-theme-target="console"][data-theme-value="'+theme+'"]').click();
    for(const item of fields){
      const input=await reveal(page,item);await input.scrollIntoViewIfNeeded();
      const box=await input.boundingBox();
      const parentWidth=await input.evaluate(e=>e.closest('label').parentElement.getBoundingClientRect().width);
      check(w+'×'+h+' '+theme+' · '+item.name+' 날짜/시간 읽기 너비와 값 유지',box.width>=220&&box.x>=0&&box.x+box.width<=w&&await input.inputValue()===item.value&&await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),{width:box.width,parentWidth});
      if(w===390&&item.sec==='subject'){
        // Artifact framing only; values were entered through native input APIs.
        await page.evaluate(()=>focusConsoleField(document.getElementById('consoleRoot'),'subject.missingAt'));
        const label=await input.evaluate(e=>e.closest('label').getBoundingClientRect().toJSON());
        await page.screenshot({path:path.join(out,'mobile-datetime-preview.png'),clip:{x:label.x-3,y:label.y-3,width:label.width+6,height:label.height+6},scale:'device'});
      }
      if(w===320&&['subject','crew'].includes(item.sec))await page.screenshot({path:path.join(out,'datetime-'+item.name+'.png'),scale:'css'});
    }
    check(w+'×'+h+' 메뉴·크기·테마 왕복은 전체 기록·리비전·작성 중 사건을 보존',await page.evaluate(v=>exportPayload(true)===v.state&&JSON.stringify(quickEv)===v.draft,before));
  }
  await page.setViewportSize({width:1366,height:900});await page.locator('#tab-quick').click();
  const oldCount=await page.evaluate(()=>S.events.length);await page.locator('#evText').press('Enter');
  check('작성 중 과거 시각으로 이력 한 건을 기록하고 기본 지금 모드로 복귀',await page.evaluate(({t,n})=>S.events.length===n+1&&S.events.at(-1).t===tms(t)&&S.events.at(-1).text==='가상 과거 사건 시각 검증'&&quickEv.timeAuto,{t:quickTime,n:oldCount}));
  const saved=await page.evaluate(()=>exportPayload(true));await page.reload();await page.waitForFunction(()=>ownsEditorLock());
  const reopened=[];for(const item of fields.filter(f=>f.path)){const input=await reveal(page,item);reopened.push({name:item.name,expected:item.value,actual:await input.inputValue()});}
  const reloaded=await page.evaluate(()=>exportPayload(true));
  // A newly recorded event can use a different key order before migration.
  check('재시작 후 여섯 저장 시각과 모든 상태 필드 유지',reopened.every(f=>f.actual===f.expected)&&isDeepStrictEqual(JSON.parse(reloaded),JSON.parse(saved)),{fields:reopened,encodingSame:reloaded===saved});
  const viewer=await context.newPage();viewer.on('pageerror',e=>errors.push(e.message));await viewer.goto(url);await viewer.waitForFunction(()=>typeof S==='object'&&!ownsEditorLock());await viewer.setViewportSize({width:320,height:800});
  if(await viewer.locator('#onboardingGuide').isVisible())await viewer.locator('[data-onboard-action="close"]').click();const readonly=await reveal(viewer,fields[3]);const rect=await readonly.boundingBox();
  check('읽기 전용의 저장 시각도 너비를 확보하고 편집권·날짜 값 유지',rect.width>=220&&!await readonly.isEnabled()&&await readonly.inputValue()===fields[3].value&&await page.evaluate(()=>ownsEditorLock())&&await page.evaluate(()=>exportPayload(true))===reloaded);
  check('페이지 실행 오류 없음',errors.length===0,errors);
}finally{await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,results},null,2));await browser.close();await new Promise(r=>server.close(r));}
assert.equal(results.filter(r=>!r.pass).length,0,'Datetime validation failed');
