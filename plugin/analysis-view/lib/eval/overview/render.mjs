import { readFileSync } from 'node:fs';
import { inlineTraceFonts } from '../../trace/fonts.mjs';
import { i18nRuntime } from '../../trace/shared/i18n.mjs';
import { failureMessages, failureViewRuntime } from '../../trace/shared/tool-attribution.mjs';
import { overviewMessages } from './messages.mjs';

const asset = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const script = name => asset(name).replace(/<\/script/gi, '<\\/script');

export function renderOverviewPage({ data, locale } = {}) {
  const html = asset('page.html')
    .replace('/* OVERVIEW_STYLES */', () => asset('style.css'))
    .replace('/* OVERVIEW_I18N */', () => i18nRuntime(locale, { ...overviewMessages, ...failureMessages }) + failureViewRuntime())
    .replace('<!-- OVERVIEW_DATA -->', () => data
      ? '<script type="application/json" id="overview-data">' + JSON.stringify(data).replaceAll('<', '\\u003c') + '</script>' : '')
    .replace('/* SESSION_SCRIPT */', () => script('session-view.js'))
    .replace('/* OVERVIEW_SCRIPT */', () => script('app.js'));
  return data ? inlineTraceFonts(html) : html;
}
