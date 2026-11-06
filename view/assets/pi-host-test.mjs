import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./pi-host.js', import.meta.url), 'utf8');
let sourceButton;
const context = vm.createContext({
  data: { evidence: {} }, session: { totals: { turns: 1 }, turns: [{ number: 1, steps: [
    { number: 1, assistantDurationMs: null, calls: [{ seq: 1, start: 100, end: 100, durationMs: null, timingSource: 'unrecorded-start', status: 'returned' }] },
    { number: 2, assistantDurationMs: null, calls: [{ seq: 2, start: 100, end: 150, durationMs: 70, timingSource: 'pi-session-v3-capture', status: 'returned' }] },
    { number: 3, assistantDurationMs: null, calls: [{ seq: 3, start: 200, end: 200, durationMs: 70, timingSource: 'unrecorded-start', status: 'returned' }] },
  ] }] },
  header() {}, showSource() {}, geistRenderContextOverview() {}, geistShowCurrentSource() {}, reviewOpenContextSources() {}, reviewOpenContext() {}, reviewOpenCompaction() {}, geistArrangeCaption() {}, reviewOpenChange() {}, reviewRenderStepSummary() {}, geistOpenTiming() {}, toolTiming() {},
  geistStatsByStep: new Map(), document: { createElement: () => (sourceButton = {}) }, window: { __trajectoryLocale: 'en' },
});
vm.runInContext(source, context);
assert.equal(sourceButton.textContent, 'Pi data provenance ↗');
assert.equal(context.toolTiming(context.geistStatsByStep.get('1:1')).status, 'missing');
assert.equal(context.toolTiming(context.geistStatsByStep.get('1:2')).coverage, 50);
assert.equal(context.toolTiming(context.geistStatsByStep.get('1:3')).status, 'missing');
assert.equal(context.toolTiming(context.geistStatsByStep.get('1:3')).cumulative, 70);
console.log('Pi host timing semantics passed.');
