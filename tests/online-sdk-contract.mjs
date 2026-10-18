import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Run: node tests/online-sdk-contract.mjs --modules /absolute/node_modules
// Omitting --modules uses the project's installed playwright package.
const moduleIndex=process.argv.indexOf('--modules');
const moduleRoot=moduleIndex>=0?process.argv[moduleIndex+1]:process.env.STAYUP_TEST_MODULES;
if(moduleIndex>=0&&!moduleRoot)throw new Error('--modules requires an absolute node_modules directory');
const {chromium}=await import(moduleRoot?pathToFileURL(path.join(moduleRoot,'playwright/index.mjs')).href:'playwright');
const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=fs.readFileSync(path.join(repoRoot,'stayup-dash.html'),'utf8');
const start=html.indexOf('var onlineSDK = (function () {');
const end=html.indexOf('\n/* 온라인 배경',start);
const source=html.slice(start,end);
const browser=await chromium.launch({headless:true,channel:'chrome'});
let passed=0;
async function context(config={}){
  const page=await browser.newPage();
  await page.route('**/*',route=>route.abort());
  await page.setContent('<div id="host" style="position:relative;width:640px;height:360px"><div id="map" style="width:640px;height:360px"></div></div>');
  await page.evaluate(config=>{
    const append=document.head.appendChild.bind(document.head);
    window.requests=[];window.maps=[];window.fixture=config;
    document.head.appendChild=function(node){if(node.tagName==='SCRIPT'&&node.src){requests.push(node);return node;}return append(node);};
    const nativeTimeout=window.setTimeout.bind(window);
    if(config.fastTimeout)window.setTimeout=(fn,ms,...args)=>nativeTimeout(fn,ms>=10000?60:ms,...args);
    window.fakeApi=function(provider){
      class LatLng{constructor(lat,lng){this.a=lat;this.b=lng;}lat(){return this.a;}lng(){return this.b;}}
      class Point{constructor(x,y){this.x=x;this.y=y;}}
      class Bounds{constructor(sw,ne){this.sw=sw;this.ne=ne;}}
      class Map{
        constructor(el,opts){this.el=el;this.opts=opts;this.center=opts.center;this.zoom=opts.zoom;this.handlers={};this.overlays=[];this.destroyed=false;maps.push(this);}
        addListener(event,fn){(this.handlers[event]||(this.handlers[event]=[])).push(fn);return {remove:()=>{this.handlers[event]=this.handlers[event].filter(x=>x!==fn);}};}
        emit(event){for(const fn of this.handlers[event]||[])fn();if(!fixture.noProjection)for(const o of this.overlays)o.draw();}
        getCenter(){return this.center;}
        setCenter(c){this.center=c;this.emit('center_changed');}
        getZoom(){return this.zoom;}
        setZoom(z){this.zoom=Math.max(1,Math.min(21,Math.round(z)));this.emit('zoom_changed');}
        fitBounds(bounds){this.fitCalls=(this.fitCalls||0)+1;if(fixture.noFitIdle)return;const apply=()=>{this.zoom=fixture.fitZoom||11;this.center=new LatLng(36,127);this.emit('bounds_changed');this.emit('idle');};if(fixture.deferFit)nativeTimeout(apply,fixture.deferFit);else apply();}
        getProjection(){const m=this;return {
          fromCoordToOffset(p){return this.fromLatLngToContainerPixel(p);},
          fromOffsetToCoord(p){return this.fromContainerPixelToLatLng(p);},
          fromLatLngToContainerPixel(p){return new Point(320+(p.lng()-m.center.lng())*2**m.zoom,180+(m.center.lat()-p.lat())*2**m.zoom);},
          fromContainerPixelToLatLng(p){return new LatLng(m.center.lat()-(p.y-180)/2**m.zoom,m.center.lng()+(p.x-320)/2**m.zoom);}
        };}
        setSize(s){this.size=s;}
        destroy(){this.destroyed=true;}
        unbindAll(){this.destroyed=true;}
      }
      class OverlayView{
        setMap(map){this.map=map;if(!map){this.onRemove();return;}map.overlays.push(this);this.onAdd();if(!fixture.noProjection)nativeTimeout(()=>{if(this.map)this.draw();},0);}
        getProjection(){return this.map.getProjection();}
      }
      return {Map,LatLng,Point,Size:Point,LatLngBounds:Bounds,OverlayView,
        event:{addListener:(obj,e,fn)=>obj.addListener(e,fn),clearInstanceListeners:obj=>{obj.handlers={};}},
        Event:{addListener:(obj,e,fn)=>obj.addListener(e,fn),removeListener:listener=>listener.remove()},
        MapTypeId:{HYBRID:'hybrid',NORMAL:'normal'},RenderingType:{RASTER:'RASTER'}};
    };
    window.finishLoad=function(provider){const api=fakeApi(provider);if(provider==='naver')window.naver={maps:api};else window.google={maps:api};const script=requests[requests.length-1];window[new URL(script.src).searchParams.get('callback')]();};
    window.geo={north:36.01,south:35.99,east:127.02,west:126.98};
  },config);
  await page.addScriptTag({content:source});
  return page;
}
async function run(label,fn){await fn();passed++;console.log('PASS '+label);}
try {
await run('no network before explicit load; NAVER new parameter and key encoding',async()=>{
 const p=await context();const result=await p.evaluate(async()=>{const before=requests.length;const promise=onlineSDK.load('naver','abc&callback=evil');const same=promise===onlineSDK.load('naver','abc&callback=evil');const u=new URL(requests[0].src);finishLoad('naver');await promise;return {before,same,key:u.searchParams.get('ncpKeyId'),old:u.searchParams.has('ncpClientId'),callbacks:u.searchParams.getAll('callback').length};});assert.deepEqual(result,{before:0,same:true,key:'abc&callback=evil',old:false,callbacks:1});await p.close();
});
await run('Google load flags + ready key change rejected',async()=>{
 const p=await context();const result=await p.evaluate(async()=>{const promise=onlineSDK.load('google','test-google');const u=new URL(requests[0].src);finishLoad('google');await promise;let msg='';try{await onlineSDK.load('google','other-key');}catch(e){msg=e.message;}return {loading:u.searchParams.get('loading'),version:u.searchParams.get('v'),lang:u.searchParams.get('language'),count:requests.length,msg};});assert.equal(result.loading,'async');assert.equal(result.version,'quarterly');assert.equal(result.lang,'ko');assert.equal(result.count,1);assert.match(result.msg,/새로고침/);await p.close();
});
for(const provider of ['naver','google']){
 await run(provider+' invalid callback rejected',async()=>{const p=await context();const msg=await p.evaluate(async provider=>{const promise=onlineSDK.load(provider,'test-key').catch(e=>e.message);window[new URL(requests[0].src).searchParams.get('callback')]();return await promise;},provider);assert.match(msg,/SDK 준비/);await p.close();});
 await run(provider+' network and timeout errors reject with actionable Korean text',async()=>{
  for(const mode of ['network','timeout']){const p=await context({fastTimeout:true});const msg=await p.evaluate(async({provider,mode})=>{const promise=onlineSDK.load(provider,'test-key').catch(e=>e.message);if(mode==='network')requests[0].onerror();return await promise;},{provider,mode});assert.match(msg,/인터넷 연결/);await p.close();}
 });
 await run(provider+' auth failure pending load; active map callback and destruction',async()=>{
  const p=await context();const result=await p.evaluate(async provider=>{const promise=onlineSDK.load(provider,'test-key');finishLoad(provider);await promise;window.errors=[];const adapter=await onlineSDK.create(provider,document.getElementById('map'),{geo},()=>{},m=>errors.push(m));window[provider==='naver'?'navermap_authFailure':'gm_authFailure']();return {errors,destroyed:maps[0].destroyed,point:adapter.project({lat:36,lon:127})};},provider);assert.equal(result.errors.length,1);assert.match(result.errors[0],/인증/);assert.equal(result.destroyed,true);assert.equal(result.point,null);await p.close();
  const q=await context();const msg=await q.evaluate(async provider=>{const promise=onlineSDK.load(provider,'test-key').catch(e=>e.message);window[provider==='naver'?'navermap_authFailure':'gm_authFailure']();return await promise;},provider);assert.match(msg,/인증/);await q.close();
 });
 await run(provider+' projection methods, pan direction, gestures and attribution flags',async()=>{
  const p=await context();const result=await p.evaluate(async provider=>{const l=onlineSDK.load(provider,'test-key');finishLoad(provider);await l;let redraw=0;const a=await onlineSDK.create(provider,document.getElementById('map'),{geo,center:{lat:36,lon:127},zoom:16},()=>redraw++,()=>{});const origin=a.project({lat:36,lon:127});a.panBy(40,20);const after=a.project({lat:36,lon:127});const roundtrip=a.unproject(after);a.setZoom(17);await new Promise(r=>setTimeout(r,40));return {origin,after,roundtrip,zoom:a.getZoom(),redraw,opts:maps[0].opts};},provider);assert.deepEqual(result.origin,{x:320,y:180});assert.deepEqual(result.after,{x:280,y:160});assert.deepEqual(result.roundtrip,{lat:36,lon:127});assert.equal(result.zoom,17);assert.ok(result.redraw>0);assert.equal(result.opts.draggable,false);assert.equal(result.opts.keyboardShortcuts,false);assert.equal(result.opts.disableDoubleClickZoom,true);if(provider==='naver'){assert.equal(result.opts.logoControl,true);assert.equal(result.opts.mapDataControl,true);assert.equal(result.opts.pinchZoom,false);}else{assert.equal(result.opts.gestureHandling,'none');assert.equal(result.opts.renderingType,'RASTER');assert.equal(result.opts.tilt,0);}await p.close();
 });
 await run(provider+' projection timeout destroys incomplete map',async()=>{const p=await context({fastTimeout:true,noProjection:true});const result=await p.evaluate(async provider=>{const l=onlineSDK.load(provider,'test-key');finishLoad(provider);await l;const errors=[];let message='';try{await onlineSDK.create(provider,document.getElementById('map'),{geo},()=>{},m=>errors.push(m));}catch(e){message=e.message;}return {message,errors,destroyed:maps[0].destroyed};},provider);assert.match(result.message,/좌표 준비/);assert.equal(result.errors.length,1);assert.equal(result.destroyed,true);await p.close();});
}
await run('external SDK global is not silently adopted',async()=>{const p=await context();const result=await p.evaluate(async()=>{window.google={maps:fakeApi('google')};let msg='';try{await onlineSDK.load('google','test-key');}catch(e){msg=e.message;}return {msg,count:requests.length};});assert.match(result.msg,/이미 존재/);assert.equal(result.count,0);await p.close();});
await run('initial asynchronous fit settles before create resolves',async()=>{
 const p=await context({deferFit:100,fitZoom:11});const r=await p.evaluate(async()=>{const l=onlineSDK.load('google','test-key');finishLoad('google');await l;let resolved=false;const promise=onlineSDK.create('google',document.getElementById('map'),{geo},()=>{},()=>{}).then(a=>{resolved=true;return a;});await new Promise(r=>setTimeout(r,35));const early=resolved;const a=await promise;return {early,zoom:a.getZoom()};});assert.equal(r.early,false);assert.equal(r.zoom,11);await p.close();
});
await run('reset Promise waits for fit and repeated no-op fit completes',async()=>{
 const p=await context({deferFit:100,fitZoom:11});const r=await p.evaluate(async()=>{const l=onlineSDK.load('google','test-key');finishLoad('google');await l;const a=await onlineSDK.create('google',document.getElementById('map'),{geo,center:{lat:36,lon:127},zoom:18},()=>{},()=>{});let settled=false;const fitting=a.fitBounds(geo).then(()=>{settled=true;});await new Promise(r=>setTimeout(r,35));const early=settled;await fitting;const zoom=a.getZoom(),calls=maps[0].fitCalls;await a.fitBounds(geo);return {early,zoom,calls,repeatedCalls:maps[0].fitCalls};});assert.equal(r.early,false);assert.equal(r.zoom,11);assert.equal(r.repeatedCalls,r.calls);await p.close();
});
await run('first no-op fit proves projected extent and returns without native idle',async()=>{
 const p=await context();const r=await p.evaluate(async()=>{const l=onlineSDK.load('google','test-key');finishLoad('google');await l;const a=await onlineSDK.create('google',document.getElementById('map'),{geo,center:{lat:36,lon:127},zoom:11},()=>{},()=>{});const z=2**11,mid=36+12/z;const exact={north:mid+72/z,south:mid-72/z,east:127+296/z,west:127-296/z};await a.fitBounds(exact);return {calls:maps[0].fitCalls||0,zoom:a.getZoom()};});assert.equal(r.calls,0);assert.equal(r.zoom,11);await p.close();
});
await run('pending fit rejects on destroy and manual zoom without stale completion',async()=>{
 for(const action of ['destroy','zoom']){const p=await context({deferFit:100,fitZoom:11});const r=await p.evaluate(async action=>{const l=onlineSDK.load('google','test-key');finishLoad('google');await l;const a=await onlineSDK.create('google',document.getElementById('map'),{geo,center:{lat:36,lon:127},zoom:18},()=>{},()=>{});const pending=a.fitBounds(geo).then(()=>'',e=>e.message);if(action==='destroy')a.destroy();else a.setZoom(17);return await pending;},action);assert.match(r,/취소/);await p.close();}
});
await run('fit timeout rejects and reports actionable error',async()=>{
 const p=await context({fastTimeout:true,noFitIdle:true});const r=await p.evaluate(async()=>{const l=onlineSDK.load('google','test-key');finishLoad('google');await l;const errors=[];const a=await onlineSDK.create('google',document.getElementById('map'),{geo,center:{lat:36,lon:127},zoom:18},()=>{},m=>errors.push(m));let message='';try{await a.fitBounds(geo);}catch(e){message=e.message;}return {message,errors};});assert.match(r.message,/범위 맞춤 시간/);assert.equal(r.errors.length,1);await p.close();
});
console.log(JSON.stringify({passed,scope:'Browser contract tests with fake provider SDKs; no real API keys or remote requests.'},null,2));
} finally {
  await browser.close();
}
