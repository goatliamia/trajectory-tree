// dsh-analysis-view 客户端半边的离线冒烟测试。
//
// 面板是真 React 组件,但没有浏览器就跑不了 useEffect/fetch。这里用一个极小的 React 垫片
// 真的**执行**组件树(createElement 递归调用函数组件,useState/useMemo 可用),于是 render 路径
// 上的错(未定义组件、取错字段、key 缺失导致的崩)会在 node 里直接暴露出来。
//
// 用法:node plugin/analysis-view/self-test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

let failed = 0;
const results = [];
const check = (name, condition, detail) => {
  results.push((condition ? "PASS " : "FAIL ") + name + (condition ? "" : "  " + String(detail === undefined ? "" : JSON.stringify(detail))));
  if (!condition) failed++;
};

/* ---------------- React 垫片 ---------------- */
const frames = [];
const hookFrames = [];
const renderedComponents = new Map();
function currentFrame() {
  return hookFrames[hookFrames.length - 1];
}
let captureLocaleEffect = false, localeEffect = null, refreshCount = 0;
const ReactShim = {
  createElement(type, props, ...children) {
    const merged = Object.assign({}, props || {});
    if (children.length > 0) merged.children = children.length === 1 ? children[0] : children;
    if (typeof type === "function") {
      renderedComponents.set(type.name, type);
      const depth = hookFrames.length + 1;
      const frame = frames[frames.length - 1];
      hookFrames.push({ index: 0, seeds: depth === 1 && frame ? frame.seeds : null });
      try {
        return type(merged);
      } finally {
        hookFrames.pop();
      }
    }
    return { type: type, props: merged };
  },
  Fragment(props) {
    return props.children;
  },
  useState(initial) {
    const frame = currentFrame();
    const index = frame === null ? 0 : frame.index++;
    const seeded = frame !== null && frame.seeds !== null && Object.prototype.hasOwnProperty.call(frame.seeds, index);
    const value = seeded ? frame.seeds[index] : typeof initial === "function" ? initial() : initial;
    return [value, () => { if (captureLocaleEffect) refreshCount++; }];
  },
  useEffect(effect) { if (captureLocaleEffect && String(effect).includes('MutationObserver')) localeEffect = effect; },
  useLayoutEffect() {},
  useMemo(factory) {
    return factory();
  },
  useCallback(fn) {
    return fn;
  },
  memo(component) {
    return component;
  },
  useRef(value) {
    return { current: value };
  },
};

let moduleDef = null;
const sandbox = {
  window: { document: { documentElement: { lang: 'zh' } }, __ModuleLoader__: { load(definition) { moduleDef = definition; } } },
  console,
  Date,
  Math,
  JSON,
  Map,
  Set,
  Number,
  String,
  Array,
  Object,
  Promise,
  setTimeout,
  clearTimeout,
  fetch() {
    return Promise.reject(new Error("offline"));
  },
  AbortController,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL("./lib/client.js", import.meta.url), "utf8"), sandbox);

check("client: 模块向 __ModuleLoader__ 注册了自己", moduleDef !== null && moduleDef.id === "dsh-analysis-view", moduleDef && moduleDef.id);

const required = [];
const mod = moduleDef.factory((name) => {
  required.push(name);
  if (name === "react") return ReactShim;
  throw new Error("unexpected module: " + name);
});
check("client: 只依赖 react", required.length > 0 && required.every((name) => name === "react"), required);

let Panel = null, ContextPanel = null, CompositionPanel = null;
const ctx = {
  commandUi: { register(command) { check("client: /trajectory is a direct UI action", command.name === "trajectory" && command.ui.kind === "action"); } },
  uiConversation: { views: { register() {} }, binding() { return { target() { return { getSnapshot() { return null; }, subscribe() { return () => {}; } }; } }; } },
  slots: {
    inject(name, register) { register(); },
    register(definition, component) {
      if (definition && definition.id === "analysis") Panel = component;
      if (definition && definition.id === "context-composition") CompositionPanel = component;
      if (definition && definition.name === "main" && definition.key === "context-manager") ContextPanel = component;
      return () => {};
    },
  },
};
mod.apply(ctx);
check("client: context composition registers a conversation view", typeof CompositionPanel === "function");
check("client: 注册到 conversation.view 的 analysis", Panel !== null && typeof Panel === "function");

/* ---------------- 渲染工具 ---------------- */
function render(component, props, seeds) {
  frames.push({ seeds: seeds || null, depth: 1 });
  try {
    return ReactShim.createElement(component, props);
  } finally {
    frames.pop();
  }
}
function textOf(node, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) textOf(child, out);
    return out;
  }
  if (node.props) textOf(node.props.children, out);
  return out;
}
function all(node, out = []) {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) all(child, out);
    return out;
  }
  out.push(node);
  if (node.props) all(node.props.children, out);
  return out;
}

const digest = {
  sessionId: "session-fixture",
  log: { id: "abcdef123456", events: 100, minSeq: 0, maxSeq: 99 },
  turns: 2,
  toolCalls: 5,
  errors: 1,
  emptyTurns: 0,
  incidentCount: 1,
  incidents: [{
    type: "error",
    severity: 1,
    title: "调用失败",
    detail: "1 个工具调用返回错误(BashError:E1)",
    cause: "工具调用返回了错误结果",
    runtimeKnew: "错误码已在事件中",
    modelKnew: "收到 tool result",
    harness: "无 guard;需模型自纠",
    impact: "该部分目标未达成",
    seqs: [70],
  }],
  cost: {
    requestCount: 2,
    unknownRequests: 0,
    input: 100,
    cacheRead: 900,
    cacheWrite: null,
    output: 50,
    reasoning: null,
    total: 1050,
    cacheEfficiency: 0.9,
    pricing: {
      currency: "CNY",
      models: ["deepseek-flash"],
      priced: 2,
      unpriced: 0,
      peakRequests: 1,
      total: 2.02,
      cost: { miss: 0.42, hit: 0.89, output: 0.71 },
      rates: { cacheHit: [0.02, 0.04], cacheMiss: [1, 2], output: [4, 8] },
    },
    byTurn: [
      { turn: 1, requests: 1, input: 60, cacheRead: 600, output: 30, cacheEfficiency: 0.909 },
      { turn: 2, requests: 1, input: 40, cacheRead: 300, output: 20, cacheEfficiency: 0.882 },
    ],
  },
  turnStats: [
    { turn: 1, startSeq: 0, endSeq: 40, startTime: 1000, endTime: 10000, durationMs: 9000, endReason: "end-turn", toolCalls: 3, errors: 0, requests: 1, input: 60, cacheRead: 600, output: 30, firstErrorSeq: null, firstErrorCallId: null, firstCallId: "call-1" },
    { turn: 2, startSeq: 41, endSeq: 99, startTime: 10001, endTime: 15000, durationMs: 4999, endReason: "end-turn", toolCalls: 2, errors: 1, requests: 1, input: 40, cacheRead: 300, output: 20, firstErrorSeq: 70, firstErrorCallId: "call-err", firstCallId: "call-2" },
  ],
  toolStats: [
    { name: "read", category: "file", calls: 3, errors: 0, avgMs: 120, maxMs: 300, totalMs: 360, byTurn: [{ turn: 1, calls: 2 }, { turn: 2, calls: 1 }], lastSeq: 30 },
    { name: "pwsh", category: "run", calls: 2, errors: 1, avgMs: 900, maxMs: 1200, totalMs: 1800, byTurn: [{ turn: 2, calls: 2 }], lastSeq: 70 },
  ],
  eventCount: 100,
};

const readyState = { status: "ready", data: digest, error: null, at: Date.now() };
const props = { sessionId: "session-fixture", openView() {}, useTrajectory: () => null };

const tree = render(Panel, props, { 0: readyState });
const text = textOf(tree).join(" ");
const nodes = all(tree);
const classes = nodes.map((node) => (node.props && node.props.className) || "");

check("render: 标题与状态在位", text.includes("分析") && text.includes("abcdef123456"), text.slice(0, 120));
check("render: 五个 KPI", ["轮次", "工具调用", "失败", "缓存命中", "事件"].every((label) => text.includes(label)), text.slice(0, 200));
check("render: 轮次地图两个 turn", classes.filter((name) => /^av-seg /.test(name)).length === 2, classes.filter((name) => /^av-seg /.test(name)));
check("render: 有失败的轮次靠 firstErrorCallId 可点(不依赖投影)", classes.some((name) => /^av-seg (warn|bad) clickable/.test(name)), classes.filter((name) => /^av-seg /.test(name)));
check("render: 花费按轮画了两条", classes.filter((name) => name === "av-cost-row").length === 2);
check("render: 花费把命中与未命中分开画", classes.filter((name) => name === "av-fill hit").length === 2 && classes.filter((name) => name === "av-fill miss").length === 2, classes.filter((name) => name.startsWith("av-fill")));
check("render: 低命中率那一轮标 warn", classes.filter((name) => name === "av-rate warn").length === 1, classes.filter((name) => name.startsWith("av-rate")));
check("render: 花费总览用未命中/命中", text.includes("未命中") && text.includes("命中率") && text.includes("缓存承担了"), text.slice(0, 260));
check("render: 花费行可点跳对话", nodes.some((node) => node.props && node.props.className === "av-cost-row" && node.props.role === "button" && typeof node.props.onClick === "function"), classes.filter((name) => name === "av-cost-row"));
check("render: 命中/未命中各自带花费,合计进 KPI 行", text.includes("¥0.42") && text.includes("¥0.89") && text.includes("¥0.71") && text.includes("≈ ¥2.02") && !text.includes("价目") && classes.filter((name) => name === "av-cost-cell").length === 5, classes.filter((name) => name === "av-cost-cell"));
check("render: 工具画成环形图并按 host 类别分组", nodes.some((node) => node.type === "svg") && classes.filter((name) => name === "av-leg").length >= 2 && text.includes("文件") && text.includes("执行"), classes.filter((name) => name === "av-leg"));
check("render: 工具默认就是三张(类别 / 工具 / 轮次)", classes.filter((name) => name === "av-flow-card").length === 3 && nodes.filter((node) => node.type === "svg").length === 3 && text.includes("按类别") && text.includes("用在哪些轮"), classes.filter((name) => name.startsWith("av-flow")));
check("render: incident 卡片与因果链", text.includes("调用失败") && text.includes("Runtime 知道") && text.includes("影响"));
check("render: 证据 chip 与解读入口", classes.filter((name) => name === "av-chip").length === 1 && text.includes("生成解读"));
check("render: 页脚带日志身份", text.includes("日志 abcdef123456"), text.slice(-160));

/* 失败态:host 路由不可用 + 轨迹投影里有报错 → 降级 incident 仍要出现 */
const snap = { eventNodes: [{ kind: "tool-result", seq: 12, error: { name: "BashError" } }, { kind: "tool-result", seq: 13 }] };
const errorTree = render(Panel, { sessionId: "session-fixture", openView() {}, useTrajectory: () => snap }, { 0: { status: "error", data: null, error: "HTTP 500", at: 0 } });
const errorText = textOf(errorTree).join(" ");
check("render: 失败态给提示与重试", errorText.includes("读取会话失败") && errorText.includes("重试"), errorText.slice(0, 160));
check("render: 失败态仍列投影里的事实", errorText.includes("调用失败") && errorText.includes("来自轨迹投影"), errorText.slice(0, 240));

/* 空会话:没有事件时不假装有数据 */
const emptyTree = render(Panel, { sessionId: "session-fixture", openView() {}, useTrajectory: () => null }, { 0: { status: "ready", data: Object.assign({}, digest, { turns: 0, toolCalls: 0, errors: 0, incidentCount: 0, incidents: [], turnStats: [], toolStats: [], eventCount: 0 }), error: null, at: Date.now() } });
const emptyText = textOf(emptyTree).join(" ");
check("render: 空会话不画假图表", emptyText.includes("这段会话还没有开始任何 turn") && emptyText.includes("没有发现可归因的 incident"), emptyText.slice(0, 200));

// Exercise the locale effect and rerender with the same recorded data.
let mutationCallback, storageCallback, disconnected = false;
sandbox.window.MutationObserver = class { constructor(callback) { mutationCallback = callback; } observe() {} disconnect() { disconnected = true; } };
sandbox.window.addEventListener = (name, callback) => { if (name === 'storage') storageCallback = callback; };
sandbox.window.removeEventListener = () => {};
captureLocaleEffect = true;
render(Panel, props, { 0: readyState });
const cleanupLocale = localeEffect();
sandbox.window.document.documentElement.lang = 'en';
mutationCallback();
const englishText = textOf(render(Panel, props, { 0: readyState })).join(' ');
check('locale: lang change requests render and translates categories without altering records', refreshCount === 1 && englishText.includes('Analysis') && englishText.includes('Files') && englishText.includes('调用失败') && englishText.includes('abcdef123456'));
const rangeText = textOf(render(ContextPanel, {}, { 1: '30d', 2: { status: 'loading' } })).join(' ');
check('locale: context ranges follow language on render', rangeText.includes('Last 30 days') && rangeText.includes('Today'));
sandbox.window.localStorage = { getItem: () => 'zh' };
storageCallback({ key: 'trajectory-language' });
const preferredText = textOf(render(Panel, props, { 0: readyState })).join(' ');
cleanupLocale();
check('locale: stored preference wins and storage change requests render', refreshCount === 2 && preferredText.includes('分析') && preferredText.includes('文件') && disconnected);
sandbox.window.localStorage = { getItem: () => null };
sandbox.window.document.documentElement.lang = 'fr';
sandbox.window.navigator = { languages: ['fr', 'zh-CN', 'en'] };
const fallbackText = textOf(render(Panel, props, { 0: readyState })).join(' ');
sandbox.window.navigator.languages = ['fr'];
const defaultText = textOf(render(Panel, props, { 0: readyState })).join(' ');
check('locale: first supported navigator language or English fallback', fallbackText.includes('分析') && defaultText.includes('Analysis'));
captureLocaleEffect = false;

const contextSnapshot = {
  sessionId: 'session-fixture', asOfSeq: 12,
  composition: {
    source: 'dsh-context', estimatedTotal: 1000,
    categories: [{ key: 'inject', value: 1000, share: 100 }],
    reportedInput: 1234, projectedInput: 1300, capacity: 2000, percent: 65,
  },
  turn: 2,
  structure: {
    system: { seq: 1, position: 1, role: 'system', part: 'system' },
    history: [
      { seq: 4, position: 2, role: 'developer', part: 'inject', turn: 1, toolChanges: [{ action: 'add', name: 'read' }] },
      { seq: 5, position: 3, role: 'user', part: 'inject', source: 'agent-instructions', turn: 1 },
      { seq: 6, position: 4, role: 'assistant', part: 'assistant', toolInputs: [{ name: 'read', callId: 'read-source' }], hasReasoning: true, turn: 2 },
      { seq: 8, position: 5, role: 'tool', part: 'tool', toolName: 'read', callId: 'read-source', turn: 2 },
    ],
    layers: [{ turn: 1, start: 0, count: 2 }, { turn: 2, start: 2, count: 2 }],
  },
  files: { messageCount: 5, groups: [{ kind: 'agents', part: 'inject', status: 'body', count: 1, items: [
    { path: '/repo/AGENTS.md', origin: 'instructions', scope: 'repo / AGENTS.md', seq: 5, logicalPosition: 3, locations: [3] },
  ] }, { kind: 'code', part: 'tool', status: 'body', count: 1, items: [
    { path: '/repo/source.js', origin: 'read', seq: 8, logicalPosition: 5, locations: [5] },
  ] }] },
  tools: { seq: 2, count: 2, items: [
    { name: 'read', position: 1, plugin: '@deepseek-ai/dsh-tool-fs', pluginBasis: 'dsh-tool-catalog', noticeSeq: 4, noticePosition: 2 },
    { name: 'trajectory_trace', position: 2, plugin: 'dsh-trajectory-tools', pluginBasis: 'plugin-tool-catalog' },
  ] },
};
const contextSeeds = {
  2: { session: contextSnapshot.sessionId, at: null, status: 'ready', snapshot: contextSnapshot },
  3: { session: contextSnapshot.sessionId, turns: [{ turn: 1, seq: 10 }] },
};
let sourceLocation;
const contextProps = { sessionId: contextSnapshot.sessionId, openView: (...args) => { sourceLocation = args; } };
const englishContext = render(CompositionPanel, contextProps, contextSeeds);
const englishContextText = textOf(englishContext).join(' ');
check('context: cut, logical positions and familiar content types replace the source estimate', [
  'Observed through #12', 'Turn 1 end · #10', 'System baseline', 'Runtime injections',
  'Tool inputs & outputs', 'Model reasoning', 'Browse context contents',
].every(label => englishContextText.includes(label)) && !englishContextText.includes('Source estimate'));
const renderContext = seeds => render(renderedComponents.get('ContextPositions'), { snapshot: contextSnapshot, openView: contextProps.openView }, seeds);
const definitionsText = textOf(renderContext({ 0: { definition: 'read' }, 1: 'definitions' })).join(' ');
const pluginDefinitionText = textOf(renderContext({ 0: { definition: 'trajectory_trace' }, 1: 'definitions' })).join(' ');
check('context: definitions separate package sources and point to the addition in history', [
  'Request header #2', 'Official DSH package', '@deepseek-ai/dsh-tool-fs', 'Plugin source', 'dsh-trajectory-tools',
  'Matched to official definition', 'Locate addition in history · Message 2',
].every(label => definitionsText.includes(label)) && pluginDefinitionText.includes('Matched to plugin definition'));
const focused = renderContext({ 0: { seq: 8 }, 1: 'io' });
all(focused).find(node => node.type === 'button' && node.props.children === 'Open tool record')?.props.onClick();
check('context: tool output links to its retained input and opens its trajectory', JSON.stringify(sourceLocation) === '["trajectory","read-source"]' &&
  textOf(focused).join(' ').includes('Locate input · Message 4'));
const rows = all(focused).filter(node => node.props?.['data-layer-start'] != null);
check('context: assembly keeps layer order and connects the selected message', rows.map(node => node.props['data-layer-start']).join(',') === '2,4' &&
  all(focused).some(node => node.props?.className === 'cc-assembly-connector') &&
  all(focused).some(node => node.props?.['data-position'] === 5 && node.props?.['aria-pressed'] === true));
sandbox.window.document.documentElement.lang = 'zh';
const chineseContextText = textOf(render(CompositionPanel, contextProps, contextSeeds)).join(' ');
check('context: localizes panel and leaves recorded paths and source names intact', [
  '当前上下文构成', '上下文位置图', '浏览上下文内容', '系统提示词', '模型思考',
].every(label => chineseContextText.includes(label)));
const fileContext = renderContext({ 0: { seq: 5, material: '/repo/AGENTS.md' }, 1: 'files' });
check('context: the files tab retains path, evidence and placement', [
  '/repo/AGENTS.md', '指令注入', '作用域 repo / AGENTS.md', '消息 3',
].every(label => textOf(fileContext).join(' ').includes(label)));

for (const line of results) console.log(line);
console.log(failed === 0 ? "\nALL PASS (" + results.length + " checks)" : "\n" + failed + " FAILED");
process.exit(failed === 0 ? 0 : 1);
