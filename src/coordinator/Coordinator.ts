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
import type { ApprovalFinalizer } from "./approvalFinalizer.js";
import type { WorkItemStatus } from "./types.js";

type DispatchTriggerStatus = "Ready to Research" | "Ready to-do";
type DispatchedFrom = "Researching" | "Doing";

const NEXT_STATUS: Record<DispatchTriggerStatus, DispatchedFrom> = {
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
  /** Default profile name per dispatch-trigger status when item lacks label. */
  readonly defaultProfiles: Record<DispatchTriggerStatus, string>;
  /** Finalizer for `Approved` items. Optional; when omitted, Approved items are ignored. */
  readonly finalizer?: Pick<ApprovalFinalizer, "finalize">;
}

export const createCoordinator = (deps: CoordinatorDeps): Coordinator => ({
  async tick() {
    const events = await deps.poll.fetchReadyItems();
    for (const ev of events) {
      if (ev.status === "Approved") {
        if (!deps.finalizer) continue;
        // CAS Approved → Done up front. If the finalizer fails midway we
        // surface the error in the issue comment; the project field still
        // reflects "Done" because the merge is the load-bearing artifact.
        const claimed = await deps.claim.claim(ev.itemId, "Approved", "Done");
        if (!claimed) continue;
        try {
          await deps.finalizer.finalize(ev);
        } catch (err) {
          console.error(
            `[approval finalize error] item=${ev.itemId}: ${(err as Error).message}`,
          );
        }
        continue;
      }

      const from = ev.status as DispatchTriggerStatus;
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
