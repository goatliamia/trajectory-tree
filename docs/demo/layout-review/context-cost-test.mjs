// Price model checks: the DeepSeek table, Beijing peak windows, per-request reasons and
// the aggregate the Eval panel reads. Plain node: any failed assertion exits non-zero.
// Usage: node docs/demo/layout-review/context-cost-test.mjs
import assert from 'node:assert/strict';
import { DEEPSEEK_PRICES, isPeakTime, priceRequest, priceRequests } from './context-cost-model.mjs';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, actual + ' != ' + expected);
// 北京时间(UTC+8)的墙上时间 → 事件里的 epoch 毫秒。
const beijing = (year, month, day, hour, minute = 0) => Date.UTC(year, month, day, hour, minute) - 8 * 3600 * 1000;
const row = (over = {}) => ({
  provider: 'deepseek-account', model: 'deepseek-flash', time: beijing(2026, 0, 5, 22, 0),
  input: 0, cacheRead: 0, cacheWrite: 0, output: 0, unknown: false, ...over,
});

// 价目原样:元 / 百万 tokens,[空闲, 高峰]。
assert.deepEqual(DEEPSEEK_PRICES, {
  'deepseek-flash': { cacheHit: [0.02, 0.04], cacheMiss: [1, 2], output: [4, 8] },
  'deepseek-v4-pro': { cacheHit: [0.15, 0.3], cacheMiss: [4.5, 9], output: [13.5, 27] },
});

// 2026-01-05 是周一。窗口开始含、结束不含;周末整天算空闲。
for (const [label, time, expected] of [
  ['周一 08:59', beijing(2026, 0, 5, 8, 59), false],
  ['周一 09:00', beijing(2026, 0, 5, 9, 0), true],
  ['周一 11:59', beijing(2026, 0, 5, 11, 59), true],
  ['周一 12:00', beijing(2026, 0, 5, 12, 0), false],
  ['周一 13:59', beijing(2026, 0, 5, 13, 59), false],
  ['周一 14:00', beijing(2026, 0, 5, 14, 0), true],
  ['周一 17:59', beijing(2026, 0, 5, 17, 59), true],
  ['周一 18:00', beijing(2026, 0, 5, 18, 0), false],
  ['周五 17:59', beijing(2026, 0, 9, 17, 59), true],
  ['周五 18:00', beijing(2026, 0, 9, 18, 0), false],
  ['周六 10:00', beijing(2026, 0, 10, 10, 0), false],
  ['周日 15:00', beijing(2026, 0, 11, 15, 0), false],
]) assert.equal(isPeakTime(time), expected, label);
assert.equal(isPeakTime(null), false);
assert.equal(isPeakTime(undefined), false);
assert.equal(isPeakTime('2026-01-05T09:00:00+08:00'), false);

// 单请求:空闲与高峰各一份价,字段齐全。
assert.deepEqual(priceRequest(row({ input: 1e6, cacheRead: 1e6, output: 1e6 })), {
  priced: true, reason: null, peak: false,
  cost: { miss: 1, hit: 0.02, output: 4 },
  tokens: { miss: 1e6, hit: 1e6, output: 1e6 },
});
assert.deepEqual(priceRequest(row({ time: beijing(2026, 0, 5, 10, 0), input: 1e6, cacheRead: 1e6, output: 1e6 })).cost,
  { miss: 2, hit: 0.04, output: 8 });
assert.deepEqual(priceRequest(row({ model: 'deepseek-v4-pro', input: 1e6, cacheRead: 1e6, output: 1e6 })).cost,
  { miss: 4.5, hit: 0.15, output: 13.5 });
assert.deepEqual(priceRequest(row({ model: 'deepseek-v4-pro', time: beijing(2026, 0, 6, 15, 0), input: 1e6, cacheRead: 1e6, output: 1e6 })).cost,
  { miss: 9, hit: 0.3, output: 27 });

// 逐条原因:null = 已计价;缺 usage / 非官方 provider / 未知模型各一种。
assert.equal(priceRequest(row()).reason, null);
assert.equal(priceRequest(row({ unknown: true })).reason, 'unknown-usage');
assert.equal(priceRequest(row({ provider: 'openai', model: 'gpt-5' })).reason, 'provider');
assert.equal(priceRequest(row({ provider: null })).reason, 'provider');
assert.equal(priceRequest({}).reason, 'provider');
assert.equal(priceRequest(row({ model: 'deepseek-reasoner' })).reason, 'model');
assert.equal(priceRequest(row({ model: null })).reason, 'model');
assert.equal(priceRequest(row({ provider: 'openai', model: 'deepseek-flash' })).reason, 'provider');
assert.equal(priceRequest(row({ provider: 'openai', unknown: true })).reason, 'unknown-usage');
// 旧汇总按前缀认官方 provider;这条行为不变。
assert.equal(priceRequest(row({ provider: 'deepseek' })).priced, true);

// 未计价的请求不猜价,也不猜峰谷。
assert.deepEqual(priceRequest(row({ provider: 'openai', input: 1e6, output: 1e6 })), {
  priced: false, reason: 'provider', peak: false,
  cost: { miss: 0, hit: 0, output: 0 },
  tokens: { miss: 0, hit: 0, output: 0 },
});
assert.deepEqual(priceRequest(row({ unknown: true, input: null, cacheRead: null, cacheWrite: null, output: null })),
  { priced: false, reason: 'unknown-usage', peak: false, cost: { miss: 0, hit: 0, output: 0 }, tokens: { miss: 0, hit: 0, output: 0 } });

// 零 token 仍是"已计价请求":算一条,金额为 0,均价没有分母。
const zero = priceRequest(row());
assert.deepEqual([zero.priced, zero.reason, zero.peak], [true, null, false]);
assert.deepEqual(zero.cost, { miss: 0, hit: 0, output: 0 });
assert.deepEqual(zero.tokens, { miss: 0, hit: 0, output: 0 });
assert.equal(priceRequest(row({ time: beijing(2026, 0, 5, 10, 0) })).peak, true);

// cacheWrite 不计价,也不进 tokens。
const written = priceRequest(row({ cacheWrite: 5e6 }));
assert.deepEqual(written.cost, { miss: 0, hit: 0, output: 0 });
assert.deepEqual(written.tokens, { miss: 0, hit: 0, output: 0 });
assert.deepEqual(Object.keys(written.tokens).sort(), ['hit', 'miss', 'output']);
assert.equal(priceRequest(row({ input: 1e6, cacheWrite: 9e6 })).cost.miss, 1);

// 汇总:两个有价的 flash(一空闲一高峰)+ 三种未计价,rates 只跟"有价模型"走。
const summary = priceRequests([
  row({ input: 1e6, cacheRead: 1e6, output: 1e6 }),
  row({ time: beijing(2026, 0, 5, 10, 0), input: 2e6, cacheRead: 1e6, output: 1e6 }),
  row({ provider: 'openai', model: 'gpt-5', input: 1e6, output: 1e6 }),
  row({ unknown: true, input: null, cacheRead: null, output: null }),
  row({ model: 'deepseek-reasoner', input: 1e6 }),
]);
assert.deepEqual(Object.keys(summary).sort(), ['cost', 'currency', 'models', 'peakRequests', 'perM', 'priced', 'rates', 'reasons', 'total', 'unpriced']);
assert.equal(summary.currency, 'CNY');
// models 保留官方 provider 上出现的模型名(含没价目的);rates 只在恰好一个有价模型时给出。
assert.deepEqual(summary.models, ['deepseek-flash', 'deepseek-reasoner']);
assert.equal(summary.rates, DEEPSEEK_PRICES['deepseek-flash']);
assert.equal(summary.priced, 2);
assert.equal(summary.unpriced, 3);
assert.equal(summary.peakRequests, 1);
assert.deepEqual(summary.reasons, { unknown: 1, provider: 1, model: 1 });
close(summary.cost.miss, 5);
close(summary.cost.hit, 0.06);
close(summary.cost.output, 12);
close(summary.total, 17.06);
close(summary.perM.miss, 5 / 3);
close(summary.perM.hit, 0.03);
close(summary.perM.output, 6);

// 两个有价模型 → rates 为 null,金额照加。
const twoModels = priceRequests([
  row({ input: 1e6, output: 1e6 }),
  row({ model: 'deepseek-v4-pro', input: 1e6, output: 1e6 }),
]);
assert.deepEqual(twoModels.models, ['deepseek-flash', 'deepseek-v4-pro']);
assert.equal(twoModels.rates, null);
assert.equal(twoModels.priced, 2);
assert.equal(twoModels.unpriced, 0);
assert.deepEqual(twoModels.reasons, { unknown: 0, provider: 0, model: 0 });
close(twoModels.total, 1 + 4 + 4.5 + 13.5);

// 空输入与"全是未计价"都保持零值,且不虚构均价。
const none = priceRequests([]);
assert.deepEqual([none.models, none.rates, none.priced, none.unpriced, none.peakRequests, none.total],
  [[], null, 0, 0, 0, 0]);
assert.deepEqual(none.cost, { miss: 0, hit: 0, output: 0 });
assert.deepEqual(none.perM, { miss: null, hit: null, output: null });
assert.deepEqual(none.reasons, { unknown: 0, provider: 0, model: 0 });
const unknownOnly = priceRequests([row({ unknown: true }), row({ provider: 'openai' })]);
assert.deepEqual(unknownOnly.models, []);
assert.equal(unknownOnly.rates, null);
assert.equal(unknownOnly.priced, 0);
assert.equal(unknownOnly.unpriced, 2);
assert.deepEqual(unknownOnly.reasons, { unknown: 1, provider: 1, model: 0 });

// 零 token 的汇总:一条已计价请求,金额 0,均价无分母。
const free = priceRequests([row({ cacheWrite: 5e6 })]);
assert.equal(free.priced, 1);
assert.equal(free.total, 0);
assert.deepEqual(free.perM, { miss: null, hit: null, output: null });

console.log('PASS DeepSeek price table, Beijing peak boundaries, per-request reasons, aggregate cost/rates/reasons');
