// One DeepSeek price model for the Eval host and the trajectory page.
// Pure table + functions: no imports, no UI strings, so the demo builds can inline
// this module verbatim and the host can import the generated copy.

/**
 * DeepSeek 官方 API 价目(元 / 百万 tokens):[空闲时段, 高峰时段],见 api-docs.deepseek.com 的模型与价格页。
 * input(cache miss)用 cacheMiss,cacheRead(cache hit)用 cacheHit,output 用 output;cacheWrite 不计价。
 */
export const DEEPSEEK_PRICES = {
  'deepseek-flash': { cacheHit: [0.02, 0.04], cacheMiss: [1, 2], output: [4, 8] },
  'deepseek-v4-pro': { cacheHit: [0.15, 0.3], cacheMiss: [4.5, 9], output: [13.5, 27] },
};

/** 高峰是北京时间周一至周五 9:00–12:00、14:00–18:00;其余(含周末)按空闲时段算。 */
export function isPeakTime(time) {
  if (typeof time !== 'number') return false;
  const beijing = new Date(time + 8 * 3600 * 1000);
  const day = beijing.getUTCDay();
  const hour = beijing.getUTCHours();
  return day >= 1 && day <= 5 && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18));
}

const unpriced = reason => ({
  priced: false,
  reason,
  peak: false,
  cost: { miss: 0, hit: 0, output: 0 },
  tokens: { miss: 0, hit: 0, output: 0 },
});

/**
 * Price one request: input is the cache miss, cacheRead is the cache hit, output is the output.
 * Reasons are only set when the request is not priced: unknown-usage, provider, model.
 * peak is the billing slot, so it is unknown for an unpriced request.
 */
export function priceRequest(row) {
  const known = row !== null && row !== undefined;
  const provider = known && typeof row.provider === 'string' ? row.provider : null;
  const model = known && typeof row.model === 'string' ? row.model : null;
  if (known && row.unknown) return unpriced('unknown-usage');
  if (provider === null || !provider.startsWith('deepseek')) return unpriced('provider');
  const table = model === null ? undefined : DEEPSEEK_PRICES[model];
  if (table === undefined) return unpriced('model');
  const peak = isPeakTime(row.time);
  const slot = peak ? 1 : 0;
  const miss = row.input || 0;
  const hit = row.cacheRead || 0;
  const out = row.output || 0;
  return {
    priced: true,
    reason: null,
    peak,
    cost: {
      miss: (miss / 1e6) * table.cacheMiss[slot],
      hit: (hit / 1e6) * table.cacheHit[slot],
      output: (out / 1e6) * table.output[slot],
    },
    tokens: { miss, hit, output: out },
  };
}

/**
 * Aggregate priced and unpriced requests with the fields the Eval panel already reads.
 * models keeps every named model on an official provider (even without a price table);
 * rates is the single priced model's table when exactly one model was priced, else null.
 */
export function priceRequests(rows) {
  const models = new Set();
  const pricedModels = new Set();
  const reasons = { unknown: 0, provider: 0, model: 0 };
  const cost = { miss: 0, hit: 0, output: 0 };
  const tokens = { miss: 0, hit: 0, output: 0 };
  let priced = 0;
  let unpricedCount = 0;
  let peakRequests = 0;
  for (const row of rows || []) {
    const provider = row !== null && row !== undefined && typeof row.provider === 'string' ? row.provider : null;
    const model = row !== null && row !== undefined && typeof row.model === 'string' ? row.model : null;
    if (provider !== null && provider.startsWith('deepseek') && model !== null && !row.unknown) models.add(model);
    const price = priceRequest(row);
    if (!price.priced) {
      unpricedCount += 1;
      reasons[price.reason === 'unknown-usage' ? 'unknown' : price.reason] += 1;
      continue;
    }
    priced += 1;
    pricedModels.add(model);
    if (price.peak) peakRequests += 1;
    cost.miss += price.cost.miss;
    cost.hit += price.cost.hit;
    cost.output += price.cost.output;
    tokens.miss += price.tokens.miss;
    tokens.hit += price.tokens.hit;
    tokens.output += price.tokens.output;
  }
  const perM = (value, count) => (count === 0 ? null : (value / count) * 1e6);
  const pricedModelNames = [...pricedModels];
  return {
    currency: 'CNY',
    models: [...models],
    // 只有一个模型时给出它的价目([空闲, 高峰]),面板按"未命中 / 命中 / 输出 × 峰/谷"排成小表。
    rates: pricedModelNames.length === 1 ? DEEPSEEK_PRICES[pricedModelNames[0]] : null,
    priced,
    unpriced: unpricedCount,
    peakRequests,
    total: cost.miss + cost.hit + cost.output,
    cost,
    perM: { miss: perM(cost.miss, tokens.miss), hit: perM(cost.hit, tokens.hit), output: perM(cost.output, tokens.output) },
    reasons,
  };
}
