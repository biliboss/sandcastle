import { describe, expect, it } from "vitest";
import { createWakeableSleep } from "./wakeableSleep.js";

describe("createWakeableSleep", () => {
  it("resolves after the timeout when not woken", async () => {
    const { sleep } = createWakeableSleep();
    const t0 = Date.now();
    await sleep(40);
    const dt = Date.now() - t0;
    expect(dt).toBeGreaterThanOrEqual(35);
    expect(dt).toBeLessThan(150);
  });

  it("resolves early when wake() is called before the timeout", async () => {
    const { sleep, wake } = createWakeableSleep();
    const t0 = Date.now();
    setTimeout(() => wake(), 20);
    await sleep(5_000);
    const dt = Date.now() - t0;
    expect(dt).toBeLessThan(200);
  });

  it("each sleep call only consumes one wake — back-to-back sleeps stay independent", async () => {
    const { sleep, wake } = createWakeableSleep();
    setTimeout(() => wake(), 10);
    await sleep(1_000); // wakes early
    const t0 = Date.now();
    await sleep(40); // no wake → real timeout
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
  });

  it("wake() called while no sleep is pending is a no-op", async () => {
    const { sleep, wake } = createWakeableSleep();
    wake(); // nothing to wake
    const t0 = Date.now();
    await sleep(40);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
  });
});
