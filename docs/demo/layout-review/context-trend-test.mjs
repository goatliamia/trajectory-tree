import assert from 'node:assert/strict';
import { compactTrendPolyline, stepTrendPolyline, chronologicalContextSamples } from './context-trend-model.mjs';

const samples=chronologicalContextSamples([{time:10,ordinal:1,v:1},{time:40,ordinal:4,v:4},{time:20,ordinal:2,v:2},{time:20,ordinal:3,v:0}]);
assert.deepEqual(samples.map(row=>row.ordinal),[1,2,3,4]);
const stairs=stepTrendPolyline(samples.map(row=>[row.time,row.v])).map(p=>p.split(',').map(Number));
assert.deepEqual(stairs,[[10,1],[20,1],[20,2],[20,0],[40,0],[40,4]],'Same-time compaction is vertical; later values do not form diagonals');
for(let i=1;i<stairs.length;i++){const a=stairs[i-1],b=stairs[i];assert.ok(b[0]>=a[0]);assert.ok(a[0]===b[0]||a[1]===b[1]);}

// A dense straight run is identical SVG geometry after compaction.
const flat = Array.from({ length: 10000 }, (_, x) => [x / 10, 42]);
assert.deepEqual(compactTrendPolyline(flat), ['0,42', '999.9,42']);
assert.deepEqual(compactTrendPolyline([[0, 0], [1, 1], [2, 2]]), ['0,0', '2,2']);
assert.deepEqual(compactTrendPolyline([[0, 0], [1, 1], [2, 0]]), ['0,0', '1,1', '2,0']);
// Same-time compaction drops and subsequent growth must stay visible.
const cut = [[0, 0], [1, 10], [1, 2], [2, 3], [3, 4]];
assert.deepEqual(compactTrendPolyline(cut), ['0,0', '1,10', '1,2', '3,4']);
assert.deepEqual(compactTrendPolyline([[1, 2], [1, 2], [1, 3], [1, 2]]), ['1,2', '1,3', '1,2']);
assert.deepEqual(compactTrendPolyline([]), []);
assert.deepEqual(compactTrendPolyline([[1.335, 2.675]]), ['1.33,2.67']);
// Verify the entire geometry, not just selected examples: every removed point
// lies on an output segment in traversal order at the original SVG precision.
for (let seed = 1; seed <= 20; seed++) {
  const input = Array.from({ length: 2000 }, (_, i) => [i / 10, Math.floor(i / (seed + 1)) % 17]);
  const output = compactTrendPolyline(input).map(value => value.split(',').map(Number));
  let segment = 1;
  for (const [x, y] of input) {
    while (segment < output.length - 1 && output[segment][0] < x) segment++;
    const a = output[segment - 1], b = output[segment];
    const expected = a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
    assert.ok(Math.abs(y - expected) < 1e-8);
  }
}
console.log('Trend geometry: dense plateaus compacted; exact segments, peaks, compaction drops and reversals preserved.');
