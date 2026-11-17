import { MESSAGES_A } from './i18n-catalog-a.mjs';
import { MESSAGES_B } from './i18n-catalog-b.mjs';
import { MESSAGES_C } from './i18n-catalog-c.mjs';
import { MESSAGES_D } from './i18n-catalog-d.mjs';
import { MESSAGES_E } from './i18n-catalog-e.mjs';
import { failureMessages } from '../plugin/trajectory-tools/lib/tool-attribution.js';

const UI_MESSAGES = { ...MESSAGES_A, ...MESSAGES_B, ...MESSAGES_C, ...MESSAGES_D, ...MESSAGES_E, ...failureMessages };
// Whole-literal overrides keep count fragments and common headings idiomatic.
const UI_OVERRIDES = {
  '运行细节': 'Run details', '时间观测': 'Timing observations', '调用与上下文': 'Calls and context', '记录覆盖': 'Recorded coverage',
  '轮内记录跨度合计 ': 'Sum of within-turn recorded spans ', '累计记录跨度': 'Cumulative recorded span',
  '记录跨度': 'Recorded span', '跨度 ': 'Span ', ' 轮 · 记录跨度 ': ' · recorded span ',
  '每轮记录跨度': 'Recorded span per turn',
  '从用户输入到末条记录 · 包含记录之间的等待，结束边界未记录': 'From user input to the last record · includes waits between records; turn end is unrecorded',
  '。点击查看每轮记录跨度；包含记录之间的等待。': '. View each turn’s recorded span, including waits between records.',
  '请求来源变化': 'Request source changes', '请求构成趋势': 'Request composition trend', '请求文本估算': 'Request text estimate',
  '当前记录没有可显示的上下文组成': 'No context composition is available in these records',
  '核对工作区边界': 'Check the worktree boundary',
  '宿主拦截了跨工作区的文件操作；核对会话工作区、目标路径及后续工具结果。': 'The host blocked a cross-worktree file operation. Check the session worktree, target path and subsequent tool results.',
  '会话所在工作区与调用的目标路径': 'The session worktree and the operation target path',
  '是否已有对应工作区内的后续返回': 'Whether a subsequent call returned inside the corresponding worktree',
  '保留隔离边界，不将拒绝当作文件已修改': 'Preserve the isolation boundary; rejection does not mean the file was modified',
  '发生层': 'Layer', '控制状态': 'Control state', '更早读取序号': 'Prior read seq', '记录数': 'Records',
  '关注分类': 'Focus category', '规则标识': 'Rule ID',
  '修复实现线索': 'Repair leads', '恢复观察线索': 'Recovery leads',
  '补齐能力线索': 'Capability leads', '保留方法线索': 'Method leads',
  '执行器': 'Executor', '失败阶段': 'Failure phase',
  '复制查询': 'Copy query', '记录证据': 'Record evidence',
  '展开载荷与取证参数': 'Expand payload and query', '总并发占比': 'Overlap share',
  '处置出口': 'Disposition actions',
  '第 ': '', ' 轮': ' turns', ' 步': ' steps', '轮': 'turns', '步': 'steps',
  ' · 第 ': ' · ', ' 轮 · 第 ': ' turns · ', '第': '',
  '执行路径': 'Trajectory', '行动路径': 'Action path', '会话分析': 'Session analysis',
  '用户输入': 'User input', '运行时注入': 'Runtime injections', '模型输出（含思考）': 'Model output (including reasoning)',
  '工具输出': 'Tool output', '轨迹诊断报告': 'Trajectory diagnostic report', '诊断报告': 'Diagnostic report',
  '界面语言': 'Interface language',
  '会话诊断': 'Session diagnosis', '章节导航': 'Contents', '本次分析': 'This analysis',
  '报告章节': 'Report sections', ' 节': ' sections', '查看数据口径与证据位置': 'View measurement basis and evidence',
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

export function i18nRuntime(locale, additionalMessages) {
  const preferred = locale === 'auto' ? 'auto' : normalizeLocale(locale);
  const messages = additionalMessages ? { ...UI_MESSAGES, ...additionalMessages } : UI_MESSAGES;
  const pattern = additionalMessages ? Object.keys({ ...messages, ...UI_OVERRIDES }).sort((a, b) => b.length - a.length)
    .map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') : UI_PATTERN.source;
  return 'const UI_MESSAGES=' + JSON.stringify(messages).replace(/</g,'\\u003c') + ';\nconst UI_OVERRIDES=' + JSON.stringify(UI_OVERRIDES) + ';\nconst UI_PATTERN=new RegExp(' + JSON.stringify(pattern) + ',"g");\nlet currentLocale="zh-CN";\n' +
    [normalizeLocale, resolveUiLocale, ui, installUi].map(fn => fn.toString()).join('\n') + '\ninstallUi(' + JSON.stringify(preferred) + ', false);\n';
}

// The DSH npm package also consumes pure models on the server. Keep their
// generated dependency self contained instead of pointing outside that package.
export function i18nModuleSource() {
  return '/* Generated by scripts/sync-view-assets.mjs. */\nconst UI_MESSAGES=' + JSON.stringify(UI_MESSAGES) + ';\nconst UI_OVERRIDES=' + JSON.stringify(UI_OVERRIDES) + ';\nconst UI_PATTERN=new RegExp(' + JSON.stringify(UI_PATTERN.source) + ',"g");\nlet currentLocale="zh-CN";\n' +
    [normalizeLocale, resolveUiLocale, ui, installUi, i18nRuntime].map(fn => 'export ' + fn.toString()).join('\n') + '\n';
}
