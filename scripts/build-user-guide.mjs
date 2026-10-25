import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// Documentation-only tooling. The app does not load these document-generation packages.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = process.argv.slice(2);
const option = name => options.includes(name) ? options[options.indexOf(name) + 1] : undefined;
const moduleDirectory = option('--modules');
const requireDependency = createRequire(moduleDirectory
  ? path.join(path.resolve(moduleDirectory), 'package.json')
  : import.meta.url);
let marked;
try {
  ({ marked } = await import(pathToFileURL(requireDependency.resolve('marked')).href));
} catch {
  throw new Error('Guide generation requires marked and playwright. Use --modules /path/to/node_modules with these documentation tools installed.');
}
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const source = await readFile(path.join(root, 'USER_GUIDE.md'), 'utf8');
const parts = source.split(/^## /m);
const intro = parts.shift().replace(/^# .*\n/m, '');
const chapters = parts.map((part, index) => {
  const lineEnd = part.indexOf('\n');
  return { title: part.slice(0, lineEnd).trim(), markdown: part.slice(lineEnd + 1), id: `chapter-${index + 1}` };
});

async function renderMarkdown(markdown) {
  let html = marked.parse(markdown);
  for (const match of [...html.matchAll(/src="(\.\/assets\/readme\/[^"]+\.png)"/g)]) {
    const imagePath = path.resolve(root, match[1]);
    if (!imagePath.startsWith(path.join(root, 'assets', 'readme') + path.sep)) throw new Error('Image path escaped documentation assets.');
    const encoded = (await readFile(imagePath)).toString('base64');
    html = html.replaceAll(`src="${match[1]}"`, `src="data:image/png;base64,${encoded}"`);
  }
  html = html.replace(/<p>(<img\b[^>]+>)<\/p>\s*<p><em>([\s\S]*?)<\/em><\/p>/g,
    '<figure class="guide-figure">$1<figcaption>$2</figcaption></figure>');
  html = html.replace(/<table>[\s\S]*?<\/table>/g, table =>
    (table.match(/<tr>/g) || []).length <= 10 ? table.replace('<table>', '<table class="compact-table">') : table);
  return html.replaceAll('href="./README.md', 'href="https://github.com/MuyeongKim/stayup-dash/blob/main/README.md');
}

const toc = chapters.map(chapter => `<a href="#${chapter.id}">${escape(chapter.title)}</a>`).join('\n');
const chapterHtml = await Promise.all(chapters.map(async chapter =>
  `<section class="sheet chapter" id="${chapter.id}"><p class="eyebrow">STAY UP · 사용 안내</p><h2>${escape(chapter.title)}</h2>${await renderMarkdown(chapter.markdown)}</section>`));
const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>STAY UP 사용설명서</title><meta name="description" content="STAY UP 사용설명서. 첫 사용 준비 안내·주간 및 야간 화면·분리된 연습 공간, 지역 지도·사진 후보 연계와 상황 백업 안내.">
<style>
:root{color-scheme:light;--ink:#152534;--muted:#506576;--line:#d5dfe6;--orange:#c44909}
*{box-sizing:border-box}html{scroll-padding-top:85px}body{margin:0;background:#eef2f5;color:var(--ink);font:16px/1.75 'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;word-break:keep-all;overflow-wrap:anywhere}
a{color:#075987;text-underline-offset:3px}a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid #d7530d;outline-offset:4px}
.toolbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;background:#101a23;color:white;padding:12px max(20px,calc((100vw - 1160px)/2));line-height:1.3;flex-wrap:wrap}.toolbar b{margin-right:auto}.toolbar a,.toolbar button{font-family:inherit;font-size:14px;font-weight:700;line-height:1.3;color:white;border:1px solid #6e8495;border-radius:6px;padding:9px 13px;background:transparent;text-decoration:none;cursor:pointer}
.layout{max-width:1160px;margin:28px auto 70px;display:grid;grid-template-columns:220px minmax(0,1fr);gap:24px;padding:0 20px}.toc{position:sticky;top:90px;align-self:start;padding:18px 14px;border:1px solid var(--line);border-radius:12px;background:white}.toc>p{margin:0 8px 10px;font-weight:800}.toc a{display:block;padding:9px 8px;font-size:14px;text-decoration:none;line-height:1.55}.toc a:hover{background:#edf4f8}.meta{color:var(--muted);font-size:13px}.toc .meta{margin-top:15px;font-weight:400}
main{min-width:0}.sheet{background:white;border:1px solid var(--line);border-radius:14px;padding:34px;margin-bottom:24px;box-shadow:0 5px 22px #172b4010}.eyebrow{color:var(--orange);font-size:12px;letter-spacing:.12em;font-weight:800;margin:0 0 8px}h1{font-size:36px;line-height:1.3;margin:0 0 24px}h2{font-size:27px;line-height:1.4;margin:0 0 23px;padding-bottom:14px;border-bottom:3px solid var(--ink)}h3{font-size:19px;margin:25px 0 10px}p{margin:13px 0}ol,ul{padding-left:1.4em}li{padding-left:4px;margin:8px 0}li::marker{color:var(--orange);font-weight:800}code{font-family:inherit;font-size:.94em;font-weight:700;background:#edf2f6;border:1px solid #d7e0e7;border-radius:4px;padding:1px 5px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
blockquote{margin:18px 0;padding:12px 16px;border-left:4px solid #de681f;background:#fff5e9;font-size:14px;color:#69401c}blockquote p{margin:0}table{width:100%;border-collapse:collapse;margin:18px 0;font-size:14px;line-height:1.6}th{background:#edf2f6;text-align:left}td,th{padding:10px 12px;border:1px solid var(--line);vertical-align:top}td:first-child,th:first-child{width:28%;font-weight:700}
.guide-figure{margin:20px 0}.guide-figure img{display:block;width:100%;height:auto;border-radius:6px}.guide-figure figcaption{margin-top:9px;font-size:13px;line-height:1.65;color:var(--muted)}.page-toc{display:grid;gap:7px;margin-top:28px;padding-top:20px;border-top:1px solid var(--line)}.page-toc a{font-size:14px}.mobile-toc{display:none}.screen-footer{font-size:12px;color:var(--muted)}
@media(max-width:760px){.layout{display:block;margin-top:14px;padding:0 12px}.toc{display:none}.mobile-toc{display:block;background:white;border:1px solid var(--line);padding:14px 18px;border-radius:10px;margin-bottom:14px}.mobile-toc summary{font-weight:800;cursor:pointer}.mobile-toc a{display:block;padding:9px 0;font-size:14px}.sheet{padding:24px 20px;border-radius:10px}h1{font-size:29px}h2{font-size:23px}body{font-size:15px}.toolbar{position:relative;padding:12px 16px;gap:8px}.toolbar a,.toolbar button{font-size:12px;padding:8px 10px}td,th{padding:8px}table{font-size:13px}html{scroll-padding-top:12px}}
@page{size:A4;margin:15mm 16mm 18mm}
@media print{.compact-table{break-inside:avoid}}
@media print{body{background:white;font-size:11pt;line-height:1.62;color:#142331;-webkit-print-color-adjust:exact;print-color-adjust:exact}.toolbar,.toc,.mobile-toc,.screen-footer{display:none!important}.layout{display:block;max-width:none;margin:0;padding:0}.sheet{padding:0;margin:0;border:0;border-radius:0;box-shadow:none;break-before:page}.cover{break-before:auto}.eyebrow{font-size:9pt}h1{font-size:31pt;margin-bottom:20pt}h2{font-size:21pt;line-height:1.3;margin:0 0 16pt;padding-bottom:10pt}h3{font-size:13pt;margin-top:18pt}p{margin:9pt 0}ol,ul{margin:10pt 0;padding-left:1.6em}li{margin:6pt 0;break-inside:avoid}table{font-size:9.2pt;line-height:1.5;margin:12pt 0}td,th{padding:5pt 7pt}tr{break-inside:avoid}thead{display:table-header-group}blockquote{font-size:10pt;padding:9pt 12pt;margin:13pt 0}.guide-figure{margin:13pt 0;break-inside:avoid}.guide-figure img{max-height:104mm;object-fit:contain;object-position:left center}.guide-figure figcaption{font-size:9pt;line-height:1.5;margin-top:6pt}.page-toc{gap:7pt;margin-top:24pt;padding-top:16pt}.page-toc a{font-size:11pt;text-decoration:none}.meta{font-size:9pt}h2,h3{break-after:avoid}.chapter p{orphans:3;widows:3}a{color:#075987}}
</style></head><body>
<header class="toolbar"><b>STAY UP · 사용설명서</b><a href="STAY-UP-사용설명서.pdf" download>PDF 다운로드</a><button type="button" id="printGuide">인쇄하기</button><a href="../stayup-dash.html">상황판 열기</a></header>
<div class="layout"><aside class="toc" aria-label="사용설명서 목차"><p>필요한 순서로 보기</p>${toc}<p class="meta">2026.10.26 개정<br>첫 사용·주야간·연습 공간 안내</p></aside>
<main><details class="mobile-toc"><summary>목차 열기</summary>${toc}</details>
<section class="sheet cover"><p class="eyebrow">START HERE · USER GUIDE</p><h1>처음부터 따라하는<br>STAY UP 사용설명서</h1>${await renderMarkdown(intro)}<nav class="page-toc" aria-label="인쇄용 목차">${toc}</nav></section>
${chapterHtml.join('\n')}
<footer class="screen-footer">내용 원본: USER_GUIDE.md · 본문과 지도 사진은 HTML 안에 포함되어 인터넷 없이 읽을 수 있습니다. 프로그램 내려받기·상세 README·지도 출처의 외부 링크는 인터넷 연결이 필요합니다.</footer></main></div>
<script>document.getElementById('printGuide').addEventListener('click',()=>window.print());</script>
</body></html>`;
await mkdir(path.join(root, 'docs'), { recursive: true });
const htmlPath = path.join(root, 'docs/user-guide.html');
await writeFile(htmlPath, html);
if (!options.includes('--html-only')) {
  const { chromium } = requireDependency('playwright');
  const executablePath = option('--browser');
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
    await page.pdf({
      path: path.join(root, 'docs/STAY-UP-사용설명서.pdf'), preferCSSPageSize: true, printBackground: true,
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;padding:0 16mm;font-family:sans-serif;font-size:8px;color:#637487;display:flex;justify-content:space-between"><span>STAY UP 사용설명서 · 2026.10.26</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
      tagged: true, outline: true,
    });
  } finally {
    await browser.close();
  }
}
console.log(JSON.stringify({ chapters: chapters.length, embeddedImages: (html.match(/src="data:image\/png;base64,/g) || []).length, htmlBytes: Buffer.byteLength(html) }));
