import {ui as __ttUi} from "./ui-locale.js";
import { CONTEXT_CATEGORIES } from './categories.mjs';
import { tileLayout } from './treemap.js';
import {ui} from './ui-locale.js';

export { CONTEXT_CATEGORIES };
export function currentContextScene(items, width = 440, height = 380) {
  const W = 1000, H = Math.max(480, Math.min(1800, W * height / Math.max(280, width)));
  const categories = new Map(), palette = new Map(CONTEXT_CATEGORIES.map(row => [row.key, row]));
  for (const item of items) {
    if (!(item.tokens > 0) || !palette.has(item.category)) continue;
    if (!categories.has(item.category)) categories.set(item.category, { id: item.category, weight: 0, items: [] });
    const group = categories.get(item.category); group.weight += item.tokens; group.items.push(item);
  }
  const scale = Math.min((width - 4) / W, (height - 4) / H), gap = 2 / scale;
  const ordered = [...categories.values()].sort((a, b) => b.weight - a.weight);
  return { width: W, height: H, groups: tileLayout(ordered, W, H).map(group => {
    const category = palette.get(group.id), id = 'category-' + group.id;
    const w = Math.max(.01, group.w - Math.min(gap, group.w * .08)), h = Math.max(.01, group.h - Math.min(gap, group.h * .08));
    const headerHeight = Math.min(22 / scale, h * .22), bodyHeight = h - headerHeight;
    const paint = { category: group.id, fill: `color-mix(in srgb,${category.color} 34%,var(--tt-surface))`, stroke: category.color, ink: 'var(--tt-ink)' };
    const cells = [{ ...paint, id, aggregate: true, x: 0, y: headerHeight, w, h: bodyHeight,
      name: ui(category.label), tokens: group.weight, weight: group.weight, itemCount: group.items.length,
      secondary: group.items.length + __ttUi(' 段 · ') + Math.round(group.weight).toLocaleString() + ' tokens', preview: '' }];
    for (const item of tileLayout(group.items.map(item => ({ ...item, weight: item.tokens })), w, bodyHeight)) {
      cells.push({ ...item, ...paint, parentId: id, y: headerHeight + item.y,
        w: Math.max(.001, item.w - Math.min(.6, item.w * .06)), h: Math.max(.001, item.h - Math.min(.6, item.h * .06)),
        secondary: '#' + item.seq + ' · ' + Math.round(item.tokens).toLocaleString() + ' tokens' });
    }
    return { id: group.id, x: group.x, y: group.y, w, h, cells, frame: false,
      header: { id, label: ui(category.key==='assistant'?__ttUi('模型输出'):category.label), color: category.color, height: headerHeight, count: group.items.length } };
  }) };
}
