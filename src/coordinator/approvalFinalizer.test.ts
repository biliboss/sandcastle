import { describe, expect, it, vi } from "vitest";
import { createApprovalFinalizer } from "./approvalFinalizer.js";
import type { WorkItemEvent } from "./types.js";

const baseEvent: WorkItemEvent = {
  itemId: "PVTI_x",
  status: "Approved",
  issue: {
    repo: "o/r",
    number: 7,
    title: "feat: thing",
    body: "do the thing",
  },
};

const ghOk = (stdout = "") => ({ stdout, stderr: "", exitCode: 0 });

describe("createApprovalFinalizer.finalize", () => {
  it("squash-merges dev PR (carries research+dev) and closes research PR as superseded", async () => {
    const calls: Array<{ tool: "gh" | "git"; args: readonly string[] }> = [];
    const gh = vi.fn(async (args: readonly string[]) => {
      calls.push({ tool: "gh", args });
      if (args[0] === "pr" && args[1] === "list") {
        // list PRs with our heads
        const head = args[args.indexOf("--head") + 1];
        if (head === "coordinator/research/PVTI_x") {
          return ghOk(
            JSON.stringify([{ number: 100, state: "OPEN", url: "u/100" }]),
          );
        }
        if (head === "coordinator/dev/PVTI_x") {
          return ghOk(
            JSON.stringify([{ number: 101, state: "OPEN", url: "u/101" }]),
          );
        }
      }
      return ghOk();
    });
    const git = vi.fn(async (args: readonly string[]) => {
      calls.push({ tool: "git", args });
      return ghOk();
    });

    const finalizer = createApprovalFinalizer({
      gh,
      git,
      cacheDirFor: () => "/cache/r",
    });
    const result = await finalizer.finalize(baseEvent);

    expect(result.merged.mainPrNumber).toBe(101);
    expect(result.closed.supersededPrNumber).toBe(100);
    // gh pr merge for dev PR
    expect(
      calls.find(
        (c) => c.tool === "gh" && c.args[0] === "pr" && c.args[1] === "merge",
      )?.args,
    ).toEqual(
      expect.arrayContaining(["merge", "101", "--squash", "--delete-branch"]),
    );
    // gh pr close for research PR
    expect(
      calls.find(
        (c) => c.tool === "gh" && c.args[0] === "pr" && c.args[1] === "close",
      )?.args,
    ).toEqual(expect.arrayContaining(["close", "100"]));
  });

  it("squash-merges research PR alone when no dev PR exists", async () => {
    const gh = vi.fn(async (args: readonly string[]) => {
      if (args[0] === "pr" && args[1] === "list") {
        const head = args[args.indexOf("--head") + 1];
        if (head === "coordinator/research/PVTI_x") {
          return ghOk(JSON.stringify([{ number: 50, state: "OPEN" }]));
        }
        return ghOk("[]");
      }
      return ghOk();
    });
    const git = vi.fn(async () => ghOk());
    const finalizer = createApprovalFinalizer({
      gh,
      git,
      cacheDirFor: () => "/cache/r",
    });
    const result = await finalizer.finalize(baseEvent);
    expect(result.merged.mainPrNumber).toBe(50);
    expect(result.closed.supersededPrNumber).toBeUndefined();
  });

  it("throws when neither PR exists for the item", async () => {
    const gh = vi.fn(async () => ghOk("[]"));
    const git = vi.fn(async () => ghOk());
    const finalizer = createApprovalFinalizer({
      gh,
      git,
      cacheDirFor: () => "/cache/r",
    });
    await expect(finalizer.finalize(baseEvent)).rejects.toThrow(/no PR/i);
  });
});
