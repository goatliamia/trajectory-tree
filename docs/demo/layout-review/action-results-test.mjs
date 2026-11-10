import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function section(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'renderer test seams exist');
  return source.slice(a, b);
}

// Run the actual entry functions with instrumented rendering dependencies, not a page preview.
export function checkActionResults(source, label) {
  const overview = section(source, '  reviewBranches = function(', '  reviewOverviewSummary =');
  const action = section(source, '  const geistActionResultsBase = renderActionPath;', '  function geistUpdateStepTiming(');
  assert.doesNotMatch(action, /geistDrawResultBranches\(/, label + ': action entry must not draw result branches');
  const records = ['create_goal', 'update_goal', 'read', 'subagent', 'unknown_tool'].map((name, i) => ({
    id: String(i), turn: 1, step: i + 1, time: i * 100, calls: [{ name }], title: '协作返回',
  }));
  let draws = 0, resets = 0, timing = 0;
  const state = {
    geistOutcomes: records, geistOutcomeBranches: [], reviewBranchesNow: [], reviewStress: false,
    overviewLayers: new Set(['failures']), reviewBranches: null,
    reviewActiveTime: (_, time) => time,
    geistDrawResultBranches(items, base) {
      draws++;
      state.geistOutcomeBranches = items;
      return { html: 'overview-results', bottom: base + 42 };
    },
    renderActionPath() {
      assert.equal(state.geistOutcomeBranches.length, 0, 'clear overview result layout before action base runs');
      assert.equal(state.reviewBranchesNow.length, 0, 'child layout must not inherit overview obstacles');
      resets++;
      return 'action';
    },
    reviewActionFileFrame: { t: { number: 1, steps: [{ number: 1, start: 0, end: 100 }] }, x: i => 100 + i * 128, base: 208 },
    $: () => ({ querySelectorAll: () => [], insertAdjacentHTML: (_, html) => {
      assert.doesNotMatch(html, /geist-action-results|geist-result-branch|data-tool-result/);
    } }),
    geistTimingLayer: () => '', geistBindTiming() {}, geistUpdateStepTiming() { timing++; },
  };
  vm.createContext(state);
  vm.runInContext(overview + '\n' + action, state);
  for (const enabled of [true, false, true]) {
    enabled ? state.overviewLayers.add('failures') : state.overviewLayers.delete('failures');
    assert.equal(state.reviewBranches(t => t, 208, () => true, 0, 800, 800).html, 'overview-results');
    assert.equal(state.geistOutcomeBranches.length, records.length, 'overview keeps every result, including goals');
    const before = draws;
    for (let i = 0; i < 3; i++) assert.equal(state.renderActionPath(), 'action');
    assert.equal(draws, before, 'switching, redraws and the failures toggle never draw action result branches');
  }
  assert.equal(resets, 9);
  assert.equal(timing, 9, 'action timing remains active');
  state.reviewActionFileFrame = null;
  assert.equal(state.renderActionPath(), 'action', 'missing frame remains safe');
  console.log('PASS ' + label + ': overview results preserved; action results absent across toggles and redraws; stale layout cleared; timing retained');
}

checkActionResults(readFileSync(new URL('./geist-tools.js', import.meta.url), 'utf8'), 'source');
checkActionResults(readFileSync(new URL('../../../plugin/analysis-view/lib/trace/page.js', import.meta.url), 'utf8'), 'shipped renderer');
const base = readFileSync(new URL('./action-view.js', import.meta.url), 'utf8');
assert.doesNotMatch(base, /reviewBranches\(|geistDrawResultBranches\(/, 'action base has no result branch entry');
assert.match(base, /review-goal-icon/, 'goal node icon retained');
const actors = readFileSync(new URL('./geist-actors.js', import.meta.url), 'utf8');
assert.match(actors, /geistActorActionBase\(\.\.\.args\); geistRenderActors\(\)/, 'independent actor layer retained');
