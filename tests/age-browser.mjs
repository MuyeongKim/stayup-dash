/* Valid age zero must survive input, display, report, JSON and restart.
 * Artificial subject only; report generation never accesses the OS clipboard.
 */
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-age';await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=process.argv.includes('--file')?pathToFileURL(path.join(root,'stayup-dash.html')).href:'http://127.0.0.1:'+server.address().port+'/stayup-dash.html';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1366,height:900},deviceScaleFactor:3,serviceWorkers:'block',reducedMotion:'reduce'});
const results=[],errors=[];
const check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name);};
const report=page=>page.evaluate(()=>buildReport().split('\n').find(line=>line.includes('인적사항')));
const otherFields=page=>page.evaluate(()=>{const value=JSON.parse(exportPayload(true));delete value.meta;delete value.appVersion;delete value.subject.age;return value;});
try{
  const page=await context.newPage();page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());await page.locator('[data-onboard-action="new"]').click();await page.locator('[data-path="mission.title"]').fill('가상 연령 표시 검토');
  await page.locator('#tab-data').click();await page.locator('[data-path="ui.autoSave"]').uncheck();await page.locator('#tab-safety').click();await page.locator('[data-path="weather.auto"]').uncheck();await page.locator('#tab-subject').click();await page.locator('[data-path="subject.name"]').fill('가상 대상 A');
  const popup=page.waitForEvent('popup');await page.locator('#btnOpenDisplay').click();const display=await popup;display.on('pageerror',e=>errors.push(e.message));await display.waitForFunction(()=>typeof S==='object'&&S.subject.name==='가상 대상 A');
  check('미입력 연령은 0세로 추정하지 않고 기존 공란 표시 유지',await page.locator('[data-path="subject.age"]').inputValue()===''&&await display.locator('#subjBody .ag').count()===0&&(await report(page)).includes('/ -세 /'));
  const originalOther=await otherFields(page);
  const input=page.locator('[data-path="subject.age"]');
  for(const age of [0,1,82,130]){
    await input.fill(String(age));await page.locator('[data-path="subject.name"]').click();await display.waitForFunction(age=>S.subject.age===age,age);
    check(age+'세 유효 입력이 저장값·표출·활동일지에 동일하게 남음',await page.evaluate(age=>S.subject.age===age,age)&&await input.evaluate(e=>e.checkValidity())&&await display.locator('#subjBody .ag').innerText()===age+'세'&&(await report(page)).includes('/ '+age+'세 /'));
  }
  await input.fill('');await page.locator('[data-path="subject.name"]').click();await display.waitForFunction(()=>S.subject.age===null);
  check('연령을 지우면 미입력으로 돌아가고 0세 표출을 남기지 않음',await page.evaluate(()=>S.subject.age===null)&&await display.locator('#subjBody .ag').count()===0&&(await report(page)).includes('/ -세 /'));
  for(const invalid of ['-1','131','0.5']){
    await input.fill(invalid);
    check(invalid+' 입력은 기존 범위·정수 간격 검사를 유지하고 보고서에 쓰지 않음',!await input.evaluate(e=>e.checkValidity())&&await page.evaluate(()=>S.subject.age===null)&&(await report(page)).includes('/ -세 /'));
  }
  await input.fill('0');await page.locator('[data-path="subject.name"]').click();await display.waitForFunction(()=>S.subject.age===0);
  for(const [preset,theme] of [['standard','light'],['standard','dark'],['far','light'],['far','dark']]){
    await page.locator('#tab-data').click();await page.locator('[data-path="ui.viewPreset"]').selectOption(preset);await display.waitForFunction(p=>S.ui.viewPreset===p,preset);
    if(await display.locator('#board').getAttribute('data-theme')!==theme)await display.locator('#displayThemeToggle').click();
    check(preset+'·'+theme+' 표출에서 입력한 0세가 실제 보임',await display.locator('#subjBody .ag').isVisible()&&await display.locator('#subjBody .ag').innerText()==='0세');
    if(preset==='standard'&&theme==='light')await display.screenshot({path:path.join(out,'age-zero-display.png'),scale:'css'});
  }
  await page.locator('[data-path="ui.viewPreset"]').selectOption('standard');
  check('연령·보기 변경 후 다른 실종자·운용 상태 필드는 유지',isDeepStrictEqual(await otherFields(page),originalOther));
  const downloaded=page.waitForEvent('download');await page.locator('#sec-data [data-act="export"]').click();const file=await downloaded;const savedPath=path.join(out,'age-zero.json');await file.saveAs(savedPath);const exported=JSON.parse(await readFile(savedPath,'utf8'));
  check('실제 JSON 다운로드에도 연령은 숫자 0으로 보관',exported.subject.age===0&&typeof exported.subject.age==='number');
  await page.locator('#tab-subject').click();await input.fill('82');await page.locator('#tab-data').click();await page.locator('#importFile').setInputFiles(savedPath);await page.waitForFunction(()=>S.subject.age===0);await display.waitForFunction(()=>S.subject.age===0);
  check('기존 숫자 0을 가진 JSON 재불러오기도 표출·보고서에 0세로 복원',await display.locator('#subjBody .ag').innerText()==='0세'&&(await report(page)).includes('/ 0세 /'));
  const saved=JSON.parse(await page.evaluate(()=>exportPayload(true)));await page.reload();await page.waitForFunction(()=>ownsEditorLock());await page.locator('#tab-subject').click();
  check('다시 열어도 연령 0과 전체 상태 필드 보존',await input.inputValue()==='0'&&isDeepStrictEqual(JSON.parse(await page.evaluate(()=>exportPayload(true))),saved)&&(await report(page)).includes('/ 0세 /'));
  const viewer=await context.newPage();viewer.on('pageerror',e=>errors.push(e.message));await viewer.goto(url);await viewer.waitForFunction(()=>typeof S==='object'&&!ownsEditorLock());await viewer.locator('#tab-subject').click();
  check('읽기 전용도 0 값을 보되 입력·편집권 잠금 유지',await viewer.locator('[data-path="subject.age"]').inputValue()==='0'&&!await viewer.locator('[data-path="subject.age"]').isEnabled()&&await page.evaluate(()=>ownsEditorLock()));
  for(const width of [390,320]){await page.setViewportSize({width,height:844});check(width+'px에서 연령 0 입력을 읽고 가로 넘침 없음',await input.inputValue()==='0'&&await input.isVisible()&&await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  check('페이지 실행 오류 없음',errors.length===0,errors);
}finally{await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,results},null,2));await browser.close();await new Promise(r=>server.close(r));}
assert.equal(results.filter(r=>!r.pass).length,0,'Age validation failed');
