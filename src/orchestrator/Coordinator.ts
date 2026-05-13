/**
 * Coordinator — wires ProjectPoll, ClaimItem, Dispatcher, ResultAggregator,
 * AgentRegistry into a single `tick()` that drains ready work items.
 *
 * Per CONTEXT.md: the Coordinator is stateless except for the Project itself.
 * The host process calls `tick()` on a schedule (or in a loop) until SIGINT.
 */

import type { ProjectPoll } from "./ProjectPoll.js";
import type { ClaimItem } from "./claimItem.js";
import type { Dispatcher } from "./Dispatcher.js";
import type { ResultAggregator } from "./ResultAggregator.js";
import type { AgentRegistry } from "./AgentRegistry.js";
import type { WorkItemStatus } from "./types.js";

type TriggerStatus = "Ready to Research" | "Ready to-do";
type DispatchedFrom = "Researching" | "Doing";

const NEXT_STATUS: Record<TriggerStatus, DispatchedFrom> = {
  "Ready to Research": "Researching",
  "Ready to-do": "Doing",
};

export interface Coordinator {
  tick(): Promise<void>;
}

export interface CoordinatorDeps {
  readonly poll: Pick<ProjectPoll, "fetchReadyItems">;
  readonly claim: Pick<ClaimItem, "claim">;
  readonly dispatcher: Pick<Dispatcher, "dispatch">;
  readonly aggregator: Pick<ResultAggregator, "update">;
  readonly registry: Pick<AgentRegistry, "get" | "names">;
  /** Default profile name per trigger status when item carries no label. */
  readonly defaultProfiles: Record<TriggerStatus, string>;
}

export const createCoordinator = (deps: CoordinatorDeps): Coordinator => ({
  async tick() {
    const events = await deps.poll.fetchReadyItems();
    for (const ev of events) {
      const from = ev.status as TriggerStatus;
      const to = NEXT_STATUS[from];
      if (!to) continue;
      const claimed = await deps.claim.claim(
        ev.itemId,
        from,
        to as WorkItemStatus,
      );
      if (!claimed) continue;

      const profileName = ev.agentProfile ?? deps.defaultProfiles[from];
      const profile = deps.registry.get(profileName);
      const result = await deps.dispatcher.dispatch(ev, profile);
      await deps.aggregator.update(result, to);
    }
  },
});
