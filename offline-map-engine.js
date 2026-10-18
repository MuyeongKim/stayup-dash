/* STAY UP regional offline basemap engine.
 * The only external request is an explicit download() from a downloadable PMTiles
 * archive. Rendering reads IndexedDB only. No Naver/Google/OSM public raster cache.
 */
(function (global) {
  'use strict';
  var DB_NAME = 'stayup-offline-regions-v1';
  var SOURCE_URL = 'https://data.source.coop/protomaps/openstreetmap/v4.pmtiles';
  var LIMITS = Object.freeze({ maxZoom: 15, maxTiles: 4096, maxBytes: 100 * 1024 * 1024,
    maxTileBytes: 2 * 1024 * 1024, maxFileBytes: 145 * 1024 * 1024, maxPacks: 12 });
  var ASSETS = ['vendor/maplibre-gl-5.24.0.js', 'vendor/maplibre-gl-5.24.0.css', 'vendor/pmtiles-4.5.0.js'];
  var baseURL = document.currentScript && document.currentScript.src || location.href;
  var dbPromise, assetPromise, protocolInstalled = false, active = new Set(), packCache = new Map();
  var encoder = new TextEncoder();
  function error(message) { return new Error(message); }
  function cancelled() { return new DOMException('지도 저장이 취소되었습니다.', 'AbortError'); }
  function checkSignal(signal) { if (signal && signal.aborted) throw cancelled(); }
  function uuid() { return 'region-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)); }
  function request(req) { return new Promise(function (resolve, reject) { req.onsuccess = function () { resolve(req.result); }; req.onerror = function () { reject(req.error); }; }); }
  function transactionDone(tx) { return new Promise(function (resolve, reject) { tx.oncomplete = resolve; tx.onerror = function () { reject(tx.error || error('지도 저장에 실패했습니다.')); }; tx.onabort = function () { reject(tx.error || error('지도 저장 작업이 중단되었습니다.')); }; }); }
  function database() {
    if (!dbPromise) dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) return reject(error('이 브라우저에서는 오프라인 지도를 저장할 수 없습니다.'));
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        db.createObjectStore('packs', { keyPath: 'id' });
        db.createObjectStore('tiles', { keyPath: 'key' });
        db.createObjectStore('meta');
        req.transaction.objectStore('meta').put(0, 'epoch');
      };
      req.onsuccess = function () { var db = req.result; db.onversionchange = function () { db.close(); dbPromise = null; }; resolve(db); };
      req.onerror = function () { dbPromise = null; reject(req.error); };
      req.onblocked = function () { reject(error('다른 STAY UP 창을 닫은 뒤 다시 시도해 주세요.')); };
    });
    return dbPromise;
  }
  async function read(store, key) { var db = await database(); return request(db.transaction(store).objectStore(store).get(key)); }
  async function guardedWrite(epoch, stores, action) {
    var db = await database(), tx = db.transaction(['meta'].concat(stores), 'readwrite'), done = transactionDone(tx), writeError = null;
    var req = tx.objectStore('meta').get('epoch');
    req.onsuccess = function () {
      if ((req.result || 0) !== epoch) { tx.abort(); return; }
      try { action(tx); } catch (e) { writeError = e; tx.abort(); }
    };
    try { await done; } catch (e) { throw writeError || e; }
  }
  function validBbox(bbox) {
    return Array.isArray(bbox) && bbox.length === 4 && bbox.every(Number.isFinite)
      && bbox[0] >= -180 && bbox[2] <= 180 && bbox[1] >= -85 && bbox[3] <= 85 && bbox[0] < bbox[2] && bbox[1] < bbox[3];
  }
  function bboxFrom(value) { return Array.isArray(value) ? value.slice() : value && [value.west, value.south, value.east, value.north]; }
  function lonTile(lon, z) { return Math.max(0, Math.min(Math.pow(2, z) - 1, Math.floor((lon + 180) / 360 * Math.pow(2, z)))); }
  function latTile(lat, z) { var r = lat * Math.PI / 180; return Math.max(0, Math.min(Math.pow(2, z) - 1, Math.floor((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * Math.pow(2, z)))); }
  function tileList(bbox, maxZoom) {
    if (!validBbox(bbox)) throw error('저장할 지역의 위경도 범위를 확인해 주세요.');
    if (!Number.isInteger(maxZoom) || maxZoom < 0 || maxZoom > LIMITS.maxZoom) throw error('지도 상세 수준은 0~15 단계만 지원합니다.');
    var result = [];
    for (var z = 0; z <= maxZoom; z++) {
      var x0 = lonTile(bbox[0], z), x1 = lonTile(bbox[2], z), y0 = latTile(bbox[3], z), y1 = latTile(bbox[1], z);
      if (result.length + (x1 - x0 + 1) * (y1 - y0 + 1) > LIMITS.maxTiles) throw error('저장 범위가 너무 큽니다. 지역을 줄이거나 상세 수준을 낮춰 주세요. (최대 4,096개 지도 조각)');
      for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) result.push({ z: z, x: x, y: y, tile: z + '/' + x + '/' + y });
    }
    return result;
  }
  function estimate(options) {
    var bbox = bboxFrom(options.bbox || options.geo), maxZoom = options.maxZoom == null ? 15 : Number(options.maxZoom), tiles = tileList(bbox, maxZoom);
    return { bbox: bbox, minZoom: 0, maxZoom: maxZoom, tileCount: tiles.length, maxBytes: LIMITS.maxBytes, estimatedBytes: null };
  }
  function isCovering(meta, geo) { var b = bboxFrom(geo), a = meta && meta.bbox, e = 1e-9; return !!(meta && meta.status === 'ready' && validBbox(a) && validBbox(b) && a[0] <= b[0] + e && a[1] <= b[1] + e && a[2] >= b[2] - e && a[3] >= b[3] - e); }
  async function hash(value) {
    if (!crypto.subtle) throw error('지도 검증에는 HTTPS 또는 localhost에서 실행해야 합니다.');
    var digest = await crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : value);
    return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function validateTile(data) {
    if (!(data instanceof ArrayBuffer) || data.byteLength > LIMITS.maxTileBytes) throw error('지도 조각 크기가 허용 범위를 초과했습니다.');
    // A vector tile is a protobuf sequence of length-delimited Layer (field 3).
    var b = new Uint8Array(data), p = 0;
    function varint() { var value = 0, shift = 0; while (p < b.length && shift <= 49) { var v = b[p++]; value += (v & 127) * Math.pow(2, shift); if (!(v & 128)) return value; shift += 7; } throw error('올바르지 않은 지도 조각입니다.'); }
    while (p < b.length) { if (varint() !== 26) throw error('벡터 지도 형식이 올바르지 않습니다.'); var len = varint(); if (!len || p + len > b.length) throw error('지도 조각이 손상되었습니다.'); p += len; }
  }
  function canonical(meta, entries) {
    return JSON.stringify({ format: 'stayup-offline-region', version: 1, bbox: meta.bbox, minZoom: 0, maxZoom: meta.maxZoom,
      source: meta.source, tileCount: meta.tileCount, bytes: meta.bytes,
      tiles: entries.map(function (t) { return [t.tile, t.sha256, t.bytes]; }).sort(function (a, b) { return a[0].localeCompare(b[0]); }) });
  }
  async function verify(meta, entries, signal) {
    var bytes = 0;
    for (var i = 0; i < entries.length; i++) {
      checkSignal(signal);
      var expected = entries[i], record = await read('tiles', meta.id + '/' + expected.tile);
      if (!record || record.tile !== expected.tile || record.data.byteLength !== expected.bytes || record.sha256 !== expected.sha256 || await hash(record.data) !== expected.sha256) throw error('저장한 지도를 다시 읽는 검증에 실패했습니다. 이전 저장 지도는 유지됩니다.');
      bytes += record.data.byteLength;
    }
    if (bytes !== meta.bytes || entries.length !== meta.tileCount) throw error('지도 저장 수량이 맞지 않습니다.');
    return hash(canonical(meta, entries));
  }
  function loadScript(path, globalName) {
    if (global[globalName]) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script'), timer;
      function finish(err) { clearTimeout(timer); script.onload = script.onerror = null; if (err) { script.remove(); reject(err); } else resolve(); }
      script.src = new URL(path, baseURL).href;
      script.onload = function () { finish(global[globalName] ? null : error('오프라인 지도 모듈이 올바르지 않습니다.')); };
      script.onerror = function () { finish(error('오프라인 지도 파일을 불러오지 못했습니다. vendor 폴더를 함께 보관하거나 온라인에서 한 번 준비해 주세요.')); };
      timer = setTimeout(function () { finish(error('오프라인 지도 파일 준비 시간이 초과되었습니다.')); }, 20000);
      document.head.appendChild(script);
    });
  }
  function assets() {
    if (!assetPromise) assetPromise = Promise.all([
      loadScript(ASSETS[0], 'maplibregl'), loadScript(ASSETS[2], 'pmtiles'),
      new Promise(function (resolve, reject) {
        var link = document.createElement('link'), timer;
        link.rel = 'stylesheet'; link.href = new URL(ASSETS[1], baseURL).href;
        function finish(err) { clearTimeout(timer); link.onload = link.onerror = null; if (err) { link.remove(); reject(err); } else resolve(); }
        link.onload = function () { finish(); }; link.onerror = function () { finish(error('지도 화면 스타일을 불러오지 못했습니다.')); };
        timer = setTimeout(function () { finish(error('지도 화면 스타일 준비 시간이 초과되었습니다.')); }, 20000);
        document.head.appendChild(link);
      })
    ]).catch(function (e) { assetPromise = null; throw e; });
    return assetPromise;
  }
  async function cleanupStaging() {
    var db = await database(), packs = await request(db.transaction('packs').objectStore('packs').getAll()), cutoff = Date.now() - 86400000;
    for (var i = 0; i < packs.length; i++) if (packs[i].status === 'staging' && Date.parse(packs[i].createdAt) < cutoff) await remove(packs[i].id);
  }
  async function init() { await Promise.all([database(), assets()]); await cleanupStaging(); return { assets: ASSETS.slice(), limits: LIMITS }; }
  async function list() { var db = await database(); return (await request(db.transaction('packs').objectStore('packs').getAll())).filter(function (p) { return p.status === 'ready'; }).sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); }); }
  async function load(id) {
    var pack = await read('packs', String(id));
    if (!pack || pack.status !== 'ready' || !validBbox(pack.bbox)) throw error('검증이 끝난 저장 지도가 없습니다. 온라인에서 지역 지도를 먼저 저장해 주세요.');
    packCache.set(pack.id, pack); return pack;
  }
  async function remove(id) {
    id = String(id); packCache.delete(id);
    var db = await database(), tx = db.transaction(['packs', 'tiles'], 'readwrite'), done = transactionDone(tx);
    tx.objectStore('packs').delete(id);
    tx.objectStore('tiles').delete(IDBKeyRange.bound(id + '/', id + '/\uffff'));
    await done;
  }
  async function purge() {
    active.forEach(function (c) { c.abort(); }); packCache.clear();
    var db = await database(), tx = db.transaction(['packs', 'tiles', 'meta'], 'readwrite'), done = transactionDone(tx);
    var req = tx.objectStore('meta').get('epoch');
    req.onsuccess = function () { tx.objectStore('meta').put((req.result || 0) + 1, 'epoch'); tx.objectStore('packs').clear(); tx.objectStore('tiles').clear(); };
    await done;
  }
  async function operation(options, run) {
    var controller = new AbortController(), relay = function () { controller.abort(); };
    if (options.signal) { options.signal.addEventListener('abort', relay, { once: true }); if (options.signal.aborted) relay(); }
    active.add(controller);
    var id = uuid(), epoch = await read('meta', 'epoch') || 0;
    try {
      checkSignal(controller.signal);
      if ((await list()).length >= LIMITS.maxPacks) throw error('저장 지도는 최대 12개입니다. 사용하지 않는 지도를 삭제해 주세요.');
      return await run(id, epoch, controller.signal);
    } catch (e) {
      await remove(id).catch(function () {});
      if (controller.signal.aborted) throw cancelled();
      if (e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message))) throw error('기기 저장 공간이 부족합니다. 이전 저장 지도는 유지됩니다. 공간을 확보한 뒤 다시 시도해 주세요.');
      throw e;
    } finally { active.delete(controller); if (options.signal) options.signal.removeEventListener('abort', relay); }
  }
  function progress(callback, stage, completed, total, bytes) { if (typeof callback === 'function') callback({ stage: stage, completed: completed, total: total, bytes: bytes || 0 }); }
  async function download(options) {
    options = options || {};
    var plan = estimate(options), tiles = tileList(plan.bbox, plan.maxZoom);
    await init();
    return operation(options, async function (id, epoch, signal) {
      var sourceUrl = options.sourceUrl || SOURCE_URL, url = new URL(sourceUrl, location.href);
      if (url.protocol !== 'https:' && url.origin !== location.origin) throw error('지도 다운로드 주소는 HTTPS여야 합니다.');
      var transferred = 0, sourceEtag = null, lastModified = null;
      var source = {
        getKey: function () { return url.href + '#' + id; },
        getBytes: async function (offset, length) {
          checkSignal(signal);
          if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1 || length > 8 * 1024 * 1024) throw error('지도 원본의 요청 범위가 올바르지 않습니다.');
          var requestController = new AbortController(), abort = function () { requestController.abort(); };
          signal.addEventListener('abort', abort, { once: true });
          var timer = setTimeout(abort, 45000);
          try {
            var response = await fetch(url.href, { headers: { Range: 'bytes=' + offset + '-' + (offset + length - 1) }, signal: requestController.signal, credentials: 'omit', cache: 'no-store' });
            if (response.status !== 206) throw error('지도 원본에서 부분 다운로드를 지원하지 않거나 연결이 중단되었습니다.');
            var etag = response.headers.get('ETag');
            if (!etag || (sourceEtag && etag !== sourceEtag)) throw error('다운로드 중 지도 원본이 변경되었습니다. 다시 저장해 주세요.');
            sourceEtag = etag; lastModified = response.headers.get('Last-Modified');
            var advertised = Number(response.headers.get('Content-Length'));
            if (advertised !== length) throw error('지도 다운로드 길이가 맞지 않습니다.');
            var contentRange = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') || '');
            if (!contentRange || Number(contentRange[1]) !== offset || Number(contentRange[2]) !== offset + length - 1 || Number(contentRange[3]) <= offset + length - 1) throw error('지도 다운로드 범위 응답이 올바르지 않습니다.');
            var data = await response.arrayBuffer();
            transferred += data.byteLength;
            if (data.byteLength !== length || transferred > LIMITS.maxBytes * 3) throw error('지도 다운로드 크기가 허용 범위를 초과했습니다.');
            return { data: data, etag: etag };
          } catch (e) {
            if (signal.aborted) throw cancelled();
            if (requestController.signal.aborted) throw error('지도 다운로드 응답이 지연되었습니다. 연결을 확인한 뒤 다시 저장해 주세요.');
            throw e;
          } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
        }
      };
      progress(options.onProgress, 'source', 0, tiles.length, 0);
      var archive = new global.pmtiles.PMTiles(source), header = await archive.getHeader(), metadata = await archive.getMetadata();
      if (header.tileType !== 1 || header.minZoom > 0 || header.maxZoom < plan.maxZoom) throw error('선택한 상세 수준을 지원하는 벡터 지도가 아닙니다.');
      var sourceDate = metadata['planetiler:osm:osmosisreplicationtime'] || metadata['osm:timestamp'] || null;
      var pack = { id: id, name: String(options.name || '저장 지역 지도').slice(0, 80), status: 'staging', bbox: plan.bbox,
        minZoom: 0, maxZoom: plan.maxZoom, tileCount: tiles.length, bytes: 0, createdAt: new Date().toISOString(),
        source: { url: url.href, date: sourceDate || lastModified || null, dateKind: sourceDate ? 'osm' : 'archive', etag: sourceEtag,
          attribution: '© OpenStreetMap contributors · Protomaps', license: 'ODbL-1.0', licenseUrl: 'https://www.openstreetmap.org/copyright' } };
      await guardedWrite(epoch, ['packs'], function (tx) { tx.objectStore('packs').put(pack); });
      var entries = [];
      // Sequential tile reads limit public mirror load and peak memory. PMTiles caches directories.
      for (var i = 0; i < tiles.length; i++) {
        checkSignal(signal);
        var tile = tiles[i], answer = await archive.getZxy(tile.z, tile.x, tile.y, signal), data = answer ? answer.data : new ArrayBuffer(0);
        validateTile(data); pack.bytes += data.byteLength;
        if (pack.bytes > LIMITS.maxBytes) throw error('저장 지도가 100 MB를 초과했습니다. 범위나 상세 수준을 줄여 주세요.');
        var entry = { tile: tile.tile, bytes: data.byteLength, sha256: await hash(data) };
        entries.push(entry);
        await guardedWrite(epoch, ['tiles'], function (tx) { tx.objectStore('tiles').put({ key: id + '/' + entry.tile, packId: id, tile: entry.tile, sha256: entry.sha256, data: data }); });
        progress(options.onProgress, 'download', i + 1, tiles.length, pack.bytes);
      }
      progress(options.onProgress, 'verify', 0, tiles.length, pack.bytes);
      pack.sha256 = await verify(pack, entries, signal);
      pack.status = 'ready'; pack.verifiedAt = new Date().toISOString();
      checkSignal(signal);
      await guardedWrite(epoch, ['packs'], function (tx) { tx.objectStore('packs').put(pack); });
      packCache.set(id, pack);
      progress(options.onProgress, 'ready', tiles.length, tiles.length, pack.bytes);
      return pack;
    });
  }
  function bytesToBase64(data) { var b = new Uint8Array(data), pieces = []; for (var i = 0; i < b.length; i += 16384) pieces.push(String.fromCharCode.apply(null, b.subarray(i, i + 16384))); return btoa(pieces.join('')); }
  function base64ToBytes(value) {
    if (typeof value !== 'string' || value.length > Math.ceil(LIMITS.maxTileBytes / 3) * 4 || value.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw error('지도 파일의 데이터 형식이 올바르지 않습니다.');
    var s = atob(value), result = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) result[i] = s.charCodeAt(i); return result.buffer;
  }
  async function exportPack(id) {
    var pack = await load(id), expected = tileList(pack.bbox, pack.maxZoom), entries = [], payload = [];
    for (var i = 0; i < expected.length; i++) {
      var t = await read('tiles', pack.id + '/' + expected[i].tile);
      if (!t || await hash(t.data) !== t.sha256) throw error('저장 지도에 누락 또는 손상이 있습니다. 다시 저장해 주세요.');
      entries.push({ tile: t.tile, bytes: t.data.byteLength, sha256: t.sha256 });
      payload.push({ tile: t.tile, sha256: t.sha256, data: bytesToBase64(t.data) });
    }
    if (await hash(canonical(pack, entries)) !== pack.sha256) throw error('저장 지도 검증 정보가 맞지 않습니다.');
    return new Blob([JSON.stringify({ format: 'stayup-offline-region', version: 1, manifest: pack, tiles: payload })], { type: 'application/json' });
  }
  async function publishImported(pack, targetId, epoch) {
    var stagingId = pack.id, db = await database(), tx = db.transaction(['meta', 'packs', 'tiles'], 'readwrite'), done = transactionDone(tx);
    var guard = tx.objectStore('meta').get('epoch');
    guard.onsuccess = function () {
      if ((guard.result || 0) !== epoch) { tx.abort(); return; }
      var existing = tx.objectStore('packs').get(targetId);
      existing.onsuccess = function () {
        if (existing.result && existing.result.sha256 !== pack.sha256) { tx.abort(); return; }
        var cursor = tx.objectStore('tiles').openCursor(IDBKeyRange.bound(stagingId + '/', stagingId + '/\uffff'));
        cursor.onsuccess = function () {
          var row = cursor.result;
          if (row) { var tile = row.value; tile.key = targetId + '/' + tile.tile; tile.packId = targetId; tx.objectStore('tiles').put(tile); row.delete(); row.continue(); }
          else { pack.id = targetId; tx.objectStore('packs').put(pack); tx.objectStore('packs').delete(stagingId); }
        };
      };
    };
    await done;
  }
  async function importPack(file, options) {
    options = options || {};
    if (!file || typeof file.text !== 'function' || file.size > LIMITS.maxFileBytes) throw error('지도 파일은 145 MB 이하만 가져올 수 있습니다.');
    var input; try { input = JSON.parse(await file.text()); } catch (_) { throw error('지도 파일을 읽을 수 없습니다.'); }
    var m = input && input.manifest;
    if (input.format !== 'stayup-offline-region' || input.version !== 1 || !m || !/^region-[a-zA-Z0-9-]{8,100}$/.test(m.id || '') || !validBbox(m.bbox) || m.minZoom !== 0 || !Number.isInteger(m.maxZoom) || !/^[a-f0-9]{64}$/.test(m.sha256 || '') || !m.source || m.source.license !== 'ODbL-1.0' || typeof m.source.url !== 'string' || m.source.url.length > 2048 || typeof m.source.attribution !== 'string' || m.source.attribution.length > 256 || !Array.isArray(input.tiles)) throw error('지원하는 STAY UP 지역 지도 파일이 아닙니다.');
    var allowedSource = ['url', 'date', 'dateKind', 'etag', 'attribution', 'license', 'licenseUrl'];
    if (Object.keys(m.source).some(function (key) { return allowedSource.indexOf(key) < 0; })
      || (m.source.date !== null && (typeof m.source.date !== 'string' || m.source.date.length > 80 || !Number.isFinite(Date.parse(m.source.date))))
      || ['osm', 'archive'].indexOf(m.source.dateKind) < 0 || typeof m.source.etag !== 'string' || m.source.etag.length > 256
      || m.source.licenseUrl !== 'https://www.openstreetmap.org/copyright') throw error('지도 파일의 출처 정보가 올바르지 않습니다.');
    var sourceURL; try { sourceURL = new URL(m.source.url); } catch (_) { throw error('지도 파일의 출처 주소가 올바르지 않습니다.'); }
    if (sourceURL.protocol !== 'https:' && sourceURL.origin !== location.origin) throw error('지도 파일의 출처는 HTTPS 주소여야 합니다.');
    var expected = tileList(m.bbox, m.maxZoom), expectedKeys = new Set(expected.map(function (t) { return t.tile; }));
    if (input.tiles.length !== expected.length || m.tileCount !== expected.length || !Number.isSafeInteger(m.bytes) || m.bytes < 0 || m.bytes > LIMITS.maxBytes) throw error('지도 파일의 범위 또는 수량이 맞지 않습니다.');
    return operation(options, async function (id, epoch, signal) {
      var pack = { id: id, name: String(m.name || '가져온 지역 지도').slice(0, 80), bbox: m.bbox.slice(), minZoom: 0, maxZoom: m.maxZoom,
        tileCount: m.tileCount, bytes: m.bytes, source: m.source, status: 'staging', createdAt: new Date().toISOString() };
      await guardedWrite(epoch, ['packs'], function (tx) { tx.objectStore('packs').put(pack); });
      var entries = [], totalBytes = 0;
      for (var i = 0; i < input.tiles.length; i++) {
        checkSignal(signal); var t = input.tiles[i];
        if (!t || !expectedKeys.delete(t.tile) || !/^[a-f0-9]{64}$/.test(t.sha256 || '')) throw error('지도 파일에 중복되거나 잘못된 지도 조각이 있습니다.');
        var data = base64ToBytes(t.data); validateTile(data); totalBytes += data.byteLength;
        if (totalBytes > LIMITS.maxBytes || await hash(data) !== t.sha256) throw error('지도 파일이 손상되었거나 너무 큽니다.');
        entries.push({ tile: t.tile, bytes: data.byteLength, sha256: t.sha256 });
        await guardedWrite(epoch, ['tiles'], function (tx) { tx.objectStore('tiles').put({ key: id + '/' + t.tile, packId: id, tile: t.tile, sha256: t.sha256, data: data }); });
        progress(options.onProgress, 'import', i + 1, expected.length, totalBytes);
      }
      if (totalBytes !== m.bytes || await hash(canonical(pack, entries)) !== m.sha256) throw error('지도 파일 검증값이 일치하지 않습니다.');
      pack.sha256 = await verify(pack, entries, signal);
      pack.status = 'ready'; pack.verifiedAt = new Date().toISOString();
      checkSignal(signal);
      await publishImported(pack, m.id, epoch);
      packCache.set(pack.id, pack); return pack;
    });
  }
  function styleFor(pack) {
    var source = 'region', label = ['coalesce', ['get', 'name:ko'], ['get', 'name'], ['get', 'name:en']];
    function layer(id, type, sourceLayer, paint, layout, filter, minzoom) {
      var result = { id: id, type: type, source: source, 'source-layer': sourceLayer, paint: paint };
      if (layout) result.layout = layout; if (filter) result.filter = filter; if (minzoom != null) result.minzoom = minzoom; return result;
    }
    var layers = [
      { id: 'background', type: 'background', paint: { 'background-color': '#f1eee5' } },
      layer('landcover', 'fill', 'landcover', { 'fill-color': ['match', ['get', 'kind'], ['forest', 'scrub'], '#d4e4c9', ['grassland', 'farmland'], '#e2e8cf', '#e9e6db'] }),
      layer('landuse', 'fill', 'landuse', { 'fill-color': ['match', ['get', 'kind'], ['forest', 'wood', 'park', 'nature_reserve'], '#d1e3c6', ['grass', 'farmland', 'meadow', 'orchard'], '#e0e8ce', ['hospital', 'school', 'university'], '#e8dfd0', '#e9e6de'], 'fill-opacity': 0.8 }),
      layer('water-fill', 'fill', 'water', { 'fill-color': '#a4ccdf' }, null, ['==', ['geometry-type'], 'Polygon']),
      layer('water-line', 'line', 'water', { 'line-color': '#8dbbd4', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 16, 2.5] }, null, ['==', ['geometry-type'], 'LineString']),
      layer('boundaries', 'line', 'boundaries', { 'line-color': '#a9a5a1', 'line-width': 1, 'line-dasharray': [3, 2], 'line-opacity': 0.7 }),
      layer('buildings', 'fill', 'buildings', { 'fill-color': '#c9c2b5', 'fill-outline-color': '#aaa294', 'fill-opacity': 0.8 }, null, ['==', ['geometry-type'], 'Polygon'], 12),
      layer('road-casing', 'line', 'roads', { 'line-color': '#c2b9a8', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1, 12, 3, 16, 8] }, { 'line-cap': 'round', 'line-join': 'round' }, ['in', ['get', 'kind'], ['literal', ['highway', 'major_road', 'minor_road']]]),
      layer('roads', 'line', 'roads', { 'line-color': ['match', ['get', 'kind'], 'highway', '#f3ca7b', 'major_road', '#fff0c4', '#ffffff'], 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.6, 12, 2, 16, 6] }, { 'line-cap': 'round', 'line-join': 'round' }, ['in', ['get', 'kind'], ['literal', ['highway', 'major_road', 'minor_road']]]),
      layer('paths', 'line', 'roads', { 'line-color': '#9d9077', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 1.8], 'line-dasharray': [2, 2] }, null, ['==', ['get', 'kind'], 'path'], 11),
      layer('rail', 'line', 'roads', { 'line-color': '#7b7d7f', 'line-width': 1.5, 'line-dasharray': [3, 2] }, null, ['==', ['get', 'kind'], 'rail'], 10),
      layer('road-labels', 'symbol', 'roads', { 'text-color': '#665e4f', 'text-halo-color': '#fffdf7', 'text-halo-width': 1.5 }, { 'symbol-placement': 'line', 'text-field': label, 'text-font': ['sans-serif'], 'text-size': 12, 'text-max-angle': 30 }, ['in', ['get', 'kind'], ['literal', ['highway', 'major_road', 'minor_road']]], 13),
      layer('place-labels', 'symbol', 'places', { 'text-color': '#2f3942', 'text-halo-color': '#ffffff', 'text-halo-width': 1.7 }, { 'text-field': label, 'text-font': ['sans-serif'], 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 12, 14, 16, 17], 'text-max-width': 8 }, ['<=', ['coalesce', ['get', 'min_zoom'], 0], ['zoom']]),
      layer('poi-labels', 'symbol', 'pois', { 'text-color': '#4e5e61', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 }, { 'text-field': label, 'text-font': ['sans-serif'], 'text-size': 11, 'text-max-width': 7 }, ['in', ['get', 'kind'], ['literal', ['hospital', 'fire_station', 'police', 'school', 'shelter', 'peak']]], 14)
    ];
    var b = pack.bbox, ring = [[b[0], b[1]], [b[0], b[3]], [b[2], b[3]], [b[2], b[1]], [b[0], b[1]]];
    layers.push({ id: 'outside-saved-region', type: 'fill', source: 'saved-boundary', paint: { 'fill-color': '#d5d9dc', 'fill-opacity': 0.94 } });
    layers.push({ id: 'saved-region-border', type: 'line', source: 'saved-boundary', paint: { 'line-color': '#5c737f', 'line-width': 2, 'line-dasharray': [3, 2] } });
    return { version: 8, sources: {
      region: { type: 'vector', tiles: ['stayupoffline://' + pack.id + '/{z}/{x}/{y}'], minzoom: 0, maxzoom: pack.maxZoom, bounds: pack.bbox,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · <a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a>' },
      'saved-boundary': { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [
        [[-180, -85.051], [180, -85.051], [180, 85.051], [-180, 85.051], [-180, -85.051]], ring
      ] } } }
    }, layers: layers };
  }
  function installProtocol() {
    if (protocolInstalled) return;
    global.maplibregl.addProtocol('stayupoffline', async function (params, controller) {
      checkSignal(controller && controller.signal);
      var match = /^stayupoffline:\/\/([a-zA-Z0-9-]+)\/(\d+)\/(\d+)\/(\d+)$/.exec(params.url);
      if (!match) throw error('저장 지도 주소가 올바르지 않습니다.');
      var id = match[1], pack = packCache.get(id) || await load(id), z = Number(match[2]), x = Number(match[3]), y = Number(match[4]);
      if (z > pack.maxZoom || x < lonTile(pack.bbox[0], z) || x > lonTile(pack.bbox[2], z) || y < latTile(pack.bbox[3], z) || y > latTile(pack.bbox[1], z)) return { data: new ArrayBuffer(0) };
      var tile = await read('tiles', id + '/' + z + '/' + x + '/' + y);
      checkSignal(controller && controller.signal);
      if (!tile) throw error('저장 지도 조각이 없습니다. 편집을 멈추고 지도를 다시 저장해 주세요.');
      return { data: tile.data };
    });
    protocolInstalled = true;
  }
  async function createMap(element, options, onDraw, onError) {
    options = options || {};
    await init(); var pack = await load(options.packId); installProtocol();
    var geo = options.bounds || options.geo || { west: pack.bbox[0], south: pack.bbox[1], east: pack.bbox[2], north: pack.bbox[3] };
    if (!element || !validBbox(bboxFrom(geo)) || !isCovering(pack, geo)) throw error('저장 지도 범위가 현재 수색구역을 포함하지 않습니다.');
    return new Promise(function (resolve, reject) {
      var map, disposed = false, ready = false, frame = 0, observer, timer;
      var center = options.center && Number.isFinite(options.center.lat) && Number.isFinite(options.center.lon) ? [options.center.lon, options.center.lat] : [(geo.west + geo.east) / 2, (geo.south + geo.north) / 2];
      function queueDraw() { if (disposed || frame) return; frame = requestAnimationFrame(function () { frame = 0; if (!disposed && ready && typeof onDraw === 'function') onDraw(); }); }
      function destroy() { if (disposed) return; disposed = true; clearTimeout(timer); cancelAnimationFrame(frame); if (observer) observer.disconnect(); if (map) map.remove(); element.replaceChildren(); }
      function fail(err) { if (disposed) return; var message = err && err.message || '저장 지도를 표시하지 못했습니다.'; var wasReady = ready; destroy(); if (!wasReady) reject(error(message)); if (typeof onError === 'function') onError(message); }
      var adapter = {
        project: function (p) { if (disposed || !p) return null; var v = map.project([p.lon, p.lat]); return { x: v.x, y: v.y }; },
        unproject: function (p) { if (disposed || !p) return null; var v = map.unproject([p.x, p.y]); return { lat: v.lat, lon: v.lng }; },
        // Expose the same 256-pixel zoom convention as Naver/Google. MapLibre's
        // native world is 512 * 2^zoom, so its camera zoom is one level lower.
        getZoom: function () { return disposed ? null : map.getZoom() + 1; },
        setZoom: function (z) { if (!disposed && Number.isFinite(z)) map.jumpTo({ zoom: Math.max(0, Math.min(20, z - 1)) }); },
        getCenter: function () { if (disposed) return null; var c = map.getCenter(); return { lat: c.lat, lon: c.lng }; },
        setCenter: function (p) { if (!disposed && p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) map.jumpTo({ center: [Math.max(pack.bbox[0], Math.min(pack.bbox[2], p.lon)), Math.max(pack.bbox[1], Math.min(pack.bbox[3], p.lat))] }); },
        panBy: function (x, y) { if (!disposed && Number.isFinite(x) && Number.isFinite(y)) { var p = map.unproject([element.clientWidth / 2 + x, element.clientHeight / 2 + y]); adapter.setCenter({ lat: p.lat, lon: p.lng }); } },
        fitBounds: function (b) {
          if (disposed || !validBbox(bboxFrom(b))) return Promise.reject(error('범위 맞춤을 실행할 수 없습니다.'));
          map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: { top: 24, right: 24, bottom: 48, left: 24 }, duration: 0, maxZoom: 20 });
          return new Promise(function (done, rejectFit) { requestAnimationFrame(function () { if (disposed) rejectFit(error('지도 연결이 해제되었습니다.')); else { queueDraw(); done(); } }); });
        },
        resize: function () { if (!disposed) { map.resize(); queueDraw(); } }, destroy: destroy,
        packId: pack.id, minZoom: 1, maxZoom: 21, detailZoom: pack.maxZoom
      };
      try {
        map = new global.maplibregl.Map({ container: element, style: styleFor(pack), center: center, zoom: Number.isFinite(options.zoom) ? Math.max(0, Math.min(20, options.zoom - 1)) : 12,
          minZoom: 0, maxZoom: 20, bearing: 0, pitch: 0,
          interactive: false, attributionControl: false, renderWorldCopies: false, fadeDuration: 0,
          localIdeographFontFamily: 'sans-serif', refreshExpiredTiles: false });
        map.addControl(new global.maplibregl.AttributionControl({ compact: false }), 'bottom-right');
        map.on('error', function (event) { fail(event.error); });
        map.on('move', queueDraw); map.on('resize', queueDraw); map.on('render', queueDraw);
        map.on('load', function () { if (disposed) return; ready = true; clearTimeout(timer); resolve(adapter); queueDraw(); });
        if (!Number.isFinite(options.zoom)) map.fitBounds([[geo.west, geo.south], [geo.east, geo.north]], { padding: { top: 24, right: 24, bottom: 48, left: 24 }, duration: 0 });
        if (global.ResizeObserver) { observer = new ResizeObserver(function () { adapter.resize(); }); observer.observe(element); }
        timer = setTimeout(function checkReady() {
          if (disposed || ready) return;
          // Hidden windows may suspend animation frames; do not mislabel that as damaged map data.
          if (document.hidden) { timer = setTimeout(checkReady, 20000); return; }
          fail(error('저장 지도 표시 시간이 초과되었습니다. WebGL 지원과 저장 지도를 확인해 주세요.'));
        }, 20000);
      } catch (e) { fail(e); }
    });
  }
  global.STAYUP_OFFLINE = Object.freeze({ init: init, estimate: estimate, download: download, list: list, load: load, remove: remove, purge: purge,
    exportPack: exportPack, importPack: importPack, createMap: createMap, isCovering: isCovering, limits: LIMITS, assets: ASSETS.slice(), sourceUrl: SOURCE_URL });
})(window);
