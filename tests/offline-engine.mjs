/* Offline engine invariants in a real browser. Network archives are deterministic
 * fixtures; a real Source Cooperative region was separately downloaded and shown.
 * node tests/offline-engine.mjs --modules /absolute/node_modules
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pos=process.argv.indexOf('--modules');
const modules=pos>=0?process.argv[pos+1]:process.env.STAYUP_TEST_MODULES;
const {chromium}=await import(modules?pathToFileURL(path.join(modules,'playwright/index.mjs')).href:'playwright');
let requests=[];
const server=createServer(async(req,res)=>{
  requests.push(req.url);
  if(req.url==='/') {res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><div id="map" style="width:900px;height:500px"></div><script src="offline-map-engine.js"></script>');return;}
  if(req.url==='/fixture.pmtiles') {res.writeHead(206,{'Content-Length':'4','Content-Range':'bytes 0-3/1000','ETag':'"fixture-v1"','Last-Modified':'Sun, 18 Oct 2026 00:00:00 GMT'});res.end(Buffer.from([1,2,3,4]));return;}
  try{const name=req.url.split('?')[0];res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css':'application/octet-stream');res.end(await readFile(root+name));}catch(_){res.writeHead(404);res.end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,channel:'chrome'}),context=await browser.newContext(),page=await context.newPage();
let checks=0;
function pass(name){checks++;console.log('PASS '+name);}
async function setup(p){await p.goto(origin+'/');await p.evaluate(async()=>{
 await STAYUP_OFFLINE.init();
 window.fixture={calls:0,failAt:0,delay:0};
 window.pmtiles={PMTiles:class{
  constructor(source){this.source=source;}
  async getHeader(){await this.source.getBytes(0,4);return{tileType:1,minZoom:0,maxZoom:15};}
  async getMetadata(){return{'planetiler:osm:osmosisreplicationtime':'2026-10-18T00:00:00Z'};}
  async getZxy(z,x,y,signal){fixture.calls++;if(fixture.delay)await new Promise(r=>setTimeout(r,fixture.delay));if(signal.aborted)throw new DOMException('aborted','AbortError');if(fixture.calls===fixture.failAt)throw new Error('fixture download failure');if(z===1)return undefined;return{data:new Uint8Array([26,10,10,6,112,108,97,99,101,115,120,2]).buffer};}
 }};
 window.opts={bbox:[127.2,35.88,127.22,35.9],maxZoom:3,name:'테스트 지역',sourceUrl:location.origin+'/fixture.pmtiles'};
});}
try{
 await setup(page);
 assert.equal(await page.evaluate(()=>STAYUP_OFFLINE.estimate(opts).tileCount),4);pass('deterministic regional tile estimate');
 assert(await page.evaluate(()=>{try{STAYUP_OFFLINE.estimate({bbox:[-180,-85,180,85],maxZoom:15});return false;}catch(e){return /범위/.test(e.message);}}));pass('oversized scope rejected before download');
 const pack=await page.evaluate(async()=>{window.good=await STAYUP_OFFLINE.download(opts);return good;});
 assert.equal(pack.status,'ready');assert.equal(pack.tileCount,4);assert.equal(pack.bytes,36);assert.equal(pack.source.dateKind,'osm');pass('download includes valid absent tiles and verifies committed pack');
 assert(await page.evaluate(()=>STAYUP_OFFLINE.isCovering(good,{west:127.201,south:35.881,east:127.219,north:35.899})));pass('coverage checks geography, not current screen');
 await page.evaluate(async()=>{fixture.calls=0;fixture.failAt=3;try{await STAYUP_OFFLINE.download(opts);}catch(_){}fixture.failAt=0;});
 assert.equal((await page.evaluate(()=>STAYUP_OFFLINE.list())).length,1);pass('partial network failure preserves previous ready pack');
 assert.equal(await page.evaluate(async()=>{fixture.calls=0;const c=new AbortController();try{await STAYUP_OFFLINE.download({...opts,signal:c.signal,onProgress:p=>{if(p.completed===1)c.abort();}});}catch(e){return e.name;}}),'AbortError');
 assert.equal((await page.evaluate(()=>STAYUP_OFFLINE.list())).length,1);pass('cancel removes staging data and preserves prior map');
 await page.evaluate(async()=>{window.exported=await (await STAYUP_OFFLINE.exportPack(good.id)).text();await STAYUP_OFFLINE.remove(good.id);window.restored=await STAYUP_OFFLINE.importPack(new Blob([exported]));});
 assert.equal(await page.evaluate(()=>restored.id),pack.id);pass('verified export/import preserves original mission pack reference');
 assert(await page.evaluate(async()=>{const bad=JSON.parse(exported);bad.tiles[0].data='AAAA';try{await STAYUP_OFFLINE.importPack(new Blob([JSON.stringify(bad)]));return false;}catch(_){return true;}}));
 assert.equal((await page.evaluate(()=>STAYUP_OFFLINE.list())).length,1);pass('corrupt file rejected without replacing existing map');
 assert(await page.evaluate(async()=>{const bad=JSON.parse(exported);bad.manifest.source.url='javascript:alert(1)';try{await STAYUP_OFFLINE.importPack(new Blob([JSON.stringify(bad)]));return false;}catch(_){return true;}}));pass('unsafe source URL rejected during import');
 assert(await page.evaluate(async()=>{const bad=JSON.parse(exported);bad.tiles[1]=bad.tiles[0];try{await STAYUP_OFFLINE.importPack(new Blob([JSON.stringify(bad)]));return false;}catch(_){return true;}}));pass('duplicate tile keys rejected');
 assert(await page.evaluate(async()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(this.name==='tiles'&&value.data&&value.data.byteLength){value={...value,data:value.data.slice(0)};new Uint8Array(value.data)[0]^=1;}return original.call(this,value,...args);};try{await STAYUP_OFFLINE.download(opts);return false;}catch(e){return /검증/.test(e.message);}finally{IDBObjectStore.prototype.put=original;}}));
 assert.equal((await page.evaluate(()=>STAYUP_OFFLINE.list())).length,1);pass('read-back corruption prevents a pack from becoming ready');
 assert(await page.evaluate(async()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(this.name==='tiles')throw new DOMException('quota fixture','QuotaExceededError');return original.call(this,value,...args);};try{await STAYUP_OFFLINE.download(opts);return false;}catch(e){return /공간/.test(e.message);}finally{IDBObjectStore.prototype.put=original;}}));
 assert.equal((await page.evaluate(()=>STAYUP_OFFLINE.list())).length,1);pass('storage quota error preserves existing pack and reports the cause');
 const other=await context.newPage();await setup(other);
 await page.evaluate(()=>{fixture.calls=0;fixture.delay=80;window.pending=STAYUP_OFFLINE.download({...opts,maxZoom:8}).then(()=> 'unexpected-ready',()=> 'cancelled');});
 await page.waitForTimeout(140);await other.evaluate(()=>STAYUP_OFFLINE.purge());assert.equal(await page.evaluate(()=>pending),'cancelled');assert.equal((await page.evaluate(()=>STAYUP_OFFLINE.list())).length,0);pass('purge in another tab invalidates in-flight writes with persistent epoch');
 await other.close();await page.bringToFront();
 await page.evaluate(async()=>{fixture.delay=0;window.restored=await STAYUP_OFFLINE.importPack(new Blob([exported]));});
 const outbound=[];page.on('request',r=>{if(!r.url().startsWith(origin)&&!r.url().startsWith('blob:'))outbound.push(r.url());});
 await context.setOffline(true);
 const corners=await page.evaluate(async()=>{window.adapter=await STAYUP_OFFLINE.createMap(document.querySelector('#map'),{packId:restored.id});return[adapter.project({lat:35.9,lon:127.2}),adapter.project({lat:35.88,lon:127.22})];});
 assert(corners.every(p=>p.x>=0&&p.x<=900&&p.y>=0&&p.y<=500));assert.deepEqual(outbound,[]);pass('offline MapLibre renderer shows full scope and makes no remote requests');
 const roundtrip=await page.evaluate(()=>{const p={lat:35.89,lon:127.21};adapter.setZoom(16);adapter.panBy(60,-40);const q=adapter.unproject(adapter.project(p));return{lat:q.lat-p.lat,lon:q.lon-p.lon};});
 assert(Math.abs(roundtrip.lat)<1e-8&&Math.abs(roundtrip.lon)<1e-8);pass('projection remains geographically anchored after zoom and pan');
 const normalized=await page.evaluate(()=>{adapter.setCenter({lat:35.89,lon:127.21});adapter.setZoom(15);const a=adapter.project({lat:35.89,lon:127.21}),b=adapter.project({lat:35.89,lon:127.211});return{zoom:adapter.getZoom(),dx:b.x-a.x,min:adapter.minZoom,max:adapter.maxZoom};});
 assert.equal(normalized.zoom,15);assert.equal(normalized.min,1);assert.equal(normalized.max,21);assert(Math.abs(normalized.dx-256*Math.pow(2,15)*0.001/360)<1e-5);pass('camera zoom matches the independent 256-pixel Naver/Google Mercator scale');
 await page.evaluate(()=>adapter.destroy());
 const initial=await page.evaluate(async()=>{window.adapter=await STAYUP_OFFLINE.createMap(document.querySelector('#map'),{packId:restored.id,center:{lat:35.89,lon:127.21},zoom:15});const a=adapter.project({lat:35.89,lon:127.21}),b=adapter.project({lat:35.89,lon:127.211});return{zoom:adapter.getZoom(),dx:b.x-a.x};});
 assert.equal(initial.zoom,15);assert(Math.abs(initial.dx-normalized.dx)<1e-5);pass('restoring a provider camera keeps the same zoom and pixel scale');
 assert(await page.evaluate(()=>{adapter.setCenter({lat:80,lon:0});const c=adapter.getCenter();return c.lon>=restored.bbox[0]&&c.lon<=restored.bbox[2]&&c.lat>=restored.bbox[1]&&c.lat<=restored.bbox[3];}));pass('camera center cannot drift outside saved region');
 await page.evaluate(()=>adapter.destroy());console.log(`${checks} offline engine checks passed`);
}finally{await browser.close();server.close();}
