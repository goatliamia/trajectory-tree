import { readFileSync } from 'node:fs';
import { i18nRuntime } from '../trace/shared/i18n.mjs';

export const evalAsset = name => readFileSync(new URL(name, import.meta.url), 'utf8');
export const embedJson = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const inline = script => '<script>\n' + script.replace(/<\/script/gi, '<\\/script') + '\n</script>';
const json = (id, data) => '<script type="application/json" id="' + id + '">' + embedJson(data) + '</script>';

export const traceFonts = () => ['Geist-Variable.woff2', 'GeistMono-Variable.woff2'].map(file => ({
  file, url: 'data:font/woff2;base64,' + readFileSync(new URL('../trace/fonts/' + file, import.meta.url)).toString('base64'),
}));
export function inlineTraceFonts(template) {
  for (const { file, url } of traceFonts()) template = template.replaceAll('/analysis-view/trace/fonts/' + file, url);
  return template;
}
export const editorMarkup = () => '<style>' + evalAsset('editor.css') + '</style>\n' + evalAsset('editor.html');
export const draftOptions = (source, mode) =>
  'window.__trajectoryDiagnosisOptions = { mode: ' + embedJson(mode) + ', source: () => (' + embedJson(source) + ') };';
export const demoBridge = [
  'window.__diagnosisDemoAsk = (selection, button, view) => {',
  '  const { top, right, bottom, left } = button.getBoundingClientRect();',
  "  parent.postMessage({ type: 'diagnosis-demo-confirm', selection, view, anchor: { top, right, bottom, left } }, '*');",
  '};',
].join('\n');

export function renderEvalPage(data, { integrated = false, script = '', diagnosis, mode, locale } = {}) {
  const native = integrated && mode === 'dsh';
  const styles = [readFileSync(new URL('../trace/shared/visual-tokens.css', import.meta.url), 'utf8'),
    ...(native ? ['Geist-Variable.woff2', 'GeistMono-Variable.woff2'].map(file => ({ file, url: '/analysis-view/trace/fonts/' + file })) : traceFonts()).map(({ file, url }) => {
      const family = file.startsWith('GeistMono') ? 'GeistMono' : 'Geist';
      return '@font-face{font-family:' + family + ';src:url(' + url + ") format('woff2');font-weight:100 900;font-display:swap}";
    }),
    ...['style.css', 'views.css', 'themes.css'].map(evalAsset),
    integrated ? '.brand,.appearance-control{display:none}.header-inner{justify-content:flex-end}.eval-native-details{margin-inline-end:auto}' : '',
    '.eval-diagnosis-action + .eval-diagnosis-action{margin-inline-start:12px}',
  ].join('\n');
  const editor = diagnosis ? editorMarkup() : '';
  const editorScript = diagnosis ? draftOptions(diagnosis, mode) + '\n' + evalAsset('diagnosis.js') : '';
  const details = native && diagnosis ? '<button type="button" id="eval-native-details" class="eval-native-details text-action" hidden>统计明细</button>' : '';
  const detailsScript = details ? `
    const detailsButton = document.getElementById('eval-native-details');
    detailsButton.hidden = parent === window;
    detailsButton.onclick = () => parent.postMessage({ type: 'analysis-eval-details', sessionId: ${embedJson(diagnosis.session)} }, location.origin);
  ` : '';
  return evalAsset('index.html')
    .replace('<!-- eval:styles -->', () => '<style>\n' + styles + '\n</style>')
    .replace('<!-- eval:details -->', () => details)
    .replace('<!-- eval:data -->', () => json('eval-data', data))
    .replace('<!-- eval:script -->', () => editor + inline([
      i18nRuntime(locale), editorScript, detailsScript, script, evalAsset('dashboard.js'),
    ].join('\n')));
}

export function renderDiagnosisDemo(data) {
  return evalAsset('diagnosis.html')
    .replace('<!-- diagnosis:editor -->', () => editorMarkup())
    .replace('<!-- diagnosis:data -->', () => json('diagnosis-data', data))
    .replace('<!-- diagnosis:script -->', () => inline(i18nRuntime() + evalAsset('diagnosis.js')));
}
