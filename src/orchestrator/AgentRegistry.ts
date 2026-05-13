/**
 * AgentRegistry — resolves a profile name (from the Project's `Agent Profile`
 * field or label) to a concrete bundle of `(agent, sandbox, branchStrategy,
 * env)` that the dispatcher passes to `sandcastle.run()`.
 */

import type { AgentProfile } from "./types.js";

export interface AgentRegistry {
  get(name: string): AgentProfile;
  names(): string[];
}

export const createAgentRegistry = (deps: {
  profiles: Record<string, AgentProfile>;
}): AgentRegistry => ({
  get(name) {
    const profile = deps.profiles[name];
    if (!profile) {
      throw new Error(`Unknown agent profile: "${name}"`);
    }
    return profile;
  },
  names() {
    return Object.keys(deps.profiles);
  },
});
