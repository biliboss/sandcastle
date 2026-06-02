import { describe, expect, it } from "vitest";
import {
  collectPhaseDurations,
  computeP95,
  type PhaseDurations,
  type Phase,
} from "./adaptiveTimeout.js";

const ts = (offsetSec: number): string =>
  new Date(Date.UTC(2026, 4, 13, 12, 0, offsetSec)).toISOString();

describe("collectPhaseDurations", () => {
  it("returns empty map for empty event log", () => {
    const out = collectPhaseDurations([]);
    expect([...out.entries()]).toEqual([]);
  });

  it("extracts one sample per phase from a single happy-path dispatch", () => {
    // Phase boundaries: each step starts at its ts, ends at the next step's ts.
    // exec is special: agent.exec.start → agent.exec.done (explicit close).
    const events = [
      { type: "dispatch.start", itemId: "A", ts: ts(0) },
      {
        type: "dispatch.progress",
        itemId: "A",
        step: "cache.ensure",
        ts: ts(1),
      }, // cache 1→2 = 1s
      { type: "dispatch.progress", itemId: "A", step: "git.clone", ts: ts(2) }, // clone 2→4 = 2s
      {
        type: "dispatch.progress",
        itemId: "A",
        step: "agent.exec.start",
        ts: ts(4),
      }, // exec 4→14 = 10s
      {
        type: "dispatch.progress",
        itemId: "A",
        step: "agent.exec.done",
        ts: ts(14),
      },
      { type: "dispatch.progress", itemId: "A", step: "git.push", ts: ts(15) }, // push 15→17 = 2s
      { type: "dispatch.progress", itemId: "A", step: "pr.open", ts: ts(17) }, // pr 17→18 = 1s
      { type: "dispatch.done", itemId: "A", ts: ts(18) },
    ];
    const out = collectPhaseDurations(events);
    expect(out.get("cache")).toEqual([1000]);
    expect(out.get("clone")).toEqual([2000]);
    expect(out.get("exec")).toEqual([10000]);
    expect(out.get("push")).toEqual([2000]);
    expect(out.get("pr")).toEqual([1000]);
  });
});

describe("collectPhaseDurations multi-dispatch", () => {
  it("accumulates samples across multiple items into the same buckets", () => {
    const events = [
      // Item A — clone takes 2s
      { type: "dispatch.progress", itemId: "A", step: "git.clone", ts: ts(0) },
      { type: "dispatch.progress", itemId: "A", step: "git.push", ts: ts(2) },
      { type: "dispatch.done", itemId: "A", ts: ts(3) },
      // Item B — clone takes 5s
      { type: "dispatch.progress", itemId: "B", step: "git.clone", ts: ts(10) },
      { type: "dispatch.progress", itemId: "B", step: "git.push", ts: ts(15) },
      { type: "dispatch.done", itemId: "B", ts: ts(16) },
    ];
    const out = collectPhaseDurations(events);
    expect(out.get("clone")).toEqual([2000, 5000]);
    expect(out.get("push")).toEqual([1000, 1000]);
  });

  it("isolates phase samples — slow exec does not affect clone p95", () => {
    const events = [
      { type: "dispatch.progress", itemId: "A", step: "git.clone", ts: ts(0) },
      {
        type: "dispatch.progress",
        itemId: "A",
        step: "agent.exec.start",
        ts: ts(2),
      },
      {
        type: "dispatch.progress",
        itemId: "A",
        step: "agent.exec.done",
        ts: ts(902),
      }, // 15min exec
      { type: "dispatch.done", itemId: "A", ts: ts(903) },
    ];
    const dur = collectPhaseDurations(events);
    const p95 = computeP95(dur);
    expect(p95.get("clone")).toBe(2000);
    expect(p95.get("exec")).toBe(900_000);
  });
});

describe("computeP95", () => {
  it("returns null per phase when there are no samples", () => {
    const empty: PhaseDurations = new Map();
    const p95 = computeP95(empty);
    const phases: Phase[] = ["cache", "clone", "exec", "push", "pr"];
    for (const p of phases) expect(p95.get(p)).toBeNull();
  });

  it("returns the sample itself when only one sample exists", () => {
    const dur: PhaseDurations = new Map([["clone", [4321]]]);
    expect(computeP95(dur).get("clone")).toBe(4321);
  });

  it("computes p95 by linear interpolation on a sorted sample", () => {
    // Samples 1..100 → p95 (R type-7, np.percentile default) = 95.05
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    const dur: PhaseDurations = new Map([["exec", samples]]);
    expect(computeP95(dur).get("exec")).toBeCloseTo(95.05, 2);
  });
});
