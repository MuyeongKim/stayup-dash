/* AI response drafts: visible save status, failure/retry, keyboard and viewport.
 * Every record is artificial; use a disposable Chrome context only.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-ai-response';await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=(process.argv.includes('--file')?pathToFileURL(path.join(root,'stayup-dash.html')).href:'http://127.0.0.1:'+server.address().port+'/stayup-dash.html')+'?practice=1';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1366,height:900},deviceScaleFactor:3,serviceWorkers:'block',reducedMotion:'reduce'});
const results=[],errors=[];
const check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name);};
// Migration can reorder object keys. Compare every field value, not JSON key order.
function changedPaths(before,after,prefix=''){
  if(JSON.stringify(before)===JSON.stringify(after))return [];
  if(!before||!after||typeof before!=='object'||typeof after!=='object')return [{path:prefix,before,after}];
  return [...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(k=>changedPaths(before[k],after[k],prefix?prefix+'.'+k:k));
}
try{
  const page=await context.newPage();page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  await page.locator('[data-onboard-action="close"]').click();await page.locator('#tab-ai').click();
  await page.locator('[data-ai-file]').setInputFiles(path.join(root,'tests/fixtures/stayup-photo-candidates-v1.json'));
  await page.waitForFunction(()=>S.ai.candidates.length===2);
  const card=page.locator('.ai-candidate').first(),note=card.locator('[data-ai-response="note"]'),status=card.locator('[data-ai-response="status"]'),message=card.locator('[data-ai-response-state]');
  check('후보 입력에 대응 저장 방법과 재시작 전 초안 한계 명시',await page.locator('#sec-ai').innerText().then(t=>t.includes('대응 저장')&&t.includes('새로고침하거나 창을 닫으면 사라집니다'))&&!await message.evaluate(e=>e.classList.contains('is-dirty')));
  const original=await page.evaluate(()=>exportPayload(true));
  await note.fill('가상 지상팀에 촬영 위치 확인 요청');await note.press('ArrowLeft');await note.pressSequentially('A');
  check('입력 즉시 미저장을 표시하며 입력 초점·커서 유지',await message.innerText().then(t=>t.includes('미저장'))&&await note.evaluate(e=>e===document.activeElement&&e.selectionStart===e.value.length-1));
  check('다른 후보를 미저장으로 잘못 표시하지 않음',!await page.locator('.ai-candidate').nth(1).locator('[data-ai-response-state]').evaluate(e=>e.classList.contains('is-dirty')));
  await status.selectOption('notified');
  check('대응 상태·메모 초안 입력은 상황·리비전·기록을 아직 변경하지 않음',await page.evaluate(()=>exportPayload(true))===original);
  await note.fill('');await status.selectOption('waiting');
  check('원래 값으로 되돌리면 미저장 표시도 해제',!await message.evaluate(e=>e.classList.contains('is-dirty'))&&await page.evaluate(()=>exportPayload(true))===original);
  const draftText='가상 지상팀에 촬영 위치 재확인 요청';await note.fill(draftText);await status.selectOption('notified');
  await page.locator('#tab-mission').click();await page.locator('#tab-ai').click();
  check('메뉴 왕복 후 초안과 미저장 상태 유지',await note.inputValue()===draftText&&await status.inputValue()==='notified'&&await message.innerText().then(t=>t.includes('미저장')));
  await page.locator('[data-ai-filter]').selectOption('person');await page.locator('[data-ai-filter]').selectOption('all');
  check('필터에서 숨겼다 다시 보여도 초안·미저장 유지',await note.inputValue()===draftText&&await message.innerText().then(t=>t.includes('미저장'))&&await page.evaluate(()=>exportPayload(true))===original);
  await card.locator('[data-ai-action="detail"]').click();await page.locator('.ai-detail button').click();
  check('사진 확인 창을 열고 닫아도 초안·미저장과 원본 판정 유지',await note.inputValue()===draftText&&await message.innerText().then(t=>t.includes('미저장'))&&await page.evaluate(()=>S.ai.candidates[0].review==='unreviewed'&&S.ai.candidates[0].responseNote===''));
  for(const theme of ['light','dark']){
    await page.locator('[data-theme-target="console"][data-theme-value="'+theme+'"]').click();
    const contrast=await message.evaluate(e=>{const c=getComputedStyle(e),rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number),lum=a=>a.map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((v,x,i)=>v+x*[.2126,.7152,.0722][i],0),a=lum(rgb(c.color)),b=lum(rgb(c.backgroundColor));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);});
    check(theme+'의 미저장 안내가 색뿐 아니라 글자로 구분되고 대비 4.5 이상',contrast>=4.5&&await message.innerText().then(t=>t.includes('대응 저장'))&&await page.evaluate(()=>exportPayload(true))===original,contrast);
  }
  await page.locator('[data-theme-target="console"][data-theme-value="light"]').click();
  for(const [w,h] of [[390,844],[320,800]]){
    await page.setViewportSize({width:w,height:h});await message.scrollIntoViewIfNeeded();
    const fit=await message.evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,viewport:innerWidth,doc:document.documentElement.scrollWidth};});
    check(w+'px에서 대응 상태·저장 버튼·미저장 설명 가로 넘침 없음',fit.left>=0&&fit.right<=fit.viewport&&fit.doc<=fit.viewport+1&&await card.locator('[data-ai-action="response"]').isVisible(),fit);
    await page.screenshot({path:path.join(out,'ai-response-'+w+'.png'),scale:'css'});
    if(w===390){
      // Frame the response controls below sticky navigation for the guide image.
      await page.evaluate(()=>{const row=document.querySelector('.ai-candidate .row-tools'),bar=document.querySelector('.console-workspace-bar');window.scrollBy(0,row.getBoundingClientRect().top-bar.getBoundingClientRect().bottom-12);});
      const row=await card.locator('.row-tools').boundingBox(),end=await message.boundingBox();
      await page.screenshot({path:path.join(out,'ai-response-card.png'),clip:{x:row.x,y:row.y,width:row.width,height:end.y+end.height-row.y},scale:'device'});
    }
  }
  await page.setViewportSize({width:1366,height:900});
  await page.evaluate(()=>{window.restoreResponseStorage=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===KEY)throw new DOMException('가상 저장공간 부족','QuotaExceededError');return window.restoreResponseStorage.call(this,k,v);};});
  await card.locator('[data-ai-action="response"]').click();
  const failureDetail={changed:changedPaths(JSON.parse(original),JSON.parse(await page.evaluate(()=>exportPayload(true)))),note:await note.inputValue(),message:await message.innerText(),result:await page.locator('[data-ai-status]').innerText()};
  check('저장 실패 시 기존 기록과 초안을 유지하고 미저장·재시도 안내',failureDetail.changed.length===0&&failureDetail.note===draftText&&failureDetail.message.includes('미저장')&&failureDetail.result.includes('저장 실패'),failureDetail);
  await page.evaluate(()=>{Storage.prototype.setItem=window.restoreResponseStorage;delete window.restoreResponseStorage;});
  const oldEvents=await page.evaluate(()=>S.events.length);await card.locator('[data-ai-action="response"]').click();
  check('재시도 성공 후 저장된 대응·시각 표시와 이력 한 건 반영',await page.evaluate(v=>S.ai.candidates[0].responseNote===v&&S.ai.candidates[0].responseStatus==='notified'&&S.ai.candidates[0].responseAt>0,draftText)&&await page.evaluate(()=>S.events.length)===oldEvents+1&&!await message.evaluate(e=>e.classList.contains('is-dirty'))&&await message.innerText().then(t=>t.includes('저장된 대응 기록')));
  const saved=await page.evaluate(()=>exportPayload(true));await card.locator('[data-ai-action="response"]').click();
  check('저장 버튼 반복 조작은 이력 중복이나 상태 변경 없음',await page.evaluate(()=>exportPayload(true))===saved);
  await page.reload();await page.waitForFunction(()=>ownsEditorLock());await page.locator('#tab-ai').click();
  const reloadDetail={changed:changedPaths(JSON.parse(saved),JSON.parse(await page.evaluate(()=>exportPayload(true)))),note:await note.inputValue(),status:await status.inputValue(),message:await message.innerText()};
  check('재시작 후 저장된 메모·상태·시각과 업무 기록 보존',reloadDetail.note===draftText&&reloadDetail.status==='notified'&&reloadDetail.message.includes('저장된 대응 기록')&&reloadDetail.changed.length===0,reloadDetail);
  const viewer=await context.newPage();viewer.on('pageerror',e=>errors.push(e.message));await viewer.goto(url);await viewer.waitForFunction(()=>typeof S==='object'&&!ownsEditorLock());await viewer.locator('#tab-ai').click();
  check('읽기 전용은 저장된 대응을 보고 입력·저장을 잠금 유지',!await viewer.locator('[data-ai-response="note"]').first().isEnabled()&&!await viewer.locator('[data-ai-action="response"]').first().isEnabled()&&await viewer.locator('[data-ai-response-state]').first().innerText().then(t=>t.includes('저장된 대응 기록'))&&await page.evaluate(()=>ownsEditorLock()));
  check('페이지 실행 오류 없음',errors.length===0,errors);
}finally{await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,results},null,2));await browser.close();await new Promise(r=>server.close(r));}
assert.equal(results.filter(r=>!r.pass).length,0,'AI-response validation failed');
