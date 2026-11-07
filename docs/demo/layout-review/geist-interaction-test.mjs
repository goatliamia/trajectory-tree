import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileObjects, fileIdentity, packFileObjects, fileTouchClusters } from './file-model.mjs';
import { ui } from '../../../lib/i18n.mjs';

function target() {
  const listeners = new Map();
  return { addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
    fire(type, props = {}) {
      const e = { button: 0, isPrimary: true, pointerId: 7, clientX: 450, clientY: 150,
        target: { closest: () => null }, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...props };
      for (const fn of listeners.get(type) || []) { fn(e); if (e.stopped) break; }
      return e;
    } };
}
const win = target(), doc = target(), vp = target(), classes = new Set(), captures = new Set();
let left = 400, now = 0, blocked = false;
Object.assign(vp, { clientWidth: 600, clientHeight: 400, scrollWidth: 2600,
  setAttribute() {},
  getBoundingClientRect: () => ({ left: 0, top: 0 }),
  classList: { add: x => classes.add(x), remove: x => classes.delete(x) },
  setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id),
});
Object.defineProperty(vp, 'scrollLeft', { get: () => left, set: value => { left = Math.max(0, Math.min(vp.scrollWidth - vp.clientWidth, value)); } });
const state = vm.createContext({ window: win, document: doc, overviewViewportBound: false, view: 'overview', overviewScale: 4, ui,
  reviewFileStatus() {}, reviewFileSelection: 'file-A', reviewClearFileSelection() { state.reviewFileSelection = null; },
  performance: { now: () => now }, requestAnimationFrame: fn => { fn(); return 0; }, setOverviewScale() {},
  $: id => id === 'graph-scroll' ? vp : id === 'canvas' ? { classList: { contains: () => blocked } } : null,
});
vm.runInContext(readFileSync(new URL('geist-navigation.js', import.meta.url), 'utf8') + '\nbindOverviewViewport();', state);
vm.runInContext(readFileSync(new URL('geist-selection.js', import.meta.url), 'utf8'), state);
for (const mode of ['overview', 'path']) {
  state.view = mode; left = 400; now += 1000;
  vp.fire('pointerdown'); win.fire('pointermove', { clientX: 447 });
  assert.equal(left, 400, 'small click movements do not pan');
  win.fire('pointerup'); assert.ok(!vp.fire('click').stopped, 'normal click remains available');
  vp.fire('pointerdown'); win.fire('pointermove', { clientX: 270 });
  assert.equal(left, 580, mode + ' follows a horizontal drag');
  assert.ok(captures.has(7)); assert.ok(classes.has('geist-dragging'));
  win.fire('pointerup'); assert.equal(captures.size, 0); assert.equal(classes.size, 0);
  assert.ok(vp.fire('click').stopped, 'release cannot open a step/file underneath the drag');
  now += 300; assert.ok(!vp.fire('click').stopped);
  vp.fire('pointerdown'); win.fire('pointermove', { clientX: 440, clientY: 220 });
  assert.equal(left, 580, 'vertical gesture is not converted to horizontal panning');
  win.fire('pointercancel');
  vp.fire('pointerdown'); win.fire('pointermove', { clientX: 250 }); win.fire('blur');
  assert.equal(captures.size, 0); assert.equal(classes.size, 0, 'losing focus clears drag state');
  blocked = true; const before = left; vp.fire('pointerdown'); win.fire('pointermove', { clientX: 50 });
  assert.equal(left, before, 'an open detail blocks panning'); blocked = false;
  const wheel = vp.fire('wheel', { shiftKey: true, deltaX: 0, deltaY: 60 });
  assert.equal(left, before + 60); assert.ok(wheel.prevented);
  assert.equal(state.reviewFileSelection, 'file-A', 'panning, clicks and cancellation never deselect the file');
}
vp.fire('pointerdown'); win.fire('pointermove', { clientX: 270 });
doc.fire('keydown', { key: 'Escape', pointerId: undefined });
win.fire('keydown', { key: 'Escape', pointerId: undefined });
assert.equal(state.reviewFileSelection, 'file-A', 'Escape during a pointer gesture only stops that gesture');
assert.equal(classes.size, 0);
blocked = true; doc.fire('keydown', { key: 'Escape' });
assert.equal(state.reviewFileSelection, 'file-A', 'Escape in a detail drawer does not deselect the file'); blocked = false;
doc.fire('keydown', { key: 'Escape', target: { closest: () => ({ tagName: 'INPUT' }) } });
assert.equal(state.reviewFileSelection, 'file-A', 'editing has priority over the file shortcut');
doc.fire('keydown', { key: 'Escape' });
assert.equal(state.reviewFileSelection, null, 'Escape on the idle canvas explicitly deselects');

const operations = Array.from({ length: 20 }, (_, i) => ({ seq: i + 1, turn: i + 1, step: i + 1, time: 100 + i * 120, path: '/source/file-' + i + '.ts', kind: i % 3 ? 'change' : 'read', status: 'returned' }));
const layout = operations.map(o => ({ x: o.time - 46, end: o.time + 74, turn: { number: o.turn, start: o.time - 46, end: o.time + 74 } }));
let packs = 0, touchPacks = 0, measurements = 0;
const fileState = vm.createContext({ data: { context: { fileOperations: operations } }, fileObjects, fileIdentity, ui,
  packFileObjects: (...args) => { packs++; return packFileObjects(...args); },
  fileTouchClusters: (...args) => { touchPacks++; return fileTouchClusters(...args); },
  endOf: t => t.end,
  overviewLayers: new Set(['files']), reviewContextData: { boundaries: [] }, reviewMeasure: s => s.length * 6,
  selectStep() {}, brText: () => '', brGroup: () => '', reviewStepContext: () => null,
  contextDisplaySide: () => ({ height: 0 }), reviewActionScale: () => ({}), requestAnimationFrame() {},
  layout, timeMap: time => time, t: { number: 1, steps: operations.map(o => ({ number: o.step })) }, x: i => 110 + i * 112,
});
vm.runInContext(readFileSync(new URL('file-layer.js', import.meta.url), 'utf8'), fileState);
const overview = viewportLeft => {
  fileState.viewportLeft = viewportLeft;
  return JSON.parse(vm.runInContext('reviewOverviewFiles(layout,timeMap,232,viewportLeft,viewportLeft+600,420); JSON.stringify({count:reviewFilesInScope.length,groups:reviewFileGroups.map(g=>({ids:g.members.map(m=>m.file.id).sort().join(","),left:g.left,right:g.right,label:g.label}))})', fileState));
};
const a = overview(54), firstPacks = packs;
fileState.layout = layout.map(row => ({ ...row }));
const b = overview(254);
assert.equal(a.count, 20); assert.equal(b.count, 20, 'panning cannot change file membership');
assert.equal(packs, firstPacks, 'panning with newly projected rows reuses the same lane packing');
const shared = a.groups.filter(p => b.groups.some(q => p.ids === q.ids));
assert.ok(shared.length > 0);
for (const p of shared) assert.deepEqual(b.groups.find(q => p.ids === q.ids), p, 'file coordinates and labels are fixed while panning');
assert.deepEqual(overview(54), a, 'returning to a position restores the same groups');
vm.runInContext("reviewFileSelection = '/source/file-2.ts';", fileState);
overview(54); overview(254);
assert.equal(touchPacks, 1, 'panning reuses the selected file touch clusters');
assert.equal(vm.runInContext('reviewFileTouchGroups[0].members[0].operation.seq', fileState), 3);
fileState.layout = layout.map(row => ({ ...row, x: row.x * 2, end: row.end * 2 }));
fileState.timeMap = time => time * 2;
assert.notDeepEqual(overview(54).groups, a.groups, 'zoom repacks at the new coordinates');
assert.equal(packs, firstPacks + 2);
assert.equal(touchPacks, 2, 'zoom projects the selected file touches again');
vm.runInContext("reviewFileOperations = [...reviewFileOperations, { ...reviewFileOperations[0], seq: 21, path: '/arrived.ts' }];", fileState);
assert.equal(overview(54).count, 21, 'a new file-operation snapshot refreshes the lane');
const beforePath = packs;
vm.runInContext('reviewActionFiles(t, x, 232, 54, 654); reviewActionFiles(t, x, 232, 154, 754);', fileState);
assert.equal(packs, beforePath + 2, 'panning a turn also reuses the packing from its full draw');

const dense = operations.flatMap((op, i) => Array.from({ length: 30 }, (_, j) => ({ file: { id: i + ':' + j }, x: 200 })));
const packed = packFileObjects(dense, {
  left: 54, right: 660, label: members => members.length + ' files',
  measure: text => { measurements++; return text.length * 6; },
});
assert.equal(packed[0].members.length, dense.length, 'the dense cluster preserves every file');
assert.ok(measurements <= dense.length * 2 - 1, 'merging a collision does not remeasure other groups');
console.log('PASS drag controls, stable file packing across pans, zoom and data invalidation, and bounded label measurement');
