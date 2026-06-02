/**
 * adaptiveTimeout.js — JS-side mirror of src/coordinator/adaptiveTimeout.ts.
 *
 * The TS version is the source of truth. This file exists so the dashboard
 * can compute thresholds from the in-memory event log without server help.
 *
 * Keep both in sync:
 *   - PHASE step mapping (STEP_TO_PHASE / EXEC_END_STEP)
 *   - quantile algorithm (R type-7 linear interpolation)
 *
 * Exports:
 *   collectPhaseDurations(events)  → Map<Phase, number[]>
 *   computeP95(durations)          → Map<Phase, number | null>
 */

const PHASES = ["cache", "clone", "exec", "push", "pr"];

const STEP_TO_PHASE = {
  "cache.ensure": "cache",
  "git.clone": "clone",
  "agent.exec.start": "exec",
  "git.push": "push",
  "pr.open": "pr",
};

const EXEC_END_STEP = "agent.exec.done";

export function collectPhaseDurations(events) {
  const out = new Map();
  const open = new Map();

  const close = (id, endMs) => {
    const o = open.get(id);
    if (!o) return;
    const arr = out.get(o.phase) ?? [];
    arr.push(endMs - o.startMs);
    out.set(o.phase, arr);
    open.delete(id);
  };

  for (const ev of events) {
    if (!ev.itemId || !ev.ts) continue;
    const ms = Date.parse(ev.ts);
    if (!Number.isFinite(ms)) continue;

    if (ev.type === "dispatch.progress" && ev.step) {
      if (ev.step === EXEC_END_STEP) {
        close(ev.itemId, ms);
        continue;
      }
      const phase = STEP_TO_PHASE[ev.step];
      if (phase === undefined) continue;
      close(ev.itemId, ms);
      open.set(ev.itemId, { phase, startMs: ms });
    } else if (ev.type === "dispatch.done") {
      close(ev.itemId, ms);
    }
  }
  return out;
}

export function computeP95(durations) {
  const out = new Map();
  for (const p of PHASES) {
    const samples = durations.get(p);
    out.set(p, samples && samples.length > 0 ? quantile(samples, 0.95) : null);
  }
  return out;
}

function quantile(xs, q) {
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}
