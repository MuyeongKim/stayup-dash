/* Real service-worker persistence test. All downloads are from a temporary
 * local fixture server; no external map provider is contacted.
 * node tests/offline-browser.mjs --modules /absolute/node_modules
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, readFile, writeFile, copyFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleIndex = process.argv.indexOf('--modules');
const moduleRoot = moduleIndex >= 0 ? process.argv[moduleIndex + 1] : process.env.STAYUP_TEST_MODULES;
if (moduleIndex >= 0 && !moduleRoot) throw new Error('--modules requires an absolute node_modules directory');
const {chromium} = await import(moduleRoot ? pathToFileURL(path.join(moduleRoot, 'playwright/index.mjs')).href : 'playwright');
const outputIndex = process.argv.indexOf('--out');
const outputDirectory = outputIndex < 0 ? null : path.resolve(process.argv[outputIndex + 1]);
if (outputDirectory) await mkdir(outputDirectory, {recursive: true});
const temp = await mkdtemp(path.join(os.tmpdir(), 'stayup-offline-'));
const fixture = path.join(temp, 'app'), profile = path.join(temp, 'profile');
await mkdir(fixture);
const sourceManifest = JSON.parse(await readFile(path.join(root, 'offline-shell.json'), 'utf8'));
const runtimePaths = [...sourceManifest.assets.map(asset => asset.path), 'service-worker.js', 'offline-shell.json', 'scripts/build-offline-shell.mjs'];
for (const file of runtimePaths) {
  await mkdir(path.dirname(path.join(fixture, file)), {recursive: true});
  await copyFile(path.join(root, file), path.join(fixture, file));
}
// The fixture is a consistent snapshot even while another developer edits the
// checkout. Release-time --check separately verifies the committed manifest.
execFileSync(process.execPath, [path.join(fixture, 'scripts/build-offline-shell.mjs')]);
const originalManifest = JSON.parse(await readFile(path.join(fixture, 'offline-shell.json'), 'utf8'));
let corrupt = false, stalled = false, requests = [], browser, server, passed = 0;
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json'};
const origin = await new Promise(resolve => {
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    requests.push(pathname);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (stalled && pathname === '/offline-map-engine.js') return;
    if (pathname === '/uncached-provider.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('/* uncached test SDK */'); return; }
    try {
      const relative = pathname.replace(/^\/+/, ''), absolute = path.resolve(fixture, relative);
      if (!absolute.startsWith(fixture + path.sep)) throw new Error('Invalid path');
      let content = await readFile(absolute);
      if (corrupt && relative === 'offline-map-engine.js') content = Buffer.from('/* deliberately truncated build */');
      res.setHeader('Content-Type', mime[path.extname(absolute)] || 'application/octet-stream');
      res.end(content);
    } catch (_) { res.writeHead(404); res.end('Not found'); }
  });
  server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port));
});
const appURL = origin + '/stayup-dash.html?offline-browser-test=1';
const launch = () => chromium.launchPersistentContext(profile, {
  headless: true, channel: 'chrome', serviceWorkers: 'allow',
  viewport: {width: 1440, height: 1000}, deviceScaleFactor: 3,
  args: ['--disable-application-cache']
});
function pass(name) { passed++; console.log('PASS ' + name); }
async function rpc(page, type, expectedBuild, which = 'active') {
  return page.evaluate(async ({type, expectedBuild, which}) => {
    const registration = await navigator.serviceWorker.getRegistration('./');
    const worker = registration && registration[which];
    if (!worker) throw new Error('Missing service worker: ' + which);
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => reject(new Error('Service worker response timeout')), 30000);
      channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data); channel.port1.close(); };
      worker.postMessage({type, expectedBuild}, [channel.port2]);
    });
  }, {type, expectedBuild, which});
}
async function cacheEntries(page) {
  return page.evaluate(async () => {
    const names = await caches.keys(), result = [];
    for (const name of names) {
      const keys = await (await caches.open(name)).keys();
      result.push({name, urls: keys.map(request => request.url)});
    }
    return result;
  });
}
async function inspectMap(page) {
  await page.evaluate(() => {
    const button = document.querySelector('[data-sec="sec-grid"]');
    if (button) button.click();
  });
  await page.waitForFunction(() => typeof onlineMapReady === 'function' && onlineMapReady(document.getElementById('consMap')), null, {timeout: 20000});
  return page.evaluate(async () => {
    const host = document.getElementById('consMap');
    const element = host.querySelector('.online-map');
    const canvas = element.querySelector('canvas');
    const rectangle = node => { const r = node.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; };
    const adapter = onlineHosts.consMap.adapter;
    const point = adapter.project(geoAt(S.grid.pinFound.x / 100, S.grid.pinFound.y / 100));
    const mapRectangle = rectangle(element), pinRectangle = rectangle(host.querySelector('.pin.found'));
    return {
      source: effectiveMapSource(), packId: S.grid.offlineId,
      host: rectangle(host), element: mapRectangle, canvas: rectangle(canvas),
      cssPosition: getComputedStyle(element).position,
      pinOffset: {x: pinRectangle.x - mapRectangle.x - point.x, y: pinRectangle.y - mapRectangle.y - point.y},
      painted: host.querySelector('[data-cell="C3"]').classList.contains('s2'),
      packs: (await STAYUP_OFFLINE.list()).map(pack => ({id: pack.id, status: pack.status, tileCount: pack.tileCount}))
    };
  });
}
function assertMapRendered(map, packId) {
  assert.equal(map.source, 'offline'); assert.equal(map.packId, packId);
  assert.equal(map.cssPosition, 'absolute');
  assert.ok(map.element.height > 100 && map.canvas.height > 100, 'real renderer must have visible height');
  assert.ok(Math.abs(map.element.width - map.host.width) < 4 && Math.abs(map.element.height - map.host.height) < 4, 'map container must fill the app host');
  assert.ok(Math.abs(map.canvas.width - map.element.width) < 4 && Math.abs(map.canvas.height - map.element.height) < 4, 'MapLibre canvas must fill its map container');
  assert.ok(Math.abs(map.pinOffset.x) < 1 && Math.abs(map.pinOffset.y) < 1, 'pin must remain attached to its projected geographic point');
  assert.equal(map.painted, true);
  assert.ok(map.packs.some(pack => pack.id === packId && pack.status === 'ready' && pack.tileCount > 0));
}

try {
  browser = await launch();
  let page = browser.pages()[0] || await browser.newPage();
  await page.goto(appURL, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => typeof S === 'object' && typeof commit === 'function');
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
  assert.equal((await cacheEntries(page)).length, 0);
  pass('ordinary app load does not register or download an offline shell');

  await page.evaluate(async () => {
    await navigator.serviceWorker.register('./service-worker.js', {scope: './', updateViaCache: 'none'});
    await navigator.serviceWorker.ready;
  });
  assert.equal((await cacheEntries(page)).length, 0);
  assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), false);
  assert.deepEqual(await rpc(page, 'SHELL_STATUS'), {ready: false, build: originalManifest.build});
  pass('registration remains empty and does not take over the live mission');

  const stale = await rpc(page, 'PREPARE_SHELL', 'stale-build');
  assert.equal(stale.ready, false); assert.match(stale.error, /새 앱 버전/);
  assert.equal((await cacheEntries(page)).length, 0);
  pass('an old worker cannot claim the requested new build is prepared');

  corrupt = true;
  const failed = await rpc(page, 'PREPARE_SHELL', originalManifest.build);
  assert.equal(failed.ready, false); assert.match(failed.error, /버전이 바뀌/);
  assert.equal((await cacheEntries(page)).length, 0);
  corrupt = false;
  pass('checksum mismatch removes the partial cache and never marks ready');

  assert.deepEqual(await rpc(page, 'PREPARE_SHELL', originalManifest.build), {ready: true, build: originalManifest.build});
  assert.equal((await cacheEntries(page))[0].urls.length, originalManifest.assets.length + 2);
  assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), false);
  pass('explicit preparation commits every verified local runtime file');

  await page.reload({waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  stalled = true;
  const slowNetwork = await page.evaluate(async () => {
    const started = performance.now();
    const response = await fetch('./offline-map-engine.js?stalled-gateway=1', {cache: 'no-store'});
    return {elapsed: performance.now() - started, bytes: (await response.text()).length};
  });
  stalled = false;
  assert.ok(slowNetwork.elapsed >= 4500 && slowNetwork.elapsed < 15000);
  assert.ok(slowNetwork.bytes > 1000);
  pass('a stalled gateway falls back to the verified local file within a bounded wait');
  await page.evaluate(async () => {
    await fetch('./uncached-provider.js');
    // Same machine, different hostname is deliberately a different origin.
    await fetch(location.origin.replace('127.0.0.1', 'localhost') + '/uncached-provider.js');
  });
  assert.ok((await cacheEntries(page)).every(cache => cache.urls.every(url => !url.includes('uncached-provider'))));
  pass('neither an unlisted SDK nor a different-origin request enters the shell cache');

  const mission = await page.evaluate(async () => {
    await STAYUP_OFFLINE.init();
    // Deterministic vector bytes exercise the real tile database and MapLibre
    // renderer without downloading from a public archive during regression runs.
    const originalPMTiles = window.pmtiles;
    let pack;
    try {
      window.pmtiles = {PMTiles: class {
        async getHeader() { return {tileType: 1, minZoom: 0, maxZoom: 15}; }
        async getMetadata() { return {'planetiler:osm:osmosisreplicationtime': '2026-10-18T00:00:00Z'}; }
        async getZxy() { return {data: new Uint8Array([26,10,10,6,112,108,97,99,101,115,120,2]).buffer}; }
      }};
      pack = await STAYUP_OFFLINE.download({bbox: [127.2, 35.88, 127.22, 35.9], maxZoom: 14, name: '재시작 회귀검사 지도', sourceUrl: location.origin + '/synthetic.pmtiles'});
      window.__alternatePack = await STAYUP_OFFLINE.download({bbox: [127.2, 35.88, 127.22, 35.9], maxZoom: 14, name: '가상 다른 지도 B · O\'Brien <B> & "지도" · '+('긴 지도 이름 '.repeat(12)), sourceUrl: location.origin + '/synthetic.pmtiles'});
      window.__unnamedPacks = [];
      for (let i=0;i<2;i++) window.__unnamedPacks.push(await STAYUP_OFFLINE.download({bbox:[127.2,35.88,127.22,35.9],maxZoom:14,sourceUrl:location.origin+'/synthetic.pmtiles'}));
    } finally { window.pmtiles = originalPMTiles; }
    await refreshOfflinePacks(false);
    S.grid.pinLast = {x: 25, y: 35}; S.grid.pinFound = {x: 72, y: 61};
    S.grid.cells = {C3: {s: 2, by: '드론'}};
    S.grid.geo = {north: 35.9, south: 35.88, west: 127.2, east: 127.22, src: 'manual', at: 1234};
    S.grid.source = 'offline'; S.grid.offlineId = pack.id;
    if (!commit()) throw new Error('Fixture mission did not persist');
    window.__missionWorker = navigator.serviceWorker.controller;
    window.__controllerChanges = 0;
    navigator.serviceWorker.addEventListener('controllerchange', () => window.__controllerChanges++);
    return {source: S.grid.source, offlineId: S.grid.offlineId, pinLast: S.grid.pinLast, pinFound: S.grid.pinFound, cells: S.grid.cells, geo: S.grid.geo};
  });
  assertMapRendered(await inspectMap(page), mission.offlineId);
  pass('the actual app, local tile database and MapLibre canvas render together with anchored pins and painted cells');
  await page.locator('details[data-fold="map-setup"]>summary').click();
  const packSelect = page.locator('[data-offline-pack-select]');
  const names = await packSelect.locator('option').allTextContents();
  assert.ok(names.some(name => name.startsWith('재시작 회귀검사 지도 · ')));
  assert.ok(names.some(name => name.startsWith('가상 다른 지도 B · ')));
  assert.equal(new Set(names).size, names.length);
  pass('stored map choices expose distinct existing names alongside date, size, detail and coverage');
  const unnamed = await page.evaluate(() => window.__unnamedPacks.map(p => ({id:p.id,name:p.name})));
  for (const item of unnamed) assert.ok(names.some(name => name.startsWith('저장 지역 지도 ['+item.id.slice(-6)+'] · ')));
  assert.ok(unnamed.every(item => item.name==='저장 지역 지도'));
  pass('duplicate default names use existing ID suffixes without rewriting stored names');
  const beforeViewing = await page.evaluate(async () => ({state: exportPayload(true), pack: await (await STAYUP_OFFLINE.exportPack(S.grid.offlineId)).text()}));
  const alternateId = await page.evaluate(() => window.__alternatePack.id);
  assert.ok(names.some(name => name.includes('O\'Brien <B> & "지도"')));
  assert.equal(await packSelect.locator('b,script,img').count(), 0);
  await packSelect.selectOption(alternateId); await packSelect.focus();
  await packSelect.evaluate(el => { window.__catalogOption = el.selectedOptions[0]; });
  await page.waitForTimeout(2200);
  assert.equal(await packSelect.inputValue(), alternateId);
  assert.ok(await packSelect.evaluate(el => el.selectedOptions[0] === window.__catalogOption && el === document.activeElement));
  pass('special characters remain literal and periodic refresh preserves the chosen option node and focus');
  await page.evaluate(async () => { await STAYUP_OFFLINE.remove(window.__unnamedPacks[0].id); await refreshOfflinePacks(false); });
  assert.equal(await packSelect.locator('option').count(), names.length - 1);
  assert.equal(await packSelect.inputValue(), alternateId);
  pass('a real catalog change refreshes choices while keeping a valid pending selection');
  for (const [width, height, theme] of [[390,844,'light'], [320,800,'dark']]) {
    await page.setViewportSize({width, height});
    await page.locator('[data-theme-target="console"][data-theme-value="'+theme+'"]').click();
    await packSelect.selectOption(alternateId); await packSelect.scrollIntoViewIfNeeded();
    const rect = await packSelect.boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= width);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    pass(width+'px '+theme+' catalog with a long name fits without horizontal overflow');
    await packSelect.selectOption(mission.offlineId);
    if (outputDirectory && width === 390) {
      await page.evaluate(() => {const field=document.querySelector('[data-offline-pack-select]'),bar=document.querySelector('.console-workspace-bar');window.scrollBy(0,field.getBoundingClientRect().top-bar.getBoundingClientRect().bottom-24);});
      const field = await packSelect.boundingBox(), buttons = await page.locator('[data-offline-action="use"]').evaluate(e => e.parentElement.getBoundingClientRect().toJSON());
      await page.screenshot({path:path.join(outputDirectory,'offline-choice-preview.png'),clip:{x:field.x-2,y:field.y-23,width:field.width+4,height:buttons.bottom-field.y+27},scale:'device'});
    }
    if (outputDirectory) await page.screenshot({path:path.join(outputDirectory,'offline-catalog-'+width+'.png'),scale:'css'});
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('[data-theme-target="console"][data-theme-value="light"]').click();
  assert.equal(await page.evaluate(() => exportPayload(true)), beforeViewing.state);
  assert.equal(await page.evaluate(async () => (await STAYUP_OFFLINE.exportPack(S.grid.offlineId)).text()), beforeViewing.pack);
  pass('catalog selection and theme changes preserve mission data, selected map and every exported map byte');
  const nextApp = await readFile(path.join(fixture, 'stayup-dash.html'), 'utf8') + '\n<!-- offline-browser-next-build -->\n';
  await writeFile(path.join(fixture, 'stayup-dash.html'), nextApp);
  execFileSync(process.execPath, [path.join(fixture, 'scripts/build-offline-shell.mjs')]);
  const updatedManifest = JSON.parse(await readFile(path.join(fixture, 'offline-shell.json'), 'utf8'));
  assert.notEqual(updatedManifest.build, originalManifest.build);
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration('./')).update(); });
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration('./')).waiting);
  assert.deepEqual(await rpc(page, 'PREPARE_SHELL', updatedManifest.build, 'waiting'), {ready: true, build: updatedManifest.build});
  const unchanged = await page.evaluate(() => ({
    same: window.__missionWorker === navigator.serviceWorker.controller,
    changes: window.__controllerChanges,
    mission: {source: S.grid.source, offlineId: S.grid.offlineId, pinLast: S.grid.pinLast, pinFound: S.grid.pinFound, cells: S.grid.cells, geo: S.grid.geo}
  }));
  assert.equal(unchanged.same, true); assert.equal(unchanged.changes, 0); assert.deepEqual(unchanged.mission, mission);
  pass('a prepared update waits while the live mission and controlling worker remain intact');

  await browser.close(); browser = null;
  await new Promise(resolve => server.close(resolve)); server = null;
  requests = [];
  browser = await launch();
  page = browser.pages()[0] || await browser.newPage();
  const externalRequests = [];
  page.on('request', request => {
    if (!request.url().startsWith(origin + '/') && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) externalRequests.push(request.url());
  });
  const navigation = await page.goto(appURL, {waitUntil: 'domcontentloaded', timeout: 30000});
  await page.waitForFunction(() => typeof S === 'object' && !!navigator.serviceWorker.controller);
  assert.ok((await navigation.text()).includes('offline-browser-next-build'));
  assert.deepEqual(await rpc(page, 'SHELL_STATUS'), {ready: true, build: updatedManifest.build});
  const restarted = await page.evaluate(async paths => {
    const runtime = [];
    for (const path of paths) {
      const response = await fetch('./' + path + '?fresh-offline-check=1', {cache: 'reload'});
      runtime.push({path, ok: response.ok, bytes: (await response.arrayBuffer()).byteLength});
    }
    return {runtime, mission: {source: S.grid.source, offlineId: S.grid.offlineId, pinLast: S.grid.pinLast, pinFound: S.grid.pinFound, cells: S.grid.cells, geo: S.grid.geo}};
  }, updatedManifest.assets.map(asset => asset.path));
  assert.deepEqual(restarted.mission, mission);
  assert.ok(restarted.runtime.every(asset => asset.ok && asset.bytes > 0));
  assert.equal(requests.length, 0);
  pass('after browser restart with the HTTP server stopped, the app, renderer and mission state reopen from storage');
  assertMapRendered(await inspectMap(page), mission.offlineId);
  assert.deepEqual(externalRequests, []);
  pass('the actual map canvas, stored vector tiles, pins and painted cells render after a fully offline browser restart');
  assert.ok((await page.locator('#consMapWorkspace [data-offline-map-status]').innerText()).includes('재시작 회귀검사 지도'));
  if (!await page.locator('details[data-fold="map-setup"]').evaluate(e => e.open)) await page.locator('details[data-fold="map-setup"]>summary').click();
  const restartedNames = await page.locator('[data-offline-pack-select] option').allTextContents();
  assert.ok(restartedNames.some(name => name.startsWith('가상 다른 지도 B · ')), JSON.stringify({names: restartedNames, packs: await page.evaluate(() => offlinePacks.map(p => ({id:p.id,name:p.name})))}));
  assert.deepEqual(externalRequests, []);
  pass('active map identity and catalog names remain visible after fully offline restart');
  console.log(JSON.stringify({passed, scope: 'Real persistent Chrome; HTTP server shut down before offline restart; no provider credentials or external map requests.'}, null, 2));
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(temp, {recursive: true, force: true});
}
