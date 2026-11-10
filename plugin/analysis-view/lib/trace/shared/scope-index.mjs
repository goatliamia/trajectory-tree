export function groupRows(rows, keyFor) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

// Keep unassigned records in the session totals. Build the index when a turn is requested.
export function scopeByTurn(rows, turnFor = row => row.turn) {
  let byTurn;
  return turn => {
    if (turn == null) return rows;
    byTurn ??= groupRows(rows, turnFor);
    return byTurn.get(turn) ?? [];
  };
}
