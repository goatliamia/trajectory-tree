import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Load the browser half the same way the DSH client does, then exercise the one
// slot action it contributes to the Chat turn tail. No real DOM and no network.
let factory;
const globalWindow = {
  __ModuleLoader__: { load(module) { factory = module.factory; } },
  document: { documentElement: { lang: 'zh-CN' } },
  navigator: { languages: ['zh-CN'] },
};
const sandbox = {
  window: globalWindow,
  document: globalWindow.document,
  navigator: globalWindow.navigator,
  localStorage: undefined,
  setTimeout, clearTimeout, console, URL, encodeURIComponent,
  AbortController,
};
vm.runInNewContext(readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8'), sandbox);

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: value => [value, () => {}],
  useEffect() {}, useLayoutEffect() {}, useCallback: fn => fn, useMemo: fn => fn(),
  useRef: () => ({ current: null }),
};
const plugin = factory(name => {
  if (name === 'react') return React;
  throw new Error('unexpected client dependency: ' + name);
});

const registrations = [];
const slots = {
  inject(key, callback) { return callback(); },
  register(spec, component) { registrations.push({ spec, component }); return () => {}; },
};
plugin.apply({
  effect() {}, get() { return undefined; }, inject() {},
  slots,
  commandUi: { register() {} },
  uiConversation: { views: { register() {} } },
  sessions: {},
});

const action = registrations.find(row => row.spec.name === 'conversation.chat.assistant-actions');
assert.ok(action, 'the Chat action slot receives one registration');
assert.equal(action.spec.id, 'analysis-trace-jump');
assert.equal(action.spec.order, 25, 'the entry sits after the context jump (20) and before the render entry (30)');

const snapshot = {
  order: ['tail'],
  nodes: {
    get: key => key === 'tail'
      ? { kind: 'turn-tail', data: { turn: 4, closing: { finalNode: { messageId: 'msg-1' } } } }
      : undefined,
  },
};
const useChat = selector => selector(snapshot);
// The outer action only guards hook availability; render the inner component it returns.
const render = props => {
  const outer = action.component(props);
  return outer && typeof outer.type === 'function' ? outer.type(outer.props) : outer;
};

// The action switches the conversation to the Trajectory Tree tab instead of opening a tab.
const clicked = [];
const tabs = {
  querySelectorAll: () => [
    { textContent: '对话', click: () => clicked.push('chat') },
    { textContent: '轨迹树', click: () => clicked.push('trace') },
  ],
};
globalWindow.document.querySelector = selector => selector === '[data-conversation-tabs]' ? tabs : null;
const opened = [];
globalWindow.open = (...args) => { opened.push(args); return null; };

const jump = render({ sessionId: 'session-abc', messageId: 'msg-1', useChat });
assert.equal(jump.type, 'a', 'the action is a plain link, not a scripted button');
assert.equal(jump.props.target, '_blank');
assert.equal(jump.props.rel, 'noopener noreferrer');
assert.equal(jump.props.href, '/analysis-view/trace?session=session-abc&turn=4&staged=1');
assert.ok(String(jump.props['aria-label']).length > 0, 'the link is named for assistive technology');

const event = { preventDefault() { this.prevented = true; } };
jump.props.onClick(event);
assert.equal(event.prevented, true, 'the primary click is handled in place');
assert.deepEqual(clicked, ['trace'], 'the Trajectory Tree tab is selected');
assert.equal(opened.length, 0, 'the in-place jump does not open a browser tab');

// When the tab cannot be found (e.g. collapsed into More), the link falls back to a new tab.
globalWindow.document.querySelector = () => null;
const fallback = render({ sessionId: 'session-abc', messageId: 'msg-1', useChat });
const fallbackEvent = { preventDefault() { this.prevented = true; } };
fallback.props.onClick(fallbackEvent);
assert.equal(opened.length, 1, 'a missing tab falls back to opening the deep link');
assert.equal(opened[0][0], '/analysis-view/trace?session=session-abc&turn=4&staged=1');

assert.equal(render({ sessionId: 'session-abc', messageId: 'other', useChat }), null,
  'an unknown message id hides the action instead of guessing a turn');
assert.equal(render({ sessionId: '', messageId: 'msg-1', useChat }), null);
assert.equal(render({ sessionId: 'session-abc', messageId: 'msg-1' }), null,
  'a runtime without useChat degrades to no action');
assert.equal(render({ sessionId: 'session-abc', messageId: 'msg-1',
  useChat: selector => selector({ order: [], nodes: { get: () => undefined } }) }), null,
  'a turn that is not loaded hides the action');

console.log('PASS chat turn action: in-place view switch, deep-link fallback and no-guess hiding');
