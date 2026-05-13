/**
 * `adaptiveTimeout.ts` — derives per-phase p95 durations from the JSONL
 * coordinator event log.
 *
 * Used by the dashboard's stuck-agent flagger: rather than hard-coding
 * "exec > 900s = stuck", we compute a rolling p95 from past dispatches and
 * flag at 2× p95. Adapts to the local environment (slow CI, beefy laptop)
 * automatically.
 *
 * Phases (5):
 *   cache  — `cache.ensure`
 *   clone  — `git.clone`
 *   exec   — `agent.exec.start` → `agent.exec.done`
 *   push   — `git.push`
 *   pr     — `pr.open` (closed by `dispatch.done`)
 *
 * Pure module. Two functions:
 *   collectPhaseDurations(events) — events array → samples map
 *   computeP95(durations)         — samples map → p95 ms per phase
 */

export type Phase = "cache" | "clone" | "exec" | "push" | "pr";

/** Per-phase array of duration samples in milliseconds. */
export type PhaseDurations = Map<Phase, number[]>;

/** Per-phase p95 in milliseconds. `null` when there are no samples. */
export type PhaseP95 = Map<Phase, number | null>;

const PHASES: readonly Phase[] = ["cache", "clone", "exec", "push", "pr"];

interface RawEvent {
  readonly type?: string;
  readonly ts?: string;
  readonly itemId?: string;
  readonly step?: string;
}

/** Map raw step name → simple Phase identifier. Phase-start events only. */
const STEP_TO_PHASE: Record<string, Phase> = {
  "cache.ensure": "cache",
  "git.clone": "clone",
  "agent.exec.start": "exec",
  "git.push": "push",
  "pr.open": "pr",
};

/** Step that closes the previous phase. `agent.exec.done` closes exec; for
 *  every other phase, the next phase-start (or dispatch.done) closes it. */
const EXEC_END_STEP = "agent.exec.done";

export const collectPhaseDurations = (
  events: readonly RawEvent[],
): PhaseDurations => {
  const out: PhaseDurations = new Map();
  // For each itemId, track the open phase {phase, startMs}. When a closing
  // event arrives, push the duration into the right bucket.
  const open = new Map<string, { phase: Phase; startMs: number }>();

  const close = (id: string, endMs: number) => {
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
      // exec has explicit close — close it on agent.exec.done specifically.
      if (ev.step === EXEC_END_STEP) {
        close(ev.itemId, ms);
        continue;
      }
      const phase = STEP_TO_PHASE[ev.step];
      if (phase === undefined) continue;
      // Starting a new phase closes any previously-open one for this item.
      close(ev.itemId, ms);
      open.set(ev.itemId, { phase, startMs: ms });
    } else if (ev.type === "dispatch.done") {
      close(ev.itemId, ms);
    }
  }
  return out;
};

export const computeP95 = (durations: PhaseDurations): PhaseP95 => {
  const out: PhaseP95 = new Map();
  for (const p of PHASES) {
    const samples = durations.get(p);
    out.set(p, samples && samples.length > 0 ? quantile(samples, 0.95) : null);
  }
  return out;
};

/** Linear-interpolation quantile (R's type-7, same as numpy default). */
const quantile = (xs: number[], q: number): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  const frac = pos - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
};
