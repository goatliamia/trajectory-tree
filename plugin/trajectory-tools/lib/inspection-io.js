import { fileId, filePath } from './inspect-models/operations.mjs';
import { matchesIoOutcome } from './io-outcome.js';
import { callTimingSummary } from './tool-intervals.js';

const pathKey = path => fileId(filePath(path));
const pathOf = file => typeof file === 'string' ? file : file.path;
const inRange = (turn, range) => !range || turn >= range.from && turn <= range.to;
export const MAX_IO_SELECTION = 500;

export function matchesInspectionFocus(call, focus) {
  if (!focus) return true;
  if (focus.tool) return call.name === focus.tool;
  const key = pathKey(focus.file);
  return call.files.some(file => pathKey(pathOf(file)) === key);
}

export function selectInspectionCalls(index, { turns = index.scope.turns, focus, outcome, seqs } = {}) {
  const selected = seqs ? new Set(seqs) : null;
  const scopedCalls = index.views.io.filter(call => (!selected || selected.has(call.seq)) &&
    inRange(call.turn, turns) && matchesInspectionFocus(call, focus));
  if (focus?.tool) {
    const projected = new Set(index.views.io.map(call => call.seq));
    // Expose a Code Mode wrapper by its actual tool name when explicitly selected.
    for (const root of index.relations?.calls || []) {
      if (root.name !== focus.tool || projected.has(root.callSeq) || (selected && !selected.has(root.callSeq))) continue;
      const [turn, step] = index.relations.locations[root.callSeq] || [];
      if (!inRange(turn, turns)) continue;
      scopedCalls.push({ seq: root.callSeq, callSeq: root.callSeq, resultSeq: root.resultSeq, turn, step,
        name: root.name, family: 'transport', transportOnly: true, files: [], outputCharacters: null, start: null, end: null,
        status: root.resultSeq == null ? 'unknown' : 'returned' });
    }
  }
  const calls = outcome === undefined ? scopedCalls : scopedCalls.filter(call => matchesIoOutcome(call.status, outcome));
  const found = selected ? new Set(scopedCalls.map(call => call.seq)) : null;
  const callSelection = found ? { requested: selected.size, matched: found.size,
    unmatched: [...selected].filter(seq => !found.has(seq)) } : undefined;
  return { scopedCalls, calls, callSelection };
}

export function sampleInspectionFiles(files, focus) {
  if (files.length <= 8) return files;
  const sample = files.slice(0, 8);
  if (!focus?.file) return sample;
  const key = pathKey(focus.file);
  if (sample.some(file => pathKey(pathOf(file)) === key)) return sample;
  const target = files.find(file => pathKey(pathOf(file)) === key);
  if (target) sample[sample.length - 1] = target;
  return sample;
}

export function sampleInspectionCall(call, focus) {
  if (call.transportOnly) return call;
  const files = sampleInspectionFiles(call.files, focus);
  return { ...call, files, omittedFiles: call.files.length - files.length };
}

export function groupInspectionCalls(calls, by, exampleLimit = 3) {
  const groups = new Map();
  for (const call of calls) {
    const associations = new Map();
    if (by === 'tool') associations.set(call.name, { name: call.name, files: call.files });
    else for (const file of call.files) {
      const key = pathKey(file.path);
      if (!associations.has(key)) associations.set(key, { name: file.path, files: [] });
      associations.get(key).files.push(file);
    }
    for (const [key, { name, files }] of associations) {
      if (!groups.has(key)) groups.set(key, { [by]: name, calls: 0, errors: 0, returnedCharacters: 0,
        seq: call.seq, lastSeq: call.seq, turns: { from: call.turn, to: call.turn }, examples: [], access: {}, timingCalls: [] });
      const group = groups.get(key);
      group.calls++;
      group.timingCalls.push(call);
      if (call.status === 'error') group.errors++;
      group.returnedCharacters = group.returnedCharacters == null || call.outputCharacters == null
        ? null : group.returnedCharacters + call.outputCharacters;
      group.seq = Math.min(group.seq, call.seq);
      group.lastSeq = Math.max(group.lastSeq, call.seq);
      group.turns.from = Math.min(group.turns.from, call.turn);
      group.turns.to = Math.max(group.turns.to, call.turn);
      if (group.examples.length < exampleLimit) group.examples.push({ seq: call.seq, startSeq: call.startSeq, resultSeq: call.resultSeq, turn: call.turn, step: call.step });
      for (const file of files) group.access[file.access] = (group.access[file.access] || 0) + 1;
    }
  }
  return [...groups.values()].map(({ timingCalls, ...group }) => ({ ...group, timing: callTimingSummary(timingCalls) }));
}
