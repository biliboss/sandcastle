/**
 * `orchestrator start` — runs the coordinator tick loop until the host
 * process receives SIGINT.
 *
 * The sleep function is injected so tests can advance the loop without real
 * timers; production wires it to setTimeout.
 */

import type { Coordinator } from "./Coordinator.js";

export interface StartLoopDeps {
  readonly coordinator: Pick<Coordinator, "tick">;
  readonly sleep: (ms: number) => Promise<void>;
  readonly pollIntervalMs: number;
  readonly signal: AbortSignal;
  readonly onError?: (err: unknown) => void;
}

export const runStartLoop = async (deps: StartLoopDeps): Promise<void> => {
  while (!deps.signal.aborted) {
    try {
      await deps.coordinator.tick();
    } catch (err) {
      deps.onError?.(err);
    }
    if (deps.signal.aborted) break;
    await deps.sleep(deps.pollIntervalMs);
  }
};

export const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
