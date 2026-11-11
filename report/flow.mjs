import { ui } from '../lib/i18n.mjs';

// Report authors state the relationships and cite their evidence. Layout never
// turns record order, matching labels or similar errors into a graph edge.
export function flowGraph(data, spec) {
  if (Object.keys(spec).some(key => !['id','type','data','nodes','edges','title','subtitle','note','readout','select','orientation'].includes(key))) throw Error('Flow accepts nodes and edges, not numeric chart options');
  if (spec.orientation != null && !['horizontal', 'vertical'].includes(spec.orientation)) throw Error('Flow orientation must be horizontal or vertical');
  if (!Array.isArray(spec.nodes) || spec.nodes.length < 2 || spec.nodes.length > 18) throw Error('Flow needs 2..18 evidence-bound nodes');
  if (!Array.isArray(spec.edges) || !spec.edges.length || spec.edges.length > 28) throw Error('Flow needs 1..28 explicit relationships');
  const rows = new Map(data.rows.map(row => [row.id, row])), nodes = new Map();
  const text = (value, size) => typeof value === 'string' && value.trim().length > 0 && value.length <= size;
  for (const [index, node] of spec.nodes.entries()) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw Error('Flow node must be an object');
    if (Object.keys(node).some(key => !['id', 'row', 'label', 'detail', 'kind', 'outcome', 'basis'].includes(key))) throw Error('Unknown flow node option');
    if (typeof node.id !== 'string' || !/^[A-Za-z][\w-]{0,47}$/.test(node.id) || nodes.has(node.id)) throw Error('Flow node IDs must be distinct short identifiers');
    if (!text(node.label, 120) || node.detail != null && !text(node.detail, 240)) throw Error('Flow nodes need a concise label and optional detail');
    if (node.kind != null && !['action', 'decision', 'result'].includes(node.kind)) throw Error('Flow kind must be action, decision or result');
    if (node.outcome != null && !['error', 'returned', 'unknown'].includes(node.outcome)) throw Error('Flow outcome must be error, returned or unknown');
    if (node.basis != null && !['recorded', 'analysis'].includes(node.basis)) throw Error('Flow basis must be recorded or analysis');
    if (node.basis === 'analysis' && node.outcome != null) throw Error('An analysis conclusion is not a recorded execution outcome');
    const row = rows.get(node.row);
    if (!row?.evidence?.length) throw Error('Flow node must reference a row with recorded evidence: ' + node.row);
    nodes.set(node.id, { ...node, kind: node.kind || 'action', basis: node.basis || 'recorded', row, index, incoming: [], outgoing: [], rank: 0 });
  }
  const pairs = new Set();
  const edges = spec.edges.map((edge, index) => {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) throw Error('Flow relationship must be an object');
    if (Object.keys(edge).some(key => !['from', 'to', 'label', 'evidence', 'kind'].includes(key))) throw Error('Unknown flow relationship option');
    if (edge.kind != null && !['sequence', 'dependency', 'propagation', 'recovery', 'alternative'].includes(edge.kind)) throw Error('Unknown flow relationship kind');
    if (!nodes.has(edge.from) || !nodes.has(edge.to) || edge.from === edge.to) throw Error('Flow relationship requires two different existing nodes');
    const pair = edge.from + ':' + edge.to;
    if (pairs.has(pair)) throw Error('Duplicate flow relationship');
    pairs.add(pair);
    if (!text(edge.label, 64)) throw Error('Label each flow relationship');
    if (!Array.isArray(edge.evidence) || !edge.evidence.length || edge.evidence.length > 6 || new Set(edge.evidence).size !== edge.evidence.length
        || edge.evidence.some(id => !rows.get(id)?.evidence?.length)) throw Error('Flow relationships require 1..6 distinct evidence rows');
    const value = { ...edge, kind: edge.kind || 'relation', index, rows: edge.evidence.map(id => rows.get(id)) };
    nodes.get(edge.from).outgoing.push(value);
    nodes.get(edge.to).incoming.push(value);
    return value;
  });
  const roots = [...nodes.values()].filter(node => !node.incoming.length), pending = [...roots];
  const degrees = new Map([...nodes].map(([id, node]) => [id, node.incoming.length])), order = [];
  while (pending.length) {
    pending.sort((a, b) => a.index - b.index);
    const node = pending.shift(); order.push(node);
    for (const edge of node.outgoing) {
      const target = nodes.get(edge.to);
      target.rank = Math.max(target.rank, node.rank + 1);
      degrees.set(target.id, degrees.get(target.id) - 1);
      if (!degrees.get(target.id)) pending.push(target);
    }
  }
  if (order.length !== nodes.size) throw Error('Unroll recorded attempts instead of drawing a cycle');
  const reached = new Set(), connected = [order[0]];
  while (connected.length) {
    const node = connected.pop();
    if (reached.has(node.id)) continue;
    reached.add(node.id);
    connected.push(...[...node.incoming, ...node.outgoing].map(edge => nodes.get(edge.from === node.id ? edge.to : edge.from)));
  }
  if (reached.size !== nodes.size) throw Error('Choose one connected process per flow figure');
  return { nodes: order, byId: nodes, edges, orientation: spec.orientation };
}

const flowEsc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const flowWidth = text => [...text].reduce((total, char) => total + (/[^\x00-\xff]/.test(char) ? 1 : /[ilI.,'`| ]/.test(char) ? .28 : /[MW@]/.test(char) ? .85 : .55), 0);
function flowLines(value, width, limit) {
  const lines = []; let line = '';
  for (const word of String(value ?? '').match(/[^\s/\\-]+[\s/\\-]?|[\s/\\-]/g) || []) {
    if (line && flowWidth(line + word) > width) { lines.push(line.trim()); line = ''; }
    for (const char of word) {
      if (line && flowWidth(line + char) > width) { lines.push(line.trim()); line = ''; }
      line += char;
    }
  }
  if (line.trim()) lines.push(line.trim());
  if (lines.length > limit) return [...lines.slice(0, limit - 1), lines[limit - 1].replace(/[\s.,;:/\\-]+$/, '') + '…'];
  return lines;
}

const flowOutcomeLabels = { error: '调用报错', returned: '返回未报错', unknown: '结果未知', analysis: '分析结论' };
const flowRelationLabels = { sequence: '执行先后', dependency: '依赖关系', propagation: '错误传播', recovery: '恢复处理', alternative: '替代路径' };
const flowOverlap = (a, b, pad = 0) => a.x < b.x + b.width + pad && a.x + a.width + pad > b.x && a.y < b.y + b.height + pad && a.y + a.height + pad > b.y;
const flowCenter = (node, vertical) => vertical ? node.x + node.width / 2 : node.y + node.height / 2;
const flowPoint = (main, cross, vertical) => vertical ? { x: cross, y: main } : { x: main, y: cross };
function flowCleanPoints(points) {
  const clean = [];
  for (const point of points) {
    if (clean.length && point.x === clean.at(-1).x && point.y === clean.at(-1).y) continue;
    while (clean.length > 1 && (clean.at(-2).x === clean.at(-1).x && clean.at(-1).x === point.x || clean.at(-2).y === clean.at(-1).y && clean.at(-1).y === point.y)) clean.pop();
    clean.push(point);
  }
  return clean;
}

function flowPath(points) {
  const clean = points.filter((point, index) => !index || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
  let path = 'M' + clean[0].x + ' ' + clean[0].y;
  for (let index = 1; index < clean.length - 1; index++) {
    const before = clean[index - 1], point = clean[index], after = clean[index + 1];
    const incoming = Math.hypot(point.x - before.x, point.y - before.y), outgoing = Math.hypot(after.x - point.x, after.y - point.y);
    const radius = Math.min(6, incoming / 2, outgoing / 2);
    path += 'L' + (point.x + (before.x - point.x) * radius / incoming) + ' ' + (point.y + (before.y - point.y) * radius / incoming)
      + 'Q' + point.x + ' ' + point.y + ' ' + (point.x + (after.x - point.x) * radius / outgoing) + ' ' + (point.y + (after.y - point.y) * radius / outgoing);
  }
  return path + 'L' + clean.at(-1).x + ' ' + clean.at(-1).y;
}

function flowCandidate(graph, orientation, gapExtra = 0) {
  const vertical = orientation === 'vertical', nodes = graph.nodes.map(node => {
    const decision = node.kind === 'decision', status = node.basis === 'analysis' ? 'analysis' : node.outcome;
    const titleLines = flowLines(node.label, decision ? 8.5 : 12.7, 3), detailLines = decision ? [] : flowLines(node.detail, 15.2, 3);
    return { ...node, titleLines, detailLines, status, width: decision ? 200 : 192,
      height: decision ? 166 : 50 + titleLines.length * 18 + (detailLines.length ? 8 + detailLines.length * 15 : 0) + (status ? 22 : 0) };
  });
  const byId = new Map(nodes.map(node => [node.id, node]));
  const ranks = Array.from({ length: Math.max(...nodes.map(node => node.rank)) + 1 }, () => []), paths = new Map();
  nodes.forEach(node => ranks[node.rank].push(node));
  // A long relationship reserves a lane through intermediate ranks. It does not
  // become a new authored node, nor take the old detour above the whole figure.
  for (const edge of graph.edges) {
    const from = byId.get(edge.from), to = byId.get(edge.to), chain = [from];
    for (let rank = from.rank + 1; rank < to.rank; rank++) {
      const dummy = { id: '@' + edge.index + ':' + rank, rank, index: graph.nodes.length + edge.index, width: vertical ? 16 : 0, height: vertical ? 0 : 16, dummy: true };
      ranks[rank].push(dummy); chain.push(dummy);
    }
    chain.push(to); paths.set(edge.index, chain);
  }
  const size = node => vertical ? node.width : node.height, crossGap = vertical ? 64 : 34;
  const breadth = Math.max(...ranks.map(rank => rank.reduce((sum, node) => sum + size(node), 0) + crossGap * (rank.length - 1)));
  const place = (rank, target) => {
    rank.sort((a, b) => target(a) - target(b) || a.index - b.index);
    let cursor = 0;
    for (const node of rank) { node.cross = Math.max(cursor, Math.min(breadth - size(node), target(node) - size(node) / 2)); cursor = node.cross + size(node) + crossGap; }
    const over = rank.at(-1).cross + size(rank.at(-1)) - breadth;
    if (over > 0) {
      rank.at(-1).cross -= over;
      for (let index = rank.length - 2; index >= 0; index--) rank[index].cross = Math.min(rank[index].cross, rank[index + 1].cross - crossGap - size(rank[index]));
    }
  };
  ranks.forEach(rank => {
    const targets = new Map(rank.map((node, index) => [node.id, breadth * (index + .5) / rank.length]));
    place(rank, node => targets.get(node.id));
  });
  const predecessors = new Map(), successors = new Map();
  for (const chain of paths.values()) for (let index = 1; index < chain.length; index++) {
    const from = chain[index - 1], to = chain[index];
    predecessors.set(to.id, [...predecessors.get(to.id) || [], from]);
    successors.set(from.id, [...successors.get(from.id) || [], to]);
  }
  const target = (node, neighbors) => {
    const list = neighbors.get(node.id);
    return list?.length ? list.reduce((sum, neighbor) => sum + neighbor.cross + size(neighbor) / 2, 0) / list.length : node.cross + size(node) / 2;
  };
  for (let pass = 0; pass < 4; pass++) {
    for (const rank of ranks) place(rank, node => target(node, predecessors));
    for (const rank of [...ranks].reverse()) place(rank, node => target(node, successors));
  }
  const rankSizes = ranks.map(rank => Math.max(...rank.map(node => vertical ? node.height : node.width)));
  const mainGap = (vertical ? 70 : 110) + gapExtra, rankStarts = [];
  let cursor = 0;
  for (const [index, rank] of ranks.entries()) {
    rankStarts.push(cursor);
    for (const node of rank) {
      const main = cursor + (rankSizes[index] - (vertical ? node.height : node.width)) / 2;
      Object.assign(node, flowPoint(main, node.cross, vertical));
    }
    cursor += rankSizes[index] + mainGap;
  }
  const port = (node, edge, outgoing) => {
    if (node.dummy) return flowPoint((vertical ? node.y : node.x), flowCenter(node, vertical), vertical);
    const edges = outgoing ? node.outgoing : node.incoming;
    const ordered = [...edges].sort((a, b) => {
      const aChain = paths.get(a.index), bChain = paths.get(b.index);
      return flowCenter(aChain[outgoing ? 1 : aChain.length - 2], vertical) - flowCenter(bChain[outgoing ? 1 : bChain.length - 2], vertical) || a.index - b.index;
    });
    const cross = flowCenter(node, vertical) + (node.kind === 'decision' ? 0 : (ordered.indexOf(edge) - (ordered.length - 1) / 2) * Math.min(20, size(node) / (ordered.length + 1)));
    const main = (vertical ? node.y : node.x) + (outgoing ? vertical ? node.height : node.width : 0);
    return flowPoint(main, cross, vertical);
  };
  const links = graph.edges.map(edge => {
    const chain = paths.get(edge.index), route = [];
    for (let index = 1; index < chain.length; index++) {
      const from = chain[index - 1], to = chain[index], start = port(from, edge, true), end = port(to, edge, false);
      const middle = (rankStarts[from.rank] + rankSizes[from.rank] + rankStarts[to.rank]) / 2;
      if (!route.length) route.push(start);
      route.push(flowPoint(middle, vertical ? start.x : start.y, vertical), flowPoint(middle, vertical ? end.x : end.y, vertical), end);
    }
    const points = flowCleanPoints(route);
    const labelLines = flowLines(edge.label, 11.5, 2), labelWidth = Math.max(...labelLines.map(line => flowWidth(line))) * 10 + 14, labelHeight = labelLines.length * 13 + 6;
    return { ...edge, points, start: points[0], end: points.at(-1), labelLines, labelWidth, labelHeight };
  });
  const occupied = nodes.map(node => ({ x: node.x, y: node.y, width: node.width, height: node.height }));
  let collisions = 0;
  // Choose labels from actual route segments and avoid node and earlier-label
  // bounds. Dense graphs receive more rank spacing before orientation is chosen.
  for (const edge of [...links].sort((a, b) => b.labelWidth - a.labelWidth || a.index - b.index)) {
    const candidates = [];
    for (let index = 1; index < edge.points.length; index++) {
      const a = edge.points[index - 1], b = edge.points[index];
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 18) continue;
      for (const fraction of [.5, .3, .7]) {
        const x = a.x + (b.x - a.x) * fraction, y = a.y + (b.y - a.y) * fraction;
        if (a.y === b.y) for (const side of [-1, 1]) candidates.push({ x: x - edge.labelWidth / 2, y: y + (side < 0 ? -edge.labelHeight - 6 : 6), width: edge.labelWidth, height: edge.labelHeight });
        else {
          for (const side of [1, -1]) candidates.push({ x: x + (side < 0 ? -edge.labelWidth - 9 : 9), y: y - edge.labelHeight / 2, width: edge.labelWidth, height: edge.labelHeight });
          if (Math.abs(a.y - b.y) >= edge.labelHeight + 12) candidates.push({ x: x - edge.labelWidth / 2, y: y - edge.labelHeight / 2, width: edge.labelWidth, height: edge.labelHeight });
        }
      }
    }
    // A small stair between aligned cards still has one full rank gap. Its
    // caption can span that gap instead of being limited to either half-run.
    if (!vertical) {
      const x = (edge.start.x + edge.end.x - edge.labelWidth) / 2;
      for (const y of [Math.min(edge.start.y, edge.end.y) - edge.labelHeight - 6, Math.max(edge.start.y, edge.end.y) + 6]) candidates.push({ x, y, width: edge.labelWidth, height: edge.labelHeight });
    }
    const score = box => occupied.filter(other => flowOverlap(box, other, 5)).length * 10000 + Math.max(0, -box.x) + Math.max(0, -box.y);
    candidates.sort((a, b) => score(a) - score(b));
    edge.labelBox = candidates[0];
    collisions += occupied.filter(other => flowOverlap(edge.labelBox, other, 5)).length;
    occupied.push(edge.labelBox);
  }
  const minX = Math.min(0, ...occupied.map(box => box.x)), minY = Math.min(0, ...occupied.map(box => box.y)), dx = 18 - minX, dy = 18 - minY;
  const width = Math.ceil(Math.max(...occupied.map(box => box.x + box.width)) + dx + 18), height = Math.ceil(Math.max(...occupied.map(box => box.y + box.height)) + dy + 18);
  for (const node of nodes) { node.x += dx; node.y += dy; }
  for (const edge of links) {
    edge.points = edge.points.map(point => ({ x: point.x + dx, y: point.y + dy }));
    edge.start = edge.points[0]; edge.end = edge.points.at(-1); edge.path = flowPath(edge.points);
    edge.labelBox = { ...edge.labelBox, x: edge.labelBox.x + dx, y: edge.labelBox.y + dy };
    edge.labelX = edge.labelBox.x + edge.labelWidth / 2; edge.labelY = edge.labelBox.y + 12;
  }
  return { width, height, nodes, links, orientation, collisions };
}

export function layoutFlowGraph(graph) {
  const candidates = [];
  for (const orientation of graph.orientation ? [graph.orientation] : ['horizontal', 'vertical']) {
    for (const extra of [0, 28, 56]) {
      const candidate = flowCandidate(graph, orientation, extra); candidates.push(candidate);
      if (!candidate.collisions) break;
    }
  }
  const singleColumn = new Set(graph.nodes.map(node => node.rank)).size === graph.nodes.length;
  const score = layout => layout.collisions * 1000 + (layout.width / 980) ** 2 + (layout.height / 680) ** 2 + layout.width * layout.height / (980 * 680) * .25
    + (singleColumn && layout.orientation === 'vertical' ? .7 : 0);
  return candidates.sort((a, b) => score(a) - score(b))[0];
}

export function renderFlow(data, spec) {
  const layout = layoutFlowGraph(flowGraph(data, spec));
  const ref = (row, full = false) => {
    const refs = [...new Set(row.evidence.map(value => '#' + value.seq))];
    return !full && refs.length > 3 ? refs[0] + ' … ' + refs.at(-1) : refs.join(' · ');
  };
  const lineText = (lines, x, y, className, anchor = 'start', lineHeight = 18) => '<text class="' + className + '" x="' + x + '" y="' + y + '" text-anchor="' + anchor + '">' +
    lines.map((line, index) => '<tspan x="' + x + '" dy="' + (index ? lineHeight : 0) + '">' + flowEsc(line) + '</tspan>').join('') + '</text>';
  const edges = layout.links.map(edge => {
    const relation = flowRelationLabels[edge.kind] ? ui(flowRelationLabels[edge.kind]) + ' · ' : '';
    const readout = relation + layout.nodes.find(node => node.id === edge.from).label + ' → ' + layout.nodes.find(node => node.id === edge.to).label + ' · ' + edge.label;
    const rows = edge.rows.map(row => row.id), end = edge.end;
    const arrow = layout.orientation === 'vertical' ? `M${end.x - 4} ${end.y - 6}L${end.x} ${end.y}L${end.x + 4} ${end.y - 6}` : `M${end.x - 6} ${end.y - 4}L${end.x} ${end.y}L${end.x - 6} ${end.y + 4}`;
    return '<g class="flow-link flow-link-' + edge.kind + '" data-flow-kind="' + edge.kind + '" data-flow-from="' + flowEsc(edge.from) + '" data-flow-to="' + flowEsc(edge.to) + '" tabindex="0" role="button"' +
      ' data-row="' + flowEsc(rows[0]) + '" data-related-rows="' + flowEsc(JSON.stringify(rows.slice(1))) + '" data-readout="' + flowEsc(readout) + '" aria-label="' + flowEsc(readout + ' · ' + ui('关系依据')) + '">' +
      '<title>' + flowEsc(readout) + '</title><path class="flow-link-hit" d="' + edge.path + '"/><path class="flow-link-line" d="' + edge.path + '"/><path class="flow-arrow" d="' + arrow + '"/>' +
      '<rect class="flow-link-label-bg" x="' + edge.labelBox.x + '" y="' + edge.labelBox.y + '" width="' + edge.labelWidth + '" height="' + edge.labelHeight + '" rx="3"/>' +
      lineText(edge.labelLines, edge.labelX, edge.labelY, 'flow-link-label', 'middle', 13) + '</g>';
  }).join('');
  const nodes = layout.nodes.map(node => {
    const decision = node.kind === 'decision', center = node.width / 2, labelX = decision ? center : 15, anchor = decision ? 'middle' : 'start';
    const headerY = decision ? 40 : 22, titleY = decision ? node.height / 2 - (node.titleLines.length - 1) * 9 + (node.status ? -3 : 5) : 47;
    const shape = decision ? '<path class="flow-node-shape" d="M' + center + ' 1L' + (node.width - 1) + ' ' + node.height / 2 + 'L' + center + ' ' + (node.height - 1) + 'L1 ' + node.height / 2 + 'Z"/>'
      : '<rect class="flow-node-shape" x="1" y="1" width="' + (node.width - 2) + '" height="' + (node.height - 2) + '" rx="' + (node.kind === 'result' ? 13 : 7) + '"/>';
    const statusText = node.status ? ui(flowOutcomeLabels[node.status]) : '';
    const readout = (statusText ? statusText + ' · ' : '') + node.label + (node.detail ? ' · ' + node.detail : '') + ' · ' + ref(node.row, true);
    const statusY = decision ? node.height - 40 : node.height - 15, statusX = decision ? center - flowWidth(statusText) * 5 - 8 : 15;
    const icon = node.status === 'error' ? 'M-2 -2L2 2M2 -2L-2 2' : node.status === 'returned' ? 'M-3 0L-1 2L3 -2' : node.status === 'analysis' ? 'M0 -3L3 0L0 3L-3 0Z' : 'M-2 -1Q-2 -3 0 -3Q3 -3 2 0L0 1M0 3h.01';
    const status = node.status ? '<g class="flow-status" transform="translate(' + (statusX + 4) + ' ' + (statusY - 3) + ')">' + (node.status === 'analysis' ? '' : '<circle r="5.5"/>') + '<path d="' + icon + '"/></g>' + lineText([statusText], statusX + 15, statusY, 'flow-node-status', 'start', 12) : '';
    return '<g class="flow-node flow-node-' + node.kind + (node.status ? ' flow-status-' + node.status : '') + '" data-flow-node="' + flowEsc(node.id) + '" data-flow-basis="' + node.basis + '"' + (node.outcome ? ' data-flow-outcome="' + node.outcome + '"' : '') +
      ' data-row="' + flowEsc(node.row.id) + '" data-readout="' + flowEsc(readout) + '" tabindex="0" role="button" aria-label="' + flowEsc(readout) + '" transform="translate(' + node.x + ' ' + node.y + ')"><title>' + flowEsc(readout) + '</title>' + shape +
      lineText([decision ? '#' + node.row.evidence[0].seq : ref(node.row)], labelX, headerY, 'flow-node-ref', anchor, 12) + lineText(node.titleLines, labelX, titleY, 'flow-node-title', anchor) +
      lineText(node.detailLines, labelX, titleY + node.titleLines.length * 18 + 6, 'flow-node-detail', anchor, 15) + status + '</g>';
  }).join('');
  const statuses = [...new Set(layout.nodes.map(node => node.status).filter(Boolean))], relations = [...new Set(layout.links.map(edge => edge.kind).filter(kind => flowRelationLabels[kind]))];
  const legend = statuses.map(status => '<span class="flow-legend-status flow-status-' + status + '"><i></i>' + flowEsc(ui(flowOutcomeLabels[status])) + '</span>')
    .concat(relations.map(kind => '<span class="flow-legend-link flow-link-' + kind + '"><svg viewBox="0 0 28 10" aria-hidden="true"><path class="flow-link-line" d="M1 5H26"/></svg>' + flowEsc(ui(flowRelationLabels[kind])) + '</span>')).join('');
  return '<div class="report-flow-scroll" tabindex="0" role="region" aria-label="' + flowEsc(spec.title || ui('流程图')) + '"><svg class="report-flow-svg" data-flow-orientation="' + layout.orientation + '" viewBox="0 0 ' + layout.width + ' ' + layout.height +
    '" style="--flow-width:' + layout.width + 'px" role="group" aria-label="' + flowEsc(spec.title || ui('流程图')) + '">' + edges + nodes + '</svg></div>' +
    (legend ? '<div class="flow-legend" aria-label="' + flowEsc(ui('记录状态与关系')) + '">' + legend + '</div>' : '') +
    '<p class="chart-caption flow-caption">' + flowEsc(ui('连线表示已核实的关系，不表示耗时或并行。')) + ' <span>' + flowEsc(ui('窄屏可在图内左右滑动。')) + '</span></p>';
}
