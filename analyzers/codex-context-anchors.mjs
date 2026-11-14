// Item completion precedes response persistence. Bind context checkpoints to
// response identity, and only infer an envelope when exactly one call is open.
export function codexContextAnchors(rows) {
  const anchors = new Map(), pending = new Map();
  for (const row of rows) {
    const p = row.payload || {};
    if (row.type === 'event_msg' && p.type === 'item_completed' && p.item?.id) {
      const id = p.item.id;
      if (!anchors.has(id)) anchors.set(id, { ordinal: row.ordinal, basis: 'completion' });
      if (!/^(Reasoning|UserMessage|AgentMessage|ContextCompaction)$/i.test(p.item.type || '')) {
        const envelope = pending.get(id) || (pending.size === 1 ? pending.values().next().value : null);
        // A background process may finish during a different wrapper call.
        // Its start time must belong to this envelope before inferring ownership.
        if (envelope && (!Number.isFinite(p.started_at_ms) || p.started_at_ms >= envelope.time)) envelope.members.push(id);
      }
    }
    if (row.type !== 'response_item') continue;
    if (p.type === 'message' && p.id) anchors.set(p.id, { ordinal: row.ordinal, time: Date.parse(row.timestamp), basis: 'message' });
    if (/^(function_call|custom_tool_call)$/.test(p.type) && p.call_id) {
      pending.set(p.call_id, { members: [], id: p.id, time: Date.parse(row.timestamp) });
    }
    if (/^(function_call_output|custom_tool_call_output)$/.test(p.type) && p.call_id) {
      const envelope = pending.get(p.call_id);
      const members = envelope?.members || [];
      const anchor = { ordinal: row.ordinal, time: Date.parse(row.timestamp), basis: members.length > 1 ? 'batch-result' : 'tool-result', members };
      anchors.set(p.call_id, anchor);
      if (envelope?.id) anchors.set(envelope.id, anchor);
      if (members.length) anchors.set(members.at(-1), anchor);
      pending.delete(p.call_id);
    }
  }
  return anchors;
}

export function compositionAtOrdinal(rows, ordinal) {
  let low = 0, high = rows.length;
  while (low < high) { const mid = (low + high) >>> 1; if (rows[mid].ordinal <= ordinal) low = mid + 1; else high = mid; }
  return rows[low - 1];
}
