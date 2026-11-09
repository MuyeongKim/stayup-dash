/* 벽 화면(현황 화면) 가독성과 상황판 보조 기능 회귀 검사.
   대비·배치·자동 넘김·바뀐 것 강조·입력 갱신 시각·한 장 요약·진행 다시 보기를 실제 Chrome에서 확인한다.
   가상 연습 자료와 일회용 브라우저 저장소만 사용하며 외부 요청은 차단한다. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=k=>{const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];};
const out=option('--out')||'/tmp/stayup-wall-board';await mkdir(out,{recursive:true});
const modules=option('--modules');
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
const server=createServer(async(req,res)=>{try{const f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!f.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':'application/json');res.end(await readFile(f));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port+'/stayup-dash.html?practice=1';
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[],errors=[];
const check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name);};
/* 현황 화면에서 글자 대비가 기준(일반 4.5, 큰 글자 3) 미만인 문구 */
const lowContrast=page=>page.evaluate(()=>{
  const rgb=s=>(s.match(/[\d.]+/g)||[0,0,0]).map(Number);
  const lum=a=>a.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((v,x,i)=>v+x*[.2126,.7152,.0722][i],0);
  const bg=e=>{while(e){const a=rgb(getComputedStyle(e).backgroundColor);if((a[3]??1)>.5)return a;e=e.parentElement;}return [255,255,255];};
  const low=[];
  document.querySelectorAll('#board .log-row *,#board .d-rows *,#board .brand *,#board .priority-card *,#board .last-update').forEach(e=>{
    if(!e.offsetParent)return;const t=[...e.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim()).map(n=>n.textContent.trim()).join(' ');if(!t||e.getAttribute('aria-hidden')==='true')return;
    const cs=getComputedStyle(e),a=lum(rgb(cs.color)),b=lum(bg(e)),c=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    const big=parseFloat(cs.fontSize)>=24||(parseFloat(cs.fontSize)>=18.6&&+cs.fontWeight>=700);
    if(c<(big?3:4.5))low.push(Math.round(c*10)/10+' '+t.slice(0,24));
  });
  return low;
});
try{
  const context=await browser.newContext({viewport:{width:1366,height:900},serviceWorkers:'block',reducedMotion:'reduce'});
  await context.route('**/*',r=>{const u=new URL(r.request().url());return u.hostname==='127.0.0.1'||u.protocol==='data:'||u.protocol==='blob:'||u.protocol==='about:'?r.continue():r.abort();});
  const op=await context.newPage();op.setDefaultTimeout(8000);op.on('dialog',d=>d.accept());op.on('pageerror',e=>errors.push('입력:'+e.message));
  await op.goto(url);await op.waitForFunction(()=>typeof S==='object'&&ownsEditorLock());
  const close=op.locator('[data-onboard-action="close"]');if(await close.isVisible())await close.click();
  await op.evaluate(()=>{S.grid.pinLast={x:42,y:35};S.grid.cells.B3={s:1,by:'드론'};commit();});
  const popup=op.waitForEvent('popup');await op.locator('#btnOpenDisplay').click();const ds=await popup;ds.on('pageerror',e=>errors.push('현황:'+e.message));
  await ds.setViewportSize({width:1920,height:1080});await ds.waitForFunction(()=>typeof S==='object'&&S.events.length>0);await ds.waitForTimeout(1300);

  for(const theme of ['light','dark']){
    if(await ds.locator('#board').getAttribute('data-theme')!==theme)await ds.locator('#displayThemeToggle').click();
    await ds.waitForTimeout(200);const low=await lowContrast(ds);
    check(theme+': 중요 기록 줄·기체 수치·지시·브랜드 글자 대비 기준 충족',low.length===0,low);
  }
  const lay=await ds.evaluate(()=>{const r=s=>document.querySelector(s).getBoundingClientRect();const h=r('#board .hdr'),p=r('#displayPriority'),m=r('#board .cols');return {h:h.bottom,pt:p.top,pb:p.bottom,mt:m.top,mb:m.bottom,vh:innerHeight,font:parseFloat(getComputedStyle(document.querySelector('#displayPriority [data-priority-text]')).fontSize)};});
  check('현재 우선 지시는 머리 바로 아래·본문 위에 큰 글자로 표시',lay.pt>=lay.h-1&&lay.pb<=lay.mt+1&&lay.mb<=lay.vh+1&&lay.font>=24,lay);
  const cards=await ds.evaluate(()=>[...document.querySelectorAll('#board .col>.card')].filter(c=>c.getBoundingClientRect().bottom>innerHeight+1).map(c=>c.querySelector('h2').textContent));
  check('모든 카드가 화면 안에 있음',cards.length===0,cards);
  const paging=await ds.evaluate(()=>[...document.querySelectorAll('.wall-paged')].map(e=>({id:e.id,badge:(e.closest('.card').querySelector('.wall-page')||{}).textContent||''})));
  check('넘치는 목록은 쪽 표시와 함께 스스로 넘김 대상이 됨',paging.length>0&&paging.every(p=>/^1\/\d+ 쪽$/.test(p.badge)),paging);
  const heading=await ds.locator('#logBody').evaluate(e=>e.closest('.card').querySelector('h2').textContent);
  check('쪽 표시는 카드 제목 글자를 바꾸지 않음',heading==='이벤트 타임라인',heading);
  const pin=await ds.evaluate(()=>{const c=document.querySelector('#mapWrap .gcell[class*="pin-corner-"]');if(!c)return null;const id=c.querySelector('.cell-id').getBoundingClientRect(),lb=document.querySelector('#mapWrap .pin.last .plb').getBoundingClientRect();return {cell:c.dataset.cell,overlap:!(id.right<=lb.left||id.left>=lb.right||id.bottom<=lb.top||id.top>=lb.bottom)};});
  check('최종목격 핀이 놓인 칸의 구역명이 핀 이름표와 겹치지 않음',pin&&pin.cell==='B3'&&!pin.overlap,pin);
  await ds.mouse.move(600,500);await ds.waitForTimeout(150);
  const awake=await ds.locator('#board').evaluate(e=>!e.classList.contains('wall-idle'));
  await ds.waitForTimeout(4400);
  const idle=await ds.evaluate(()=>document.getElementById('board').classList.contains('wall-idle')&&getComputedStyle(document.getElementById('displayMapTools')).opacity==='0');
  check('지도 조작 단추는 마우스를 움직이면 보이고 가만히 두면 숨김',awake&&idle,{awake,idle});
  const upd=await ds.locator('#hUpdated').textContent();
  check('입력 갱신 시각 표시',/^입력 갱신 \d\d:\d\d · /.test(upd),upd);
  const marks0=await ds.evaluate(()=>document.querySelectorAll('.wall-changed,.wall-new').length);
  check('처음 연 순간의 기존 내용은 새로 바뀐 것으로 표시하지 않음',marks0===0,marks0);
  await op.evaluate(()=>{S.grid.cells.D4={s:3,by:'지상'};commit();addEvent('note','가상 새 기록 강조 확인','D4');commit();});
  await ds.waitForFunction(()=>document.querySelector('#mapWrap [data-cell="D4"].wall-changed')&&document.querySelector('.log-row.wall-new'));
  const marked=await ds.evaluate(()=>({cells:[...document.querySelectorAll('#mapWrap .wall-changed')].map(e=>e.dataset.cell),rows:[...document.querySelectorAll('.log-row.wall-new .lx')].map(e=>e.textContent),top:document.getElementById('logBody').scrollTop}));
  check('입력 화면에서 바꾼 칸과 새 기록만 강조하고 기록 목록은 첫 쪽으로',JSON.stringify(marked.cells)==='["D4"]'&&marked.rows.length===1&&marked.rows[0].includes('가상 새 기록 강조 확인')&&marked.top===0,marked);
  await ds.screenshot({path:path.join(out,'wall-1920.png')});

  // 유인기 경보: 머리 숫자가 잘리지 않고 카드가 화면 안
  await op.evaluate(()=>{S.safety.manned=true;commit();});await ds.waitForFunction(()=>document.getElementById('board').classList.contains('banner-on'));await ds.waitForTimeout(300);
  const alert=await ds.evaluate(()=>({clipped:[...document.querySelectorAll('.kpi-v')].filter(v=>v.scrollWidth>v.clientWidth+2).map(v=>v.id),out:[...document.querySelectorAll('#board .col>.card')].filter(c=>c.getBoundingClientRect().bottom>innerHeight+1).map(c=>c.querySelector('h2').textContent),hdr:document.querySelector('#board .hdr').getBoundingClientRect().top>=document.getElementById('alertBanner').getBoundingClientRect().bottom-1}));
  check('유인기 경보 중에도 머리 숫자가 잘리지 않고 카드가 화면 밖으로 밀리지 않음',!alert.clipped.length&&!alert.out.length&&alert.hdr,alert);
  for(const [w,h] of [[1366,768],[1280,720]]){
    await ds.setViewportSize({width:w,height:h});await ds.waitForTimeout(400);
    const low=await ds.evaluate(()=>({out:[...document.querySelectorAll('#board .col>.card')].filter(c=>{const r=c.getBoundingClientRect();return r.bottom>innerHeight+1||r.height<40;}).map(c=>c.querySelector('h2').textContent),scroll:[...document.querySelectorAll('#board .col')].some(c=>c.scrollHeight>c.clientHeight+2&&getComputedStyle(c).overflowY!=='hidden')}));
    check(w+'×'+h+' 경보 중에도 모든 카드가 보이고 열 스크롤에 숨지 않음',!low.out.length&&!low.scroll,low);
    await ds.screenshot({path:path.join(out,'wall-alert-'+w+'.png')});
  }
  await op.evaluate(()=>{S.safety.manned=false;commit();});

  // 한 장 요약
  const before=await op.evaluate(()=>exportPayload(true));
  await op.locator('#tab-data').click();
  const sheet=op.waitForEvent('popup');await op.getByRole('button',{name:'교대·보고용 한 장 요약'}).click();const brief=await sheet;await brief.waitForLoadState();
  const text=await brief.locator('body').innerText();
  check('한 장 요약에 판정·우선 지시·구역 진행·기체·인원·중요 기록 포함',['비행 가능 판정','현재 우선 지시','수색구역 · 진행','기체','현행 인원','중요 기록'].every(t=>text.includes(t)),text.slice(0,200));
  await brief.emulateMedia({media:'print'});const pdf=await brief.pdf({format:'A4',printBackground:true});
  const pages=(pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)||[]).length;
  check('한 장 요약은 A4 한 장으로 인쇄',pages===1,pages);await brief.close();
  check('요약을 열어도 상황 자료는 그대로',await op.evaluate(v=>exportPayload(true)===v,before));

  // 진행 다시 보기
  await op.evaluate(()=>{const base=Date.now()-3600e3;[['B1','B2'],['C1','C2']].forEach((ids,i)=>{const z={};ids.forEach(k=>{S.grid.cells[k]={s:2,by:'드론'};z[k]=2;});addEvent('zone',ids.join(', ')+' 구역 수색완료',ids[0],true,base+i*600e3,{stateAction:'zoneState',zoneStates:z});});commit();});
  const replayBefore=await op.evaluate(()=>exportPayload(true));
  await op.getByRole('tab',{name:'수색 기록'}).click();
  await op.getByRole('button',{name:'수색 진행 다시 보기'}).click();
  const dlg=op.locator('dialog.replay-dialog');await dlg.waitFor();
  const steps=await op.evaluate(()=>replaySteps().length);
  await op.locator('[data-replay="seek"]').fill('0');
  const start=await op.evaluate(()=>[...document.querySelectorAll('[data-replay-cell].rs2')].length);
  await op.locator('[data-replay="seek"]').fill(String(steps));
  const end=await op.evaluate(()=>[...document.querySelectorAll('[data-replay-cell].rs2')].map(e=>e.dataset.replayCell));
  check('다시 보기는 완료 기록을 시간순으로 쌓아 보여 줌',steps>=3&&start===0&&['A1','A2','A3','B1','B2','C1','C2'].every(k=>end.includes(k)),{steps,start,end});
  await op.locator('[data-replay="play"]').click();await op.waitForTimeout(1100);
  check('재생 단추로 처음부터 차례로 진행',await op.locator('[data-replay="play"]').textContent()==='멈춤'||+(await op.locator('[data-replay="seek"]').inputValue())>=1);
  await op.keyboard.press('Escape');await op.waitForTimeout(200);
  check('Esc로 닫히고 여는 단추로 초점 복귀, 자료는 그대로',await dlg.count()===0&&await op.evaluate(()=>document.activeElement&&document.activeElement.dataset.act==='replay')&&await op.evaluate(v=>exportPayload(true)===v,replayBefore));
  await context.close();
  check('실행 중 JavaScript 오류 없음',errors.length===0,errors);
}finally{await writeFile(path.join(out,'results.json'),JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),results,errors},null,2));await browser.close();await new Promise(r=>server.close(r));}
assert.equal(results.filter(r=>!r.pass).length,0,'Wall board regression');
