import { describe, expect, it, vi } from "vitest";
import { createDispatcher } from "./Dispatcher.js";
import type { AgentProfile, WorkItemEvent } from "./types.js";
import { claudeCode } from "../AgentProvider.js";
import { noSandbox } from "../sandboxes/no-sandbox.js";

const stubProfile = (): AgentProfile => ({
  agent: claudeCode("claude-opus-4-7"),
  sandbox: () => noSandbox(),
  branchStrategy: { type: "head" },
});

const stubEvent = (overrides: Partial<WorkItemEvent> = {}): WorkItemEvent => ({
  itemId: "PVTI_a",
  status: "Ready to-do",
  issue: {
    repo: "mktvirtual/muki-bot",
    number: 7,
    title: "ex",
    body: "Do something",
  },
  ...overrides,
});

describe("createDispatcher.dispatch", () => {
  it("ensures the repo cache and invokes sandcastle.run() with the profile bundle", async () => {
    const ensureFresh = vi
      .fn()
      .mockResolvedValue("/cache/mktvirtual__muki-bot.git");
    const sandcastleRun = vi.fn().mockResolvedValue({
      iterations: [],
      completionSignal: undefined,
      output: "",
    });

    const dispatcher = createDispatcher({
      repoCache: { ensureFresh },
      sandcastleRun,
      sessionDir: "/sessions",
    });

    const profile = stubProfile();
    const result = await dispatcher.dispatch(stubEvent(), profile);

    expect(ensureFresh).toHaveBeenCalledWith("mktvirtual/muki-bot");
    expect(sandcastleRun).toHaveBeenCalledOnce();
    const runArgs = sandcastleRun.mock.calls[0]![0];
    expect(runArgs.agent).toBe(profile.agent);
    expect(runArgs.cwd).toBe("/cache/mktvirtual__muki-bot.git");
    expect(runArgs.prompt).toBe("Do something");
    expect(runArgs.branchStrategy).toEqual(profile.branchStrategy);
    expect(result.repo).toBe("mktvirtual/muki-bot");
    expect(result.itemId).toBe("PVTI_a");
    expect(result.error).toBeUndefined();
  });

  it("captures errors instead of throwing", async () => {
    const ensureFresh = vi.fn().mockResolvedValue("/cache/o__r.git");
    const sandcastleRun = vi.fn().mockRejectedValue(new Error("agent timeout"));

    const dispatcher = createDispatcher({
      repoCache: { ensureFresh },
      sandcastleRun,
      sessionDir: "/sessions",
    });

    const result = await dispatcher.dispatch(
      stubEvent({ issue: { repo: "o/r", number: 1, title: "t", body: "b" } }),
      stubProfile(),
    );
    expect(result.error?.message).toBe("agent timeout");
    expect(result.prUrl).toBeUndefined();
  });

  it("passes profile env into run() when supplied", async () => {
    const ensureFresh = vi.fn().mockResolvedValue("/cache/o__r.git");
    const sandcastleRun = vi
      .fn()
      .mockResolvedValue({ iterations: [], output: "" });
    const profile: AgentProfile = {
      ...stubProfile(),
      env: (repo) => ({ REPO_TAG: repo }),
    };
    const dispatcher = createDispatcher({
      repoCache: { ensureFresh },
      sandcastleRun,
      sessionDir: "/sessions",
    });
    await dispatcher.dispatch(
      stubEvent({ issue: { repo: "o/r", number: 1, title: "t", body: "b" } }),
      profile,
    );
    expect(sandcastleRun.mock.calls[0]![0].env).toEqual({ REPO_TAG: "o/r" });
  });
});
