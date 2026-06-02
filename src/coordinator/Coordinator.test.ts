import { describe, expect, it, vi } from "vitest";
import { createCoordinator } from "./Coordinator.js";
import type { WorkItemEvent, AgentProfile } from "./types.js";
import { claudeCode } from "../AgentProvider.js";
import { noSandbox } from "../sandboxes/no-sandbox.js";

const stubProfile = (_name: string): AgentProfile => ({
  agent: claudeCode("claude-opus-4-7"),
  sandbox: () => noSandbox(),
  branchStrategy: { type: "head" },
});

const eventInStatus = (
  itemId: string,
  status: "Ready to Research" | "Ready to-do",
): WorkItemEvent => ({
  itemId,
  status,
  issue: { repo: "o/r", number: 1, title: "t", body: "b" },
});

describe("createCoordinator.tick", () => {
  it("polls, claims each item, dispatches, and aggregates", async () => {
    const poll = {
      fetchReadyItems: vi
        .fn()
        .mockResolvedValue([eventInStatus("a", "Ready to-do")]),
    };
    const claim = { claim: vi.fn().mockResolvedValue(true) };
    const dispatcher = {
      dispatch: vi.fn().mockResolvedValue({
        itemId: "a",
        repo: "o/r",
        sessionPath: "/s/a",
      }),
    };
    const aggregator = { update: vi.fn().mockResolvedValue(undefined) };
    const profile = stubProfile("dev");
    const registry = {
      get: vi.fn().mockReturnValue(profile),
      names: () => ["dev"],
    };

    const coord = createCoordinator({
      poll,
      claim,
      dispatcher,
      aggregator,
      registry,
      defaultProfiles: {
        "Ready to Research": "research",
        "Ready to-do": "dev",
      },
    });
    await coord.tick();
    await coord.drain();

    expect(poll.fetchReadyItems).toHaveBeenCalledOnce();
    expect(claim.claim).toHaveBeenCalledWith("a", "Ready to-do", "Doing");
    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
    expect(dispatcher.dispatch.mock.calls[0]![1]).toBe(profile);
    expect(aggregator.update).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "a" }),
      "Doing",
    );
  });

  it("skips dispatch when claim CAS returns false", async () => {
    const poll = {
      fetchReadyItems: vi
        .fn()
        .mockResolvedValue([eventInStatus("a", "Ready to-do")]),
    };
    const claim = { claim: vi.fn().mockResolvedValue(false) };
    const dispatcher = { dispatch: vi.fn() };
    const aggregator = { update: vi.fn() };
    const profile = stubProfile("dev");
    const registry = {
      get: vi.fn().mockReturnValue(profile),
      names: () => ["dev"],
    };

    const coord = createCoordinator({
      poll,
      claim,
      dispatcher,
      aggregator,
      registry,
      defaultProfiles: {
        "Ready to Research": "research",
        "Ready to-do": "dev",
      },
    });
    await coord.tick();

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(aggregator.update).not.toHaveBeenCalled();
  });

  it("uses the per-item agentProfile label when present, falling back to status default", async () => {
    const poll = {
      fetchReadyItems: vi.fn().mockResolvedValue([
        {
          ...eventInStatus("a", "Ready to-do"),
          agentProfile: "custom",
        },
      ]),
    };
    const claim = { claim: vi.fn().mockResolvedValue(true) };
    const dispatcher = {
      dispatch: vi.fn().mockResolvedValue({
        itemId: "a",
        repo: "o/r",
        sessionPath: "/s",
      }),
    };
    const aggregator = { update: vi.fn().mockResolvedValue(undefined) };
    const profile = stubProfile("custom");
    const registry = {
      get: vi.fn().mockReturnValue(profile),
      names: () => ["custom", "dev"],
    };

    const coord = createCoordinator({
      poll,
      claim,
      dispatcher,
      aggregator,
      registry,
      defaultProfiles: {
        "Ready to Research": "research",
        "Ready to-do": "dev",
      },
    });
    await coord.tick();
    await coord.drain();
    expect(registry.get).toHaveBeenCalledWith("custom");
  });
});
