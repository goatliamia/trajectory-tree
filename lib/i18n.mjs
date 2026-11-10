import { MESSAGES_A } from './i18n-catalog-a.mjs';
import { MESSAGES_B } from './i18n-catalog-b.mjs';
import { MESSAGES_C } from './i18n-catalog-c.mjs';
import { MESSAGES_D } from './i18n-catalog-d.mjs';

const UI_MESSAGES = { ...MESSAGES_A, ...MESSAGES_B, ...MESSAGES_C, ...MESSAGES_D };
// Whole-literal overrides keep count fragments and common headings idiomatic.
const UI_OVERRIDES = {
  '第 ': '', ' 轮': ' turns', ' 步': ' steps', '轮': 'turns', '步': 'steps',
  ' · 第 ': ' · ', ' 轮 · 第 ': ' turns · ', '第': '',
  '执行路径': 'Trajectory', '行动路径': 'Action path', '会话分析': 'Session analysis',
  '用户输入': 'User input', '运行时注入': 'Runtime injections', '模型输出（含思考）': 'Model output (including reasoning)',
  '工具输出': 'Tool output', '轨迹诊断报告': 'Trajectory diagnostic report', '诊断报告': 'Diagnostic report',
  '界面语言': 'Interface language',
  '轮真实记录': ' recorded turns', ' 轮真实记录': ' recorded turns',
  ' 轮执行记录': ' recorded turns',
  '第 {turn} 轮末': 'End of turn {turn}', '取消{category}': 'Deselect {category}', '选上{category}': 'Select {category}',
};
const UI_PATTERN = new RegExp(Object.keys({ ...UI_MESSAGES, ...UI_OVERRIDES }).sort((a,b) => b.length-a.length).map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
let currentLocale = 'zh-CN';

export function normalizeLocale(value) {
  if (value == null || value === '' || value === 'auto') return null;
  if (/^en(?:[-_]|$)/i.test(value)) return 'en';
  if (/^zh(?:[-_]|$)/i.test(value)) return 'zh-CN';
  throw new Error('Language must be en, zh-CN or auto');
}

export function resolveUiLocale({ query, preferred, stored, host, languages = [] } = {}) {
  const safe = value => { try { return normalizeLocale(value); } catch { return null; } };
  const automatic = query === 'auto' || preferred === 'auto';
  return safe(query) || (!automatic && (safe(preferred) || safe(stored))) || safe(host) || languages.map(safe).find(Boolean) || 'en';
}

// Only call this on authored UI literals, before interpolating evidence. It is
// deliberately not a DOM observer or a translator for user text and tool output.
export function ui(text, locale, ...values) {
  if (Array.isArray(text) && Object.hasOwn(text, 'raw')) {
    const interpolations = [locale, ...values];
    const pattern = text.map((part, index) => part + (index < interpolations.length ? '\ue000'+index+'\ue001' : '')).join('');
    const language = normalizeLocale(globalThis.__trajectoryLocale ?? currentLocale);
    const translated = language === 'en' ? pattern.replace(/第\s*(\ue000\d+\ue001)\s*轮/g, 'Turn $1').replace(/第\s*(\ue000\d+\ue001)\s*步/g, 'Step $1') : pattern;
    return ui(translated).replace(/\ue000(\d+)\ue001/g, (_, index) => String(interpolations[Number(index)]));
  }
  const language = normalizeLocale(locale ?? globalThis.__trajectoryLocale ?? currentLocale);
  if (language !== 'en') return text;
  if (Object.hasOwn(UI_OVERRIDES, text)) return UI_OVERRIDES[text];
  return String(text).replace(UI_PATTERN, key => UI_OVERRIDES[key] ?? UI_MESSAGES[key])
    .replace(/，/g, ', ').replace(/。/g, '. ').replace(/；/g, '; ').replace(/：/g, ': ')
    .replace(/（/g, ' (').replace(/）/g, ')').replace(/／/g, '/');
}

// Report rendering is synchronous. Restore the previous scope even for nested
// renders and failures; unrelated render calls never inherit a report locale.
export function withUiLocale(locale, render) {
  const previous = currentLocale;
  currentLocale = normalizeLocale(locale) || 'zh-CN';
  try { return render(); } finally { currentLocale = previous; }
}

function installUi(preferred, showSwitcher = true) {
  let query, stored;
  try { query = new URL(location.href).searchParams.get('lang'); } catch {}
  try { stored = localStorage.getItem('trajectory-language'); } catch {}
  let hostDocument;
  try { if (window.parent !== window && window.parent.location.origin === location.origin) hostDocument = window.parent.document; } catch {}
  const resolve = () => resolveUiLocale({ query, preferred, stored, host: hostDocument?.documentElement.lang,
    languages: [...(globalThis.navigator?.languages || []), globalThis.navigator?.language] });
  globalThis.__trajectoryLocale = resolve();
  globalThis.__trajectoryUi = ui;
  document.documentElement.lang = globalThis.__trajectoryLocale;
  // This runs once before the renderer inserts any native data. Translate only
  // the static shell and accessibility labels, never the JSON/script contents.
  const walk = node => {
    if (node.nodeType === 3) { node.textContent = ui(node.textContent); return; }
    if (node.nodeType !== 1 || /^(SCRIPT|STYLE|PRE|CODE)$/.test(node.tagName) || node.hasAttribute('data-i18n-preserve')) return;
    for (const key of ['title', 'aria-label', 'placeholder', 'label']) if (node.hasAttribute(key)) node.setAttribute(key, ui(node.getAttribute(key)));
    for (const child of node.childNodes) walk(child);
  };
  walk(document.documentElement);
  const bar = document.querySelector('.review-toolbar') || document.querySelector('.report-brand');
  if (showSwitcher && bar && !document.getElementById('trajectory-language')) {
    const select = document.createElement('select'); select.id = 'trajectory-language';
    select.className = 'geist-text-action quiet';
    select.setAttribute('aria-label', ui('界面语言'));
    for (const [value, label] of [['auto', globalThis.__trajectoryLocale === 'en' ? 'Auto (English)' : '自动（中文）'], ['zh-CN', '中文'], ['en', 'English']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
    }
    select.value = query === 'auto' ? 'auto' : (() => { try { return normalizeLocale(query || preferred || stored) || 'auto'; } catch { return 'auto'; } })();
    select.onchange = () => {
      const language = select.value;
      try { if (language === 'auto') localStorage.removeItem('trajectory-language'); else localStorage.setItem('trajectory-language', language); } catch {}
      const target = new URL(location.href); target.searchParams.set('lang', language); location.href = target.href;
    };
    bar.append(select);
  }
  const refresh = () => { if (resolve() !== globalThis.__trajectoryLocale) location.reload(); };
  window.addEventListener('languagechange', refresh);
  window.addEventListener('storage', event => { if (event.key === 'trajectory-language') { stored = event.newValue; refresh(); } });
  if (hostDocument && typeof MutationObserver !== 'undefined') new MutationObserver(refresh).observe(hostDocument.documentElement, { attributes: true, attributeFilter: ['lang'] });
}

export function i18nRuntime(locale) {
  const preferred = locale === 'auto' ? 'auto' : normalizeLocale(locale);
  return 'const UI_MESSAGES=' + JSON.stringify(UI_MESSAGES).replace(/</g,'\\u003c') + ';\nconst UI_OVERRIDES=' + JSON.stringify(UI_OVERRIDES) + ';\nconst UI_PATTERN=new RegExp(' + JSON.stringify(UI_PATTERN.source) + ',"g");\nlet currentLocale="zh-CN";\n' +
    [normalizeLocale, resolveUiLocale, ui, installUi].map(fn => fn.toString()).join('\n') + '\ninstallUi(' + JSON.stringify(preferred) + ', false);\n';
}

// The DSH npm package also consumes pure models on the server. Keep their
// generated dependency self contained instead of pointing outside that package.
export function i18nModuleSource() {
  return '/* Generated by scripts/sync-view-assets.mjs. */\nconst UI_MESSAGES=' + JSON.stringify(UI_MESSAGES) + ';\nconst UI_OVERRIDES=' + JSON.stringify(UI_OVERRIDES) + ';\nconst UI_PATTERN=new RegExp(' + JSON.stringify(UI_PATTERN.source) + ',"g");\nlet currentLocale="zh-CN";\n' +
    [normalizeLocale, resolveUiLocale, ui, installUi, i18nRuntime].map(fn => 'export ' + fn.toString()).join('\n') + '\n';
}
