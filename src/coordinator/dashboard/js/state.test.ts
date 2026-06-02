// state.test.ts - store reducer behavior. Lives in TS so vitest picks it up
// via the existing src/**/*.test.ts glob, but exercises the .js module
// directly through ES module import. Pure-data tests only.

import { describe, expect, it } from "vitest";
// @ts-ignore - sibling JS module without .d.ts
import { buildStore } from "./state.js";

const ev = (overrides: Record<string, unknown>) => ({
  ts: new Date().toISOString(),
  ...overrides,
});

describe("buildStore items aggregation", () => {
  it("aggregates a full happy-path dispatch into a single ok item", () => {
    const store = buildStore();
    const itemId = "PVTI_x1";
    [
      {
        type: "item.claimed",
        itemId,
        repo: "owner/repo",
        issueNumber: 42,
        issueTitle: "do thing",
        from: "Inbox",
        to: "Doing",
      },
      {
        type: "dispatch.start",
        itemId,
        repo: "owner/repo",
        phase: "dev",
        profile: "claude",
      },
      { type: "dispatch.progress", itemId, step: "cache.ensure" },
      { type: "dispatch.progress", itemId, step: "git.clone" },
      { type: "dispatch.progress", itemId, step: "agent.exec.start" },
      { type: "dispatch.progress", itemId, step: "agent.exec.done" },
      { type: "dispatch.progress", itemId, step: "git.push" },
      { type: "dispatch.progress", itemId, step: "pr.open" },
      {
        type: "dispatch.done",
        itemId,
        prUrl: "https://github.com/owner/repo/pull/9",
      },
    ].forEach((e) => store.pushEvent(ev(e)));

    const items = store.items;
    expect(items).toHaveLength(1);
    expect(items[0].state).toBe("ok");
    expect(items[0].steps).toEqual({
      cache: true,
      clone: true,
      exec: true,
      push: true,
      pr: true,
    });
    expect(items[0].prUrl).toBe("https://github.com/owner/repo/pull/9");
  });

  it("flips item to error state and preserves the error message", () => {
    const store = buildStore();
    const itemId = "PVTI_x2";
    [
      {
        type: "dispatch.start",
        itemId,
        repo: "o/r",
        phase: "research",
        profile: "claude",
      },
      { type: "dispatch.progress", itemId, step: "git.clone" },
      {
        type: "dispatch.done",
        itemId,
        error: "git push failed: [rejected] non-fast-forward",
      },
    ].forEach((e) => store.pushEvent(ev(e)));

    expect(store.items).toHaveLength(1);
    expect(store.items[0].state).toBe("error");
    expect(store.items[0].error).toContain("non-fast-forward");
  });

  it("aggregates multiple distinct items independently", () => {
    const store = buildStore();
    [
      {
        type: "dispatch.start",
        itemId: "A",
        repo: "o/a",
        phase: "dev",
        profile: "claude",
      },
      {
        type: "dispatch.start",
        itemId: "B",
        repo: "o/b",
        phase: "dev",
        profile: "claude",
      },
      { type: "dispatch.done", itemId: "A", prUrl: "https://x/1" },
      { type: "dispatch.done", itemId: "B", error: "boom" },
    ].forEach((e) => store.pushEvent(ev(e)));

    const items = store.items;
    expect(items).toHaveLength(2);
    expect(items.find((i: any) => i.itemId === "A")?.state).toBe("ok");
    expect(items.find((i: any) => i.itemId === "B")?.state).toBe("error");
  });

  it("classifies items into active vs completed views", () => {
    const store = buildStore();
    [
      {
        type: "dispatch.start",
        itemId: "A",
        repo: "o/a",
        phase: "dev",
        profile: "claude",
      },
      {
        type: "dispatch.start",
        itemId: "B",
        repo: "o/b",
        phase: "dev",
        profile: "claude",
      },
      { type: "dispatch.done", itemId: "B", prUrl: "https://x/2" },
    ].forEach((e) => store.pushEvent(ev(e)));

    expect(store.active.map((i: any) => i.itemId)).toEqual(["A"]);
    expect(store.completed.map((i: any) => i.itemId)).toEqual(["B"]);
    expect(store.errored).toBe(0);
    expect(store.okCount).toBe(1);
  });

  it("interleaves events from multiple items without leaking between them", () => {
    const store = buildStore();
    [
      {
        type: "dispatch.start",
        itemId: "A",
        repo: "o/a",
        phase: "dev",
        profile: "claude",
      },
      {
        type: "dispatch.start",
        itemId: "B",
        repo: "o/b",
        phase: "research",
        profile: "cursor",
      },
      { type: "dispatch.progress", itemId: "A", step: "git.clone" },
      { type: "dispatch.progress", itemId: "B", step: "agent.exec.start" },
      { type: "dispatch.progress", itemId: "A", step: "agent.exec.start" },
      { type: "dispatch.done", itemId: "B", error: "401 invalid bearer" },
      { type: "dispatch.progress", itemId: "A", step: "git.push" },
    ].forEach((e) => store.pushEvent(ev(e)));

    const a = store.items.find((i: any) => i.itemId === "A");
    const b = store.items.find((i: any) => i.itemId === "B");
    expect(a.profile).toBe("claude");
    expect(a.steps.clone).toBe(true);
    expect(a.steps.push).toBe(true);
    expect(a.state).toBe("running");
    expect(b.profile).toBe("cursor");
    expect(b.state).toBe("error");
    expect(b.error).toContain("401");
  });

  it("late-arriving claimed event doesn't reset earlier progress", () => {
    const store = buildStore();
    const itemId = "PVTI_late";
    [
      {
        type: "dispatch.start",
        itemId,
        repo: "o/r",
        phase: "dev",
        profile: "claude",
      },
      { type: "dispatch.progress", itemId, step: "git.clone" },
      {
        type: "item.claimed",
        itemId,
        from: "Inbox",
        to: "Doing",
        repo: "o/r",
        issueNumber: 7,
        issueTitle: "x",
      },
    ].forEach((e) => store.pushEvent(ev(e)));

    expect(store.items[0].steps.clone).toBe(true);
    expect(store.items[0].issueNumber).toBe(7);
    expect(store.items[0].title).toBe("x");
  });

  it("handles tick events without polluting items", () => {
    const store = buildStore();
    [
      { type: "tick.start" },
      { type: "tick.done", itemCount: 0 },
      { type: "tick.start" },
      { type: "tick.done", itemCount: 2 },
    ].forEach((e) => store.pushEvent(ev(e)));

    expect(store.items).toHaveLength(0);
    expect(store.tickHistory).toHaveLength(2);
    expect(store.tickHistory[1].busy).toBe(true);
  });
});
