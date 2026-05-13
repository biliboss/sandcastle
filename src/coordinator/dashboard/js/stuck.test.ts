// stuck.test.ts — pure flagger logic. No DOM, no Alpine.

import { describe, expect, it } from "vitest";
// @ts-ignore - sibling JS module without .d.ts
import { isStuck, stepToPhase } from "./stuck.js";

const tsAt = (ms: number): string => new Date(ms).toISOString();

describe("stepToPhase", () => {
  it("maps each progress step to the right phase id", () => {
    expect(stepToPhase("cache.ensure")).toBe("cache");
    expect(stepToPhase("git.clone")).toBe("clone");
    expect(stepToPhase("agent.exec.start")).toBe("exec");
    expect(stepToPhase("git.push")).toBe("push");
    expect(stepToPhase("pr.open")).toBe("pr");
  });
  it("returns null for unknown / non-mapped steps", () => {
    expect(stepToPhase("agent.exec.done")).toBeNull(); // close marker, not a phase start
    expect(stepToPhase("nonsense")).toBeNull();
    expect(stepToPhase(undefined as any)).toBeNull();
  });
});

describe("isStuck", () => {
  const thresholds = new Map<string, number>([
    ["cache", 5_000],
    ["clone", 30_000],
    ["exec", 600_000],
    ["push", 30_000],
    ["pr", 15_000],
  ]);

  it("returns false when item is not running", () => {
    const item = { state: "ok", activeStep: "git.clone", lastTs: tsAt(1000) };
    expect(isStuck(item, thresholds, 999_999_999)).toBe(false);
  });

  it("returns false when within 2x phase p95", () => {
    const item = { state: "running", activeStep: "git.clone", lastTs: tsAt(0) };
    // 2x p95 for clone = 60s; 30s is well under.
    expect(isStuck(item, thresholds, 30_000)).toBe(false);
  });

  it("returns true when beyond 2x phase p95", () => {
    const item = { state: "running", activeStep: "git.clone", lastTs: tsAt(0) };
    // 2x clone = 60s; 70s elapsed → stuck.
    expect(isStuck(item, thresholds, 70_000)).toBe(true);
  });

  it("uses the right threshold per phase (exec is huge)", () => {
    const item = {
      state: "running",
      activeStep: "agent.exec.start",
      lastTs: tsAt(0),
    };
    // 2x exec = 1200s; 800s elapsed = NOT stuck (would be stuck for clone).
    expect(isStuck(item, thresholds, 800_000)).toBe(false);
    expect(isStuck(item, thresholds, 1_300_000)).toBe(true);
  });

  it("returns false when no threshold for the active phase (cold start)", () => {
    const empty = new Map<string, number>();
    const item = { state: "running", activeStep: "git.clone", lastTs: tsAt(0) };
    expect(isStuck(item, empty, 999_999_999)).toBe(false);
  });

  it("returns false when activeStep is unknown / null", () => {
    const item = { state: "running", activeStep: null, lastTs: tsAt(0) };
    expect(isStuck(item, thresholds, 999_999_999)).toBe(false);
  });
});
