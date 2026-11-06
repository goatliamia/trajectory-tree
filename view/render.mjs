import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import { visualTokenCss } from '../design/tokens.mjs';
import { i18nRuntime, normalizeLocale } from '../lib/i18n.mjs';
import { hostCapabilities } from '../lib/host-capabilities.mjs';

// Assemble current shipped renderer + shared observations + host semantics.
// No dependency on a cached DSH conversation or its private stats snapshot.
export function writeHostTracePage(payload, output, { locale } = {}) {
  locale = locale === 'auto' ? 'auto' : normalizeLocale(locale);
  payload = { ...payload, traceCapabilities: hostCapabilities(payload) };
  const label = {pi:'Pi',codex:'Codex',claude:'Claude Code'}[payload.host];
  if (!label) throw Error('Unsupported trace host');
  const asset = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const template = asset('plugin/analysis-view/lib/trace/page.html');
  let head = template.slice(0, template.indexOf('<script id="trace-data"')).replaceAll('/analysis-view/trace/fonts/', '/fonts/');
  const root = 'view/assets/', css = asset(root + 'context-observation.css');
  head = head.replace(/<title>[^<]*<\/title>/, '<title>' + label + ' · 会话分析</title>')
    .replace('<body class="geist-review">', '<body class="geist-review ' + payload.host + '-review">')
    .replace('</head>', '<style>' + visualTokenCss({legacyAliases:true}) + css + '</style></head>')
    .replace('<span class="geist-edition">02</span>', '<span class="geist-edition">' + label + '</span>');
  if (payload.host === 'pi') head = head.replace('<strong>执行路径</strong>', '<strong>Pi · ' + (payload.synthetic ? '模拟会话' : '会话分析') + '</strong>');
  if (payload.host === 'claude') head = head.replace('<strong>执行路径</strong>', '<strong>Claude Code · 会话分析</strong>');
  if (payload.synthetic) head = head.replace('<div class="app">', '<p role="note" style="font:11px var(--sans);color:var(--muted);padding:0 24px">全部内容、时长、用量与结果均为模拟；没有调用模型。</p><div class="app">');
  for(const font of ['Geist-Variable.woff2','GeistMono-Variable.woff2'])head=head.replaceAll('/fonts/'+font,'data:font/woff2;base64,'+readFileSync(new URL('../plugin/analysis-view/lib/trace/fonts/'+font,import.meta.url)).toString('base64'));
  let renderer = asset('plugin/analysis-view/lib/trace/page.js');
  const seam = "  $('review-return').onclick=reviewReturnOverview;";
  if (renderer.split(seam).length !== 2) throw Error('Trace boot seam changed');
  renderer = renderer.replace(seam, () => asset(root + payload.host + '-host.js') + '\n' + asset('lib/context-trend-geometry.mjs').replaceAll('export function ', 'function ') + '\n' + asset(root + 'context-observation.js') + '\n' + seam);
  new vm.Script(renderer);
  const encoded = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const html = head + '<script id="trace-data" type="application/json">' + encoded + '</script><script>' + (i18nRuntime(locale) + renderer).replace(/<\/script/gi, '<\\/script') + '\nwindow.__geistPayload=JSON.parse(document.getElementById("trace-data").textContent);document.getElementById("trace-data").textContent="";window.__geistBoot();</script></body></html>';
  mkdirSync(dirname(resolve(output)), { recursive: true }); writeFileSync(output, html);
  return { output: resolve(output), bytes: Buffer.byteLength(html), host: payload.host, synthetic: !!payload.synthetic, locale: locale || 'auto', capabilities: payload.traceCapabilities };
}
