/* Synthetic photo map: label contrast and ordinary map/keyboard workflows.
 * Disposable Chrome storage only. --file also checks direct HTML execution.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const modules=option('--modules'),out=option('--out')||'/tmp/stayup-map-labels';await mkdir(out,{recursive:true});
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=(process.argv.includes('--file')?pathToFileURL(path.join(root,'stayup-dash.html')).href:'http://127.0.0.1:'+server.address().port+'/stayup-dash.html')+'?practice=1';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1366,height:900},serviceWorkers:'block',reducedMotion:'reduce'});
const results=[],errors=[];
const check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name);};
async function labelContrast(page,host){
  return page.locator(host+' .gcell .cell-id,'+host+' .gcell .by').evaluateAll(nodes=>{
    const rgb=s=>s.match(/[\d.]+/g).map(Number);
    const lum=a=>a.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((v,x,i)=>v+x*[.2126,.7152,.0722][i],0);
    return {count:nodes.length,min:Math.min(...nodes.map(n=>{const c=getComputedStyle(n),a=lum(rgb(c.color)),b=lum(rgb(c.backgroundColor));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);})),opaque:nodes.every(n=>{const c=getComputedStyle(n),a=rgb(c.color),b=rgb(c.backgroundColor);return (a[3]??1)===1&&(b[3]??1)===1&&c.opacity==='1';})};
  });
}
try{
  const page=await context.newPage();page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  await page.locator('[data-onboard-action="close"]').click();await page.locator('#tab-grid').click();
  // Fixture preparation only; selection and all signoff operations use real controls.
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=900;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,800,900);x.fillStyle='#101820';x.fillRect(800,0,800,900);return c.toDataURL('image/png').split(',')[1];});
  await page.locator('#mapFileInput').setInputFiles({name:'가상-명암지도.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>S.grid.hasMap&&mapPayloadReady());
  const blank=await page.evaluate(()=>exportPayload(true));
  await page.locator('#consMap [data-cell="A1"]').click();
  check('보기 모드에서 밝은 사진 격자 클릭은 기록을 바꾸지 않음',await page.evaluate(()=>exportPayload(true))===blank);
  await page.locator('[data-map-host="consMap"][data-map-action="paint"]').click();
  await page.locator('[data-act="paintby"][data-v="드론"]').click();
  for(let s=0;s<4;s++){await page.locator('[data-act="paints"][data-v="'+s+'"]').click();await page.locator('#consMap [data-cell="A'+(s+1)+'"]').click();}
  check('실제 팔레트로 네 상태·담당을 칠하고 접근 가능한 이름 유지',await page.evaluate(()=>[0,1,2,3].every((s,i)=>S.grid.cells['A'+(i+1)].s===s&&S.grid.cells['A'+(i+1)].by==='드론'))&&await page.locator('#consMap [data-cell="A3"]').getAttribute('aria-label')==='A3 완료 담당 드론');
  const recorded=await page.evaluate(()=>exportPayload(true));
  await page.locator('[data-map-host="consMap"][data-map-action="view"]').click();
  await page.locator('#consMapWorkspace .map-options>summary').click();
  for(const theme of ['light','dark']){
    await page.locator('[data-theme-target="console"][data-theme-value="'+theme+'"]').click();
    for(const fill of [0,100]){
      await page.locator('#consMapWorkspace [data-map-layer="fill"]').fill(String(fill));
      const c=await labelContrast(page,'#consMap');
      check(theme+'·채움 '+fill+'%: 밝고 어두운 사진 위 구역명·담당 대비 4.5 이상',c.count===34&&c.min>=4.5&&c.opaque,c);
    }
  }
  await page.locator('#consMapWorkspace [data-map-layer="by"]').uncheck();
  check('담당 표시를 꺼도 구역명은 보이고 담당 기록 유지',!await page.locator('#consMap [data-cell="A1"] .by').isVisible()&&await page.locator('#consMap [data-cell="A1"] .cell-id').isVisible()&&await page.evaluate(()=>exportPayload(true))===recorded);
  await page.locator('#consMapWorkspace [data-map-layer="by"]').check();
  await page.locator('#consMapWorkspace [data-map-layer="fill"]').fill('40');
  await page.locator('#consMapWorkspace .map-options>summary').click();
  check('테마·채움·표시 설정 왕복은 상황·리비전·활동 기록 보존',await page.evaluate(()=>exportPayload(true))===recorded);
  await page.locator('[data-map-host="consMap"][data-map-action="expand"]').click();
  for(const [w,h] of [[1366,900],[390,844],[320,800]]){
    await page.setViewportSize({width:w,height:h});
    const boxes=await page.locator('#consMap .gcell').evaluateAll(cells=>({cells:cells.filter(e=>e.querySelector('.by')).map(e=>{const a=e.querySelector('.cell-id').getBoundingClientRect(),b=e.querySelector('.by').getBoundingClientRect(),r=e.getBoundingClientRect();return {id:e.dataset.cell,separate:a.bottom<=b.top+.5,inside:a.left>=r.left&&b.left>=r.left&&a.right<=r.right&&b.right<=r.right&&a.top>=r.top&&b.bottom<=r.bottom};}),overflow:document.documentElement.scrollWidth>innerWidth+1}));
    check(w+'px 큰 지도에서 네 상태의 구역명과 담당이 겹치거나 칸 밖으로 나가지 않음',boxes.cells.length===4&&boxes.cells.every(b=>b.separate&&b.inside)&&!boxes.overflow,boxes);
    await page.screenshot({path:path.join(out,'map-labels-'+w+'.png'),scale:'css'});
    if(w===1366){const a=await page.locator('#consMap [data-cell="A1"]').boundingBox(),b=await page.locator('#consMap [data-cell="A4"]').boundingBox();await page.screenshot({path:path.join(out,'map-labels-detail.png'),clip:{x:a.x-2,y:a.y-2,width:b.x+b.width-a.x+4,height:a.height+4},scale:'css'});}
  }
  await page.setViewportSize({width:1366,height:900});
  await page.locator('dialog [data-map-action="paint"]').click();
  await page.locator('[data-act="paints"][data-v="3"]').click();
  const beforeCancel=await page.evaluate(()=>exportPayload(true));
  const cell=page.locator('#consMap [data-cell="A1"]');await cell.focus();const box=await cell.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.keyboard.press('Escape');await page.mouse.up();
  const restored=await labelContrast(page,'#consMap');
  check('쓸기 도중 Esc 취소는 원래 기록과 글자 받침을 함께 복원',await page.evaluate(()=>exportPayload(true))===beforeCancel&&await cell.locator('.cell-id').count()===1&&await cell.getAttribute('aria-label')==='A1 미수색 담당 드론'&&restored.count===34&&restored.min>=4.5);
  await page.locator('dialog [data-act="pin"][data-p="last"]').click();
  await page.keyboard.press('ArrowRight');
  const pinTarget=await page.evaluate(()=>{const c=document.activeElement,r=c.getBoundingClientRect(),f=c.closest('.mapfit').getBoundingClientRect();return {id:c.dataset.cell,x:((r.left+r.right)/2-f.left)/f.width*100,y:((r.top+r.bottom)/2-f.top)/f.height*100};});
  await page.keyboard.press('Enter');
  const pinResult=await page.evaluate(()=>({pin:S.grid.pinLast,mode:pinMode}));
  check('키보드로 핀을 배치하고 화면·좌표 표시에 반영',pinTarget.id==='A2'&&await page.locator('#consMap .pin.last .pdot').isVisible()&&pinResult.mode===null&&pinResult.pin.x===25&&pinResult.pin.y===10,{pinTarget,pinResult});
  const beforePinCancel=await page.evaluate(()=>exportPayload(true));
  await page.locator('dialog [data-act="pin"][data-p="last"]').click();await page.keyboard.press('Escape');
  check('첫 Esc는 핀 배치만 취소하고 기존 핀·기록과 큰 지도 유지',await page.locator('dialog').isVisible()&&await page.evaluate(v=>pinMode===null&&exportPayload(true)===v,beforePinCancel));
  await page.keyboard.press('Escape');
  check('두 번째 Esc로 큰 지도를 닫고 여는 버튼으로 초점 복귀',await page.locator('dialog').count()===0&&await page.locator('[data-map-host="consMap"][data-map-action="expand"]').evaluate(e=>e===document.activeElement));
  const popup=context.waitForEvent('page');await page.locator('#btnOpenDisplay').click();const display=await popup;display.on('pageerror',e=>errors.push(e.message));
  await display.setViewportSize({width:1920,height:1080});await display.waitForFunction(()=>typeof S==='object'&&S.grid.hasMap&&mapPayloadReady());
  for(const theme of ['light','dark']){
    if(await display.locator('#board').getAttribute('data-theme')!==theme)await display.locator('#displayThemeToggle').click();
    const c=await labelContrast(display,'#mapWrap');
    check('대형 표출 '+theme+'에서 네 상태와 담당 글자 대비 유지',c.count===34&&c.min>=4.5&&c.opaque,c);
    await display.screenshot({path:path.join(out,'display-labels-'+theme+'.png'),scale:'css'});
  }
  check('페이지 실행 오류 없음',errors.length===0,errors);
}finally{await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors,results},null,2));await browser.close();await new Promise(r=>server.close(r));}
assert.equal(results.filter(r=>!r.pass).length,0,'Map-label validation failed');
