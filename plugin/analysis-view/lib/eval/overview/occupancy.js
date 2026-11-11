const windowOccupancyBands = [
  [20, '<20%'], [40, '20–40%'], [60, '40–60%'], [70, '60–70%'],
  [85, '70–85%'], [100, '85–100%'], [Infinity, '≥100%'],
];
const windowRatio = (used, window) => Number.isFinite(used) && window > 0 ? 100 * used / window : null;
function readOccupancyActions({ actions, names }, getTurn) {
  return actions.map(row => {
    const [launch, request, turnNo, step, name, status, used, window, result, category, model, elapsed] = row;
    const turn = getTurn(turnNo);
    return { launch, request, turn, step, tool: names[name], status, used, window, result, category, model, elapsed,
      ratio: windowRatio(used, window), error: status === 1 ? turn.errors.find(error => error.failed === result) : null };
  });
}
