import { readFileSync } from 'node:fs';
import { inlineTraceFonts } from '../../trace/fonts.mjs';
import { i18nRuntime } from '../../trace/shared/i18n.mjs';
import { failureMessages, failureViewRuntime } from '../../trace/shared/tool-attribution.mjs';
import { overviewMessages } from './messages.mjs';
import { findingsRuntime } from '../findings.mjs';
import { evalAsset, editorMarkup } from '../render.mjs';

const asset = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const script = name => asset(name).replace(/<\/script/gi, '<\\/script');

export function renderOverviewPage({ data, locale } = {}) {
  const html = asset('page.html')
    .replace('/* OVERVIEW_STYLES */', () => asset('style.css') + '\n' + evalAsset('findings.css'))
    .replace('/* OVERVIEW_I18N */', () => i18nRuntime(locale, { ...overviewMessages, ...failureMessages }) + failureViewRuntime())
    .replace('<!-- OVERVIEW_DATA -->', () => data
      ? '<script type="application/json" id="overview-data">' + JSON.stringify(data).replaceAll('<', '\\u003c') + '</script>' : '')
    .replace('<!-- OVERVIEW_EDITOR -->', () => editorMarkup())
    .replace('/* OCCUPANCY_SCRIPT */', () => script('occupancy.js'))
    .replace('/* OVERVIEW_SCRIPT */', () => [findingsRuntime(),evalAsset('findings.js'),
      'window.__trajectoryDiagnosisOptions={mode:'+JSON.stringify(data?.host??'dsh')+',allowApply:'+String(!data?.host||data.host==='dsh')+',source:()=>window.__trajectoryOverviewDiagnosisSource};',
      evalAsset('diagnosis.js'),asset('app.js')].join('\n').replace(/<\/script/gi,'<\\/script'));
  return data ? inlineTraceFonts(html) : html;
}
