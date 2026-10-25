/* Copyright 2026 MuyeongKim · Apache-2.0.
 * Only the application's own fixed assets are stored here. Map data lives in
 * the offline map database. Never cache online SDKs, tiles, or arbitrary URLs.
 * Regenerate the manifest block with node scripts/build-offline-shell.mjs.
 */
'use strict';

/* OFFLINE_SHELL_MANIFEST_BEGIN */
const SHELL_MANIFEST = {"schema":1,"build":"263ce155850936046f1fb596","assets":[{"path":"stayup-dash.html","sha256":"1cc3fe9841765e7d6c995378f76a06bcc40571da7380973a3fd662f722891b5b"},{"path":"offline-map-engine.js","sha256":"e29eab79bbc106feb4b968f088b4c8e0251b4f9f59f75d3caeb816af87def1b8"},{"path":"vendor/maplibre-gl-5.24.0.js","sha256":"45a9b07a9189ce56054c620a947ccf41e291e58c95e9b61533b740aaa65ee5cb"},{"path":"vendor/maplibre-gl-5.24.0.css","sha256":"ab1e70d59ec40465bae7e7030da2f3ccf28133fd502e62bd598eefbadfd7a732"},{"path":"vendor/pmtiles-4.5.0.js","sha256":"caf981bc46f6327ee7e65d5dc964d89d38a69f60edca2bd4c5c890c21b554c6c"}]};
/* OFFLINE_SHELL_MANIFEST_END */

const SHELL_PREFIX = 'stayup-shell-' + SHELL_MANIFEST.build + '-';
const SHELL_BASE = new URL('./', self.registration.scope);
const SHELL_APP = new URL('stayup-dash.html', SHELL_BASE).href;
const SHELL_MANIFEST_URL = new URL('offline-shell.json', SHELL_BASE).href;
const SHELL_MARKER = new URL('__stayup_offline_ready__', SHELL_BASE).href;
const SHELL_URLS = new Set(SHELL_MANIFEST.assets.map(asset => new URL(asset.path, SHELL_BASE).href));
SHELL_URLS.add(SHELL_MANIFEST_URL);
let preparing = null;

/* Registration does not download anything. A running mission keeps its worker
 * until all its windows close; no skipWaiting() or clients.claim() takeover. */
self.addEventListener('install', () => {});
self.addEventListener('activate', () => {});

async function readyCache() {
  const names = (await caches.keys()).filter(name => name.startsWith(SHELL_PREFIX)).reverse();
  for (const name of names) {
    const cache = await caches.open(name);
    const marker = await cache.match(SHELL_MARKER);
    if (!marker) continue;
    let metadata;
    try { metadata = await marker.json(); } catch (_) { continue; }
    if (metadata.build !== SHELL_MANIFEST.build) continue;
    // Storage eviction or a partial removal must never be called ready.
    const entries = await Promise.all([...SHELL_URLS].map(url => cache.match(url)));
    if (entries.every(Boolean)) return cache;
  }
  return null;
}

async function sha256(response) {
  const hash = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function fetchOwnAsset(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: controller.signal
    });
    if (!response.ok || response.type === 'opaque') throw new Error('파일을 받지 못했습니다: ' + new URL(url).pathname);
    return response;
  } finally { clearTimeout(timer); }
}

async function prepareShell() {
  if (!SHELL_MANIFEST.assets.length || SHELL_MANIFEST.build === 'unbuilt') throw new Error('오프라인 앱 목록이 만들어지지 않았습니다.');
  if (await readyCache()) return {ready: true, build: SHELL_MANIFEST.build};
  const name = SHELL_PREFIX + Date.now() + '-' + crypto.randomUUID();
  const cache = await caches.open(name);
  try {
    // Hash checking detects interrupted, mixed-version and HTML-fallback deploys.
    for (const asset of SHELL_MANIFEST.assets) {
      const url = new URL(asset.path, SHELL_BASE).href;
      if (!SHELL_URLS.has(url) || new URL(url).origin !== SHELL_BASE.origin) throw new Error('허용되지 않은 앱 파일입니다.');
      const response = await fetchOwnAsset(url);
      if (await sha256(response.clone()) !== asset.sha256) throw new Error('앱 파일 버전이 바뀌었습니다. 새로고침 후 다시 준비하세요: ' + asset.path);
      await cache.put(url, response);
    }
    const manifest = await fetchOwnAsset(SHELL_MANIFEST_URL);
    if (JSON.stringify(await manifest.clone().json()) !== JSON.stringify(SHELL_MANIFEST)) throw new Error('앱 목록 버전이 바뀌었습니다. 새로고침 후 다시 준비하세요.');
    await cache.put(SHELL_MANIFEST_URL, manifest);
    // A single last write commits this generation. Incomplete caches are never read.
    await cache.put(SHELL_MARKER, new Response(JSON.stringify({build: SHELL_MANIFEST.build}), {headers: {'Content-Type': 'application/json'}}));
    return {ready: true, build: SHELL_MANIFEST.build};
  } catch (error) {
    await caches.delete(name);
    throw error;
  }
}

self.addEventListener('message', event => {
  const data = event.data || {}, port = event.ports && event.ports[0];
  if (!port || !event.source || !event.source.url) return;
  const source = new URL(event.source.url); source.search = ''; source.hash = '';
  if (source.href !== SHELL_APP) return;
  if (data.type !== 'SHELL_STATUS' && data.type !== 'PREPARE_SHELL') return;
  event.waitUntil((async () => {
    try {
      if (data.type === 'SHELL_STATUS') {
        port.postMessage({ready: !!(await readyCache()), build: SHELL_MANIFEST.build});
      } else {
        if (data.expectedBuild !== SHELL_MANIFEST.build) throw new Error('새 앱 버전의 오프라인 준비가 필요합니다.');
        if (!preparing) preparing = prepareShell().finally(() => { preparing = null; });
        port.postMessage(await preparing);
      }
    } catch (error) { port.postMessage({ready: false, build: SHELL_MANIFEST.build, error: error.message || String(error)}); }
    finally { port.close(); }
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== SHELL_BASE.origin) return;
  url.search = ''; url.hash = '';
  if (!SHELL_URLS.has(url.href)) return;
  // Network-first keeps ordinary online use current. No fetched response is
  // added to the cache here: all persistent writes require explicit preparation.
  event.respondWith((async () => {
    const cache = await readyCache(), cached = cache && await cache.match(url.href);
    const controller = new AbortController();
    // A disconnected Wi-Fi gateway can leave fetch pending instead of rejecting.
    // A verified local copy is still usable in that case.
    const timer = cached ? setTimeout(() => controller.abort(), 5000) : null;
    try {
      const response = await fetch(request, {signal: controller.signal});
      if (response.ok) return response;
      return cached || response;
    } catch (error) {
      if (cached) return cached;
      throw error;
    } finally { if (timer) clearTimeout(timer); }
  })());
});
