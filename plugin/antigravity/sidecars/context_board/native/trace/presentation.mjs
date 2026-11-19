import { readFileSync, statSync } from 'node:fs';
import { i18nRuntime } from './shared/i18n.mjs';
import { failureMessages, failureViewRuntime } from './shared/tool-attribution.mjs';

const files = [
  'page.html',
  'page.js',
  'shared/visual-tokens.css',
  'shared/context-observation.css',
  'shared/context-trend-geometry.js',
  'shared/context-observation.js',
].map(name => new URL(name, import.meta.url));
const extensionSlot = '/*__TRACE_EXTENSIONS__*/';
const documentSlots = /\/\*__TRACE_(DATA|RENDERER|BOOT)__\*\//g;
const snapshotBoot = "(() => {\n" +
  "  const source = document.getElementById('trace-data');\n" +
  "  window.__geistPayload = JSON.parse(source.textContent);\n" +
  "  source.textContent = '';\n" +
  "  window.__geistBoot();\n" +
  "})();";
let presentation;

export function traceAssetVersion(paths) {
  return paths.map(file => {
    const stat = statSync(file);
    return [stat.mtimeMs, stat.ctimeMs, stat.size].join(':');
  }).join('|');
}

export function readTracePresentation() {
  const version = traceAssetVersion(files);
  if (presentation?.version !== version) {
    const [shell, renderer, tokens, style, geometry, observation] = files.map(file => readFileSync(file, 'utf8'));
    if (renderer.split(extensionSlot).length !== 2) throw Error('Trace renderer needs exactly one extension slot');
    for (const key of ['DATA', 'RENDERER', 'BOOT']) {
      if (shell.split('/*__TRACE_' + key + '__*/').length !== 2) throw Error('Trace document slot changed: ' + key);
    }
    presentation = {
      version,
      template: shell.replace('</head>', () => '<style>' + tokens + style + '</style></head>'),
      renderer,
      observation: geometry + '\n' + observation,
    };
  }
  return presentation;
}

const inlineScript = source => source.replace(/<\/script/gi, '<\\/script');

// Only startup and host evidence hooks differ. Substitute slots once so
// placeholder text in embedded evidence cannot be interpreted as a slot.
export function renderTraceDocument(payload, assets, {
  template = assets.template, locale = payload.locale, extension = '', boot = snapshotBoot,
} = {}) {
  const renderer = assets.renderer.replace(extensionSlot, () => extension + '\n' + assets.observation);
  const values = {
    DATA: JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'),
    RENDERER: inlineScript(i18nRuntime(locale, failureMessages) + failureViewRuntime() + renderer),
    BOOT: inlineScript(boot),
  };
  return template.replace(documentSlots, (_, key) => values[key]);
}
