/**
 * sparkline.js — pure helpers for the per-station heartbeat-lag sparkline.
 *
 * `heartbeatLagSeries(item, n=20)` walks an item's event log and returns
 * the last `n` inter-arrival deltas in milliseconds. A flat-low series
 * means the agent is emitting events on a steady cadence (healthy);
 * a ramping series means the gaps between events are widening (slowing
 * down or about to stick).
 *
 * `polylinePoints(series, width, height)` projects the series onto an
 * SVG `<polyline points="…">` string. Higher-value samples sit closer
 * to the top edge (y=0) — chosen so a "rising lag" reads visually as
 * "rising danger".
 */

const DEFAULT_CAP = 20;

export function heartbeatLagSeries(item, cap = DEFAULT_CAP) {
  const events = item?.events ?? [];
  if (events.length < 2) return [];
  const deltas = [];
  for (let i = 1; i < events.length; i++) {
    const a = Date.parse(events[i - 1].ts);
    const b = Date.parse(events[i].ts);
    if (Number.isFinite(a) && Number.isFinite(b)) deltas.push(b - a);
  }
  return deltas.slice(-cap);
}

export function polylinePoints(series, width, height) {
  if (!series || series.length === 0) return "";
  const max = Math.max(...series);
  const min = Math.min(...series);
  const span = max - min;
  const xStep = series.length === 1 ? 0 : width / (series.length - 1);
  return series
    .map((v, i) => {
      const x = i * xStep;
      // Higher value → closer to y=0 (top). Flat → all on baseline (y=0).
      const y = span === 0 ? 0 : height * (1 - (v - min) / span);
      return `${x},${y}`;
    })
    .join(" ");
}
