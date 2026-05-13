/**
 * `wakeableSleep` — a sleep that can be cut short by an external `wake()`.
 *
 * Used by `runStartLoop` so the dashboard's `POST /act/tick-now` can poke
 * the coordinator to skip the rest of its current poll-interval wait and
 * fire the next tick immediately.
 *
 * Contract:
 *   - `sleep(ms)` resolves after `ms` OR when `wake()` is called, whichever
 *      comes first.
 *   - One `wake()` resolves at most one in-flight sleep — back-to-back
 *      sleeps stay independent.
 *   - `wake()` with no pending sleep is a no-op (the poke is dropped, not
 *      queued).
 */

export interface WakeableSleep {
  sleep: (ms: number) => Promise<void>;
  wake: () => void;
}

export const createWakeableSleep = (): WakeableSleep => {
  let pendingResolve: (() => void) | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    sleep(ms) {
      return new Promise<void>((resolve) => {
        pendingResolve = resolve;
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          pendingResolve = null;
          resolve();
        }, ms);
      });
    },
    wake() {
      if (!pendingResolve) return;
      const resolve = pendingResolve;
      const timer = pendingTimer;
      pendingResolve = null;
      pendingTimer = null;
      if (timer) clearTimeout(timer);
      resolve();
    },
  };
};
