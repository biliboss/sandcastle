/**
 * Public entry for the multi-repo coordinator layer.
 *
 * Import this subpath to build a custom coordinator from JS, or use the
 * `coordinator` CLI (which wires the same pieces).
 */

export { createProjectPoll } from "./ProjectPoll.js";
export type {
  ProjectPoll,
  ProjectPollConfig,
  FetchGraphQL,
} from "./ProjectPoll.js";

export { createGhFetchGraphQL } from "./ghFetchGraphQL.js";
export type { Spawn, SpawnResult } from "./ghFetchGraphQL.js";

export { createAgentRegistry } from "./AgentRegistry.js";
export type { AgentRegistry } from "./AgentRegistry.js";

export { createRepoCache } from "./RepoCache.js";
export type { RepoCache, GitRunner } from "./RepoCache.js";

export { createClaimItem } from "./claimItem.js";
export type { ClaimItem, ClaimItemConfig } from "./claimItem.js";

export { createDispatcher } from "./Dispatcher.js";
export type {
  Dispatcher,
  DispatcherDeps,
  SandcastleRunFn,
  SandcastleRunArgs,
} from "./Dispatcher.js";

export { createResultAggregator } from "./ResultAggregator.js";
export type {
  ResultAggregator,
  ResultAggregatorConfig,
} from "./ResultAggregator.js";

export { createCoordinator } from "./Coordinator.js";
export type { Coordinator, CoordinatorDeps } from "./Coordinator.js";

export { runStartLoop, realSleep } from "./startCommand.js";
export { runInitCommand } from "./initCommand.js";

export type {
  WorkItemEvent,
  WorkItemStatus,
  AgentProfile,
  DispatchResult,
} from "./types.js";
export { TRIGGER_STATUSES, CLAIM_TRANSITIONS } from "./types.js";
