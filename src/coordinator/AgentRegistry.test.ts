import { describe, expect, it } from "vitest";
import { createAgentRegistry } from "./AgentRegistry.js";
import type { AgentProfile } from "./types.js";
import { claudeCode } from "../AgentProvider.js";
import { noSandbox } from "../sandboxes/no-sandbox.js";

const stubProfile = (): AgentProfile => ({
  agent: claudeCode("claude-opus-4-7"),
  sandbox: () => noSandbox(),
  branchStrategy: { type: "head" },
});

describe("createAgentRegistry", () => {
  it("returns the profile bundle registered for a name", () => {
    const profile = stubProfile();
    const registry = createAgentRegistry({
      profiles: { "claude-fast": profile },
    });
    expect(registry.get("claude-fast")).toBe(profile);
  });

  it("throws when looking up an unknown profile name", () => {
    const registry = createAgentRegistry({ profiles: {} });
    expect(() => registry.get("missing")).toThrow(
      /Unknown agent profile: "missing"/,
    );
  });

  it("lists registered profile names", () => {
    const registry = createAgentRegistry({
      profiles: { a: stubProfile(), b: stubProfile() },
    });
    expect(registry.names().sort()).toEqual(["a", "b"]);
  });
});
