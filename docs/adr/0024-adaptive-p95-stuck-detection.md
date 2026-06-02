# Adaptive p95 stuck-detection over fixed timeouts

## Context

The dashboard's "agents · in flight" panel surfaces every running dispatch but currently has no visual cue when one is wedged. Operators end up watching the elapsed counter and remembering rough baselines ("clone usually takes ten seconds, this one's been at twenty"). On a fresh laptop or a slow CI runner the baselines differ — what's "stuck" on a beefy machine is normal on a small one.

We have a complete event log on disk (`events.jsonl`). Every past dispatch tells us what its phase durations actually were in this environment.

## Decision

The dashboard derives stuck-thresholds from the event log itself, not from constants:

- Pure module `adaptiveTimeout.ts` walks the JSONL log and produces per-phase duration samples for the five pipeline phases (cache, clone, exec, push, pr). `agent.exec.start`/`agent.exec.done` is the one explicit start/end pair; every other phase is bounded by the next `dispatch.progress` or `dispatch.done` event.
- `computeP95(durations)` returns a per-phase p95 in ms using R's type-7 / numpy-default linear-interpolation quantile.
- The dashboard flags a station red when `now - lastProgressTs > 2 × p95(currentPhase)`.
- When no samples exist for a phase yet (cold start), the flagger falls back to conservative fixed defaults until enough history accrues.

## Rejected alternatives

**Single global timeout.** Treats `pr.open` and `agent.exec` the same way; would either fire constantly on long execs or never fire on stuck pushes.

**Per-phase fixed timeouts in config.** Better, but requires the operator to tune them and gets stale as the environment changes (faster machine, slower repo, different agent provider).

**Per-phase fixed timeouts hard-coded.** Same brittleness without even the config knob.

**Wall-clock cumulative dispatch timeout.** Coarse-grained — tells you "this dispatch is slow" without telling you _which_ phase is wedged.

## Consequences

**Positive**

- Adapts automatically to the environment.
- The `2 × p95` factor produces a calm signal: real outliers fire it, normal slowness doesn't.
- Same data drives an adjacent visualization (the heartbeat-lag sparkline per row, planned next).

**Negative**

- Cold-start has no signal — an empty event log produces no thresholds. Mitigated by a small fixed default that kicks in below N samples per phase.
- Single bad outlier inflates p95 for a while. Could swap to median + MAD if this matters in practice.
- p95 computed every render in the current draft. If profile data shows it bites, memoize per-events.length boundary.

**Neutral**

- Tests pin both the duration extractor and the quantile math against a known-good fixture so future refactors can't silently shift thresholds.
