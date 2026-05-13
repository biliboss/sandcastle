// sparkline.test.ts — pure helper. Inter-arrival deltas + SVG polyline path.

import { describe, expect, it } from "vitest";
// @ts-ignore - sibling JS module without .d.ts
import { heartbeatLagSeries, polylinePoints } from "./sparkline.js";

const tsAt = (ms: number): string => new Date(ms).toISOString();

describe("heartbeatLagSeries", () => {
  it("returns empty array for an item with no events", () => {
    expect(heartbeatLagSeries({ events: [] })).toEqual([]);
  });

  it("returns empty array for an item with a single event (no delta possible)", () => {
    expect(heartbeatLagSeries({ events: [{ ts: tsAt(0) }] })).toEqual([]);
  });

  it("returns N-1 inter-arrival deltas in milliseconds", () => {
    const events = [
      { ts: tsAt(0) },
      { ts: tsAt(1000) },
      { ts: tsAt(2500) },
      { ts: tsAt(5000) },
    ];
    expect(heartbeatLagSeries({ events })).toEqual([1000, 1500, 2500]);
  });

  it("caps at the last N samples (default 20)", () => {
    const events = Array.from({ length: 30 }, (_, i) => ({
      ts: tsAt(i * 100),
    }));
    const series = heartbeatLagSeries({ events });
    // 30 events → 29 deltas; capped to last 20 → all 100ms.
    expect(series).toHaveLength(20);
    expect(series.every((v: number) => v === 100)).toBe(true);
  });

  it("respects a custom cap", () => {
    const events = Array.from({ length: 10 }, (_, i) => ({ ts: tsAt(i * 50) }));
    expect(heartbeatLagSeries({ events }, 3)).toEqual([50, 50, 50]);
  });
});

describe("polylinePoints", () => {
  it("returns empty string for empty series", () => {
    expect(polylinePoints([], 100, 20)).toBe("");
  });

  it("scales values to the given width × height (range-normalized, max → top)", () => {
    // [10, 20, 5] in a 20-wide × 10-tall box. min=5, max=20, span=15.
    //   10 → y=10*(1-(10-5)/15)=10*2/3≈6.6667
    //   20 → y=0  (top)
    //    5 → y=10 (bottom)
    const out = polylinePoints([10, 20, 5], 20, 10);
    expect(out).toBe(`0,${10 * (1 - 5 / 15)} 10,0 20,10`);
  });

  it("flattens to baseline when all samples are equal", () => {
    expect(polylinePoints([100, 100, 100], 20, 10)).toBe("0,0 10,0 20,0");
  });
});
