// 圈复杂度口径的固定样本：每类判定各写一处，用来核对复算结果与引擎一致。
// 期望值记在 test/complexity/engine-baseline.json，由引擎的 ts-metrics 生成。

export function straightLine(value) {
  return value + 1;
}

export function branches(value) {
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'zero';
}

export function loops(items) {
  let total = 0;
  for (const item of items) total += item;
  while (total > 100) total -= 100;
  do { total += 1; } while (total < 0);
  for (let index = 0; index < 3; index += 1) total += index;
  return total;
}

export function guards(input) {
  try {
    return input?.value ?? input?.();
  } catch {
    return null;
  }
}

export function logic(a, b) {
  const both = a && b;
  const either = a || b;
  const fallback = a ?? b;
  return both && either ? fallback : null;
}

export function defaults(a = 1, { b = 2, c } = {}) {
  return a + b + (c ?? 0);
}

export function outer(value) {
  const inner = (x) => (x > 0 ? x : -x);
  const apply = (x) => x ?? 0;
  return inner(value) + apply(value);
}

export function choose(kind) {
  switch (kind) {
    case 'a':
      return 1;
    case 'b':
      return 2;
    default:
      return 0;
  }
}
