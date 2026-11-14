// Match the existing SVG's two-decimal geometry exactly. Remove only duplicate
// or collinear points in the same direction; keep corners and reversals.
export function compactTrendPolyline(points) {
  const line = [];
  for (const point of points) {
    const next = point.map(value => Math.round(Number(value.toFixed(2)) * 100));
    const last = line.at(-1);
    if (last && last[0] === next[0] && last[1] === next[1]) continue;
    while (line.length > 1) {
      const a = line.at(-2), b = line.at(-1);
      const dx = b[0] - a[0], dy = b[1] - a[1], nx = next[0] - b[0], ny = next[1] - b[1];
      if (dx * ny !== dy * nx || dx * nx + dy * ny < 0) break;
      line.pop();
    }
    line.push(next);
  }
  return line.map(([x, y]) => x / 100 + ',' + y / 100);
}

// A retained-text snapshot holds until the next recorded change. Never draw a
// slope that suggests gradual growth (or compaction) between observations.
export function stepTrendPolyline(points) {
  const stairs = [];
  for (const [x,y] of points) {
    if (stairs.length) stairs.push([x,stairs.at(-1)[1]]);
    stairs.push([x,y]);
  }
  return compactTrendPolyline(stairs);
}

export function chronologicalContextSamples(rows) {
  return rows.filter(row => Number.isFinite(row.time)).slice().sort((a,b) =>
    a.time-b.time || (a.ordinal ?? a.contextLine ?? a.seq ?? 0)-(b.ordinal ?? b.contextLine ?? b.seq ?? 0));
}
