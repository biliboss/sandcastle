// errorGrouping.test.ts — pure grouping logic for the recent-completions strip.

import { describe, expect, it } from "vitest";
// @ts-ignore - sibling JS module without .d.ts
import { groupErrors, errorSignature } from "./errorGrouping.js";

describe("errorSignature", () => {
  it("returns null for non-error items", () => {
    expect(errorSignature({ state: "ok", error: null })).toBeNull();
    expect(errorSignature({ state: "running", error: null })).toBeNull();
  });

  it("returns kind-prefixed signature for errored items", () => {
    const sig = errorSignature({
      state: "error",
      error: "claude failed [exit 1]: 401 invalid bearer token",
    });
    expect(sig).toMatch(/^AUTH:/);
  });

  it("collapses paths and digits — same root cause yields same signature", () => {
    const a = errorSignature({
      state: "error",
      error:
        "git clone [dispatch] failed: Cloning into '/Users/me/src/factory/repo-a'",
    });
    const b = errorSignature({
      state: "error",
      error:
        "git clone [dispatch] failed: Cloning into '/Users/me/src/factory/repo-b'",
    });
    expect(a).toBe(b);
  });

  it("keeps distinct kinds in distinct signatures", () => {
    const auth = errorSignature({
      state: "error",
      error: "401 invalid bearer",
    });
    const push = errorSignature({
      state: "error",
      error: "git push failed: [rejected] non-fast-forward",
    });
    expect(auth).not.toBe(push);
  });
});

describe("groupErrors", () => {
  it("returns empty for empty input", () => {
    expect(groupErrors([])).toEqual([]);
  });

  it("preserves a single ok item with count=1", () => {
    const items = [{ itemId: "A", state: "ok", error: null, prUrl: "x" }];
    expect(groupErrors(items)).toEqual([
      { item: items[0], count: 1, signature: null },
    ]);
  });

  it("collapses two identical errors into one group with count=2", () => {
    const items = [
      { itemId: "A", state: "error", error: "401 invalid bearer" },
      { itemId: "B", state: "error", error: "401 invalid bearer token" },
    ];
    const out = groupErrors(items);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(2);
    expect(out[0].item.itemId).toBe("A"); // first occurrence wins as the representative
  });

  it("keeps distinct error kinds in separate groups", () => {
    const items = [
      { itemId: "A", state: "error", error: "401 invalid bearer" },
      {
        itemId: "B",
        state: "error",
        error: "git push failed: [rejected] non-fast-forward",
      },
    ];
    expect(groupErrors(items)).toHaveLength(2);
  });

  it("does NOT collapse ok items together — each ok stays its own group", () => {
    const items = [
      { itemId: "A", state: "ok", error: null, prUrl: "x" },
      { itemId: "B", state: "ok", error: null, prUrl: "y" },
    ];
    const out = groupErrors(items);
    expect(out).toHaveLength(2);
    expect(out.every((g: any) => g.count === 1)).toBe(true);
  });

  it("preserves input order — first-seen item represents the group", () => {
    const items = [
      { itemId: "A", state: "ok", error: null },
      { itemId: "B", state: "error", error: "401 bearer" },
      { itemId: "C", state: "error", error: "git push failed: [rejected]" },
      { itemId: "D", state: "error", error: "401 bearer token x" },
    ];
    const out = groupErrors(items);
    expect(out.map((g: any) => g.item.itemId)).toEqual(["A", "B", "C"]);
    expect(out[1].count).toBe(2); // B + D collapsed
  });
});
