import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../view/assets/claude-host.js', import.meta.url), 'utf8');
function host(locale, usage) {
  const elements = new Map();
  const make = tag => ({ tag, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, append() {}, remove() {}, querySelectorAll() { return []; } });
  const graph = make('div');
  graph.before = node => elements.set(node.id, node);
  elements.set('graph-scroll', graph);
  const context = { window: { __trajectoryLocale: locale }, document: { createElement: make, head: { append() {} } }, elements, usage };
  vm.createContext(context);
  vm.runInContext(`
    const $ = id => elements.get(id);
    const esc = value => String(value ?? '');
    let header = () => {}, showSource = () => {}, geistRenderContextOverview = () => {};
    let reviewOpenContext = () => {}, reviewOpenContextSources = () => {}, geistShowCurrentSource = () => {};
    let reviewOpenCompaction = () => {}, geistOpenTiming = () => {}, geistArrangeCaption = () => {};
    const session = { turns: [], totals: { turns: 0, steps: 0, calls: 0 } };
    const data = { evidence: {} }, reviewContextData = { usage }, geistStatsByStep = new Map();
    let drawer = null;
    const openDrawer = (...args) => { drawer = args; };
    ${code}
    globalThis.paint = geistRenderContextOverview;
    globalThis.openContext = reviewOpenContext;
    globalThis.getDrawer = () => drawer;
  `, context);
  return context;
}
const zh = host('zh', undefined);
zh.paint();
const region = zh.elements.get('geist-context-overview');
assert.ok(region);
assert.equal(region.tag, 'section');
assert.equal(region.className, 'geist-context-overview');
assert.match(region.innerHTML, /用量未记录/);
zh.paint();
assert.equal(zh.elements.get('geist-context-overview'), region);
zh.openContext(1);
assert.match(zh.getDrawer()[2], /用量未记录/);
const en = host('en', [{ turn: 1, usage: { input: 12, output: 3, cacheRead: null, cacheWrite: 4 } }]);
en.paint();
assert.match(en.elements.get('geist-context-overview').innerHTML, /Latest recorded usage: input 12/);
assert.match(en.elements.get('geist-context-overview').innerHTML, /Not recorded/);
en.openContext(1);
assert.match(en.getDrawer()[0], /Turn 1 · Claude usage/);
console.log('Claude host initial render and locale checks passed');
