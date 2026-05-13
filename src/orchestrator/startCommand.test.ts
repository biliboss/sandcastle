import { describe, expect, it, vi } from "vitest";
import { runStartLoop } from "./startCommand.js";

describe("runStartLoop", () => {
  it("calls coordinator.tick() repeatedly until the abort signal fires", async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const controller = new AbortController();

    // Stop after the third sleep.
    let sleeps = 0;
    const sleep = vi.fn(async () => {
      sleeps++;
      if (sleeps >= 3) controller.abort();
    });

    await runStartLoop({
      coordinator: { tick },
      sleep,
      pollIntervalMs: 1,
      signal: controller.signal,
    });

    expect(tick.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("stops looping if the signal is aborted mid-tick", async () => {
    const controller = new AbortController();
    const tick = vi.fn(async () => {
      controller.abort();
    });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await runStartLoop({
      coordinator: { tick },
      sleep,
      pollIntervalMs: 1,
      signal: controller.signal,
    });

    expect(tick).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("swallows tick errors and continues the loop", async () => {
    let count = 0;
    const tick = vi.fn(async () => {
      count++;
      if (count === 1) throw new Error("transient");
    });
    const controller = new AbortController();
    let sleeps = 0;
    const sleep = vi.fn(async () => {
      sleeps++;
      if (sleeps >= 2) controller.abort();
    });

    await runStartLoop({
      coordinator: { tick },
      sleep,
      pollIntervalMs: 1,
      signal: controller.signal,
      onError: () => {},
    });
    expect(tick.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
