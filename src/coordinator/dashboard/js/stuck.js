/**
 * stuck.js — pure helper that decides whether an in-flight dispatch is
 * "stuck" given a thresholds map (per-phase 2× p95 in ms) and the current
 * wall-clock time.
 *
 * An item is stuck when:
 *   - state === "running"
 *   - activeStep maps to a known phase
 *   - thresholds has a p95 entry for that phase
 *   - now - lastTs > 2 × thresholds.get(phase)
 *
 * The 2× factor lives here (per ADR 0024) so callers pass raw p95 values
 * straight from `adaptiveTimeout.computeP95` without further math.
 *
 * Mirror note: `stepToPhase` is the JS-side mirror of the same map in
 * `src/coordinator/adaptiveTimeout.ts`. Keep both in sync.
 */

const STEP_TO_PHASE = {
  "cache.ensure": "cache",
  "git.clone": "clone",
  "agent.exec.start": "exec",
  "git.push": "push",
  "pr.open": "pr",
};

export function stepToPhase(step) {
  if (!step) return null;
  return STEP_TO_PHASE[step] ?? null;
}

export function isStuck(item, thresholds, nowMs) {
  if (!item || item.state !== "running") return false;
  const phase = stepToPhase(item.activeStep);
  if (phase === null) return false;
  const limit = thresholds.get(phase);
  if (limit === undefined) return false;
  const lastMs = new Date(item.lastTs).getTime();
  if (!Number.isFinite(lastMs)) return false;
  return nowMs - lastMs > limit * 2;
}
