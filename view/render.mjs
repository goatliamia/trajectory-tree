import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { normalizeLocale } from '../lib/i18n.mjs';
import { hostCapabilities } from '../lib/host-capabilities.mjs';
import { readTracePresentation, renderTraceDocument } from '../plugin/analysis-view/lib/trace/presentation.mjs';
import { inlineTraceFonts } from '../plugin/analysis-view/lib/trace/fonts.mjs';
import { editorMarkup, draftOptions, evalAsset } from '../plugin/analysis-view/lib/eval/render.mjs';

// Assemble current shipped renderer + shared observations + host semantics.
// No dependency on a cached DSH conversation or its private stats snapshot.
export function writeHostTracePage(payload, output, { locale, diagnosis } = {}) {
  locale = locale === 'auto' ? 'auto' : normalizeLocale(locale);
  payload = { ...payload, traceCapabilities: hostCapabilities(payload) };
  const label = {pi:'Pi',codex:'Codex',claude:'Claude Code'}[payload.host];
  if (!label) throw Error('Unsupported trace host');
  const assets = readTracePresentation();
  let template = assets.template.replace(/<title>[^<]*<\/title>/, '<title>' + label + ' · 会话分析</title>')
    .replace('<body class="geist-review">', '<body class="geist-review ' + payload.host + '-review">')
    .replace('<span class="geist-edition">02</span>', '<span class="geist-edition">' + label + '</span>');
  if (payload.host === 'pi') template = template.replace('<strong>执行路径</strong>', '<strong>Pi · ' + (payload.synthetic ? '模拟会话' : '会话分析') + '</strong>');
  if (payload.host === 'claude') template = template.replace('<strong>执行路径</strong>', '<strong>Claude Code · 会话分析</strong>');
  if (payload.synthetic) template = template.replace('<div class="app">', '<p role="note" style="font:11px var(--sans);color:var(--muted);padding:0 24px">全部内容、时长、用量与结果均为模拟；没有调用模型。</p><div class="app">');
  template = inlineTraceFonts(template);
  if (diagnosis) template = template.replace('<script id="trace-data"', () => editorMarkup() + '<script id="trace-data"');
  const extension = readFileSync(new URL('./assets/' + payload.host + '-host.js', import.meta.url), 'utf8') +
    (diagnosis ? '\n' + [draftOptions(diagnosis, payload.host), evalAsset('diagnosis.js'), evalAsset('diagnosis-gesture.js'), evalAsset('diagnosis-trace.js'),
      `const selectionCaption = geistArrangeCaption; geistArrangeCaption = function() { selectionCaption(); const caption = document.getElementById('graph-caption'); if (!caption.querySelector('.portable-selection-hint')) { const hint = document.createElement('span'); hint.className = 'review-quiet portable-selection-hint'; hint.style.cssText = 'font-size:11px;margin-inline-start:auto'; hint.textContent = globalThis.__trajectoryLocale === 'en' ? 'Hold to select · Shift+Enter' : '长按选取诊断 · Shift+Enter'; caption.append(hint); } };`
    ].join('\n') : '');
  const html = renderTraceDocument(payload, assets, { template, locale, extension });
  mkdirSync(dirname(resolve(output)), { recursive: true }); writeFileSync(output, html);
  return { output: resolve(output), bytes: Buffer.byteLength(html), host: payload.host, synthetic: !!payload.synthetic, locale: locale || 'auto', capabilities: payload.traceCapabilities };
}
