/**
 * Coordinator — wires ProjectPoll, ClaimItem, Dispatcher, ResultAggregator,
 * AgentRegistry into a `tick()` that polls + claims + kicks dispatches.
 *
 * **Tick model (post 2026-05-13 redesign):** `tick()` is fast — it polls,
 * claims items via CAS, and fires dispatches as detached promises. It does
 * NOT await dispatch completion. Next `tick()` happens every pollIntervalMs
 * regardless of in-flight work. An internal `inflight` set caps concurrency
 * (default 4) — if at the cap, the tick simply skips claiming new items
 * this round; the next tick tries again. See `memory/coord_tick_model.md`.
 */

import type { ProjectPoll } from "./ProjectPoll.js";
import type { ClaimItem } from "./claimItem.js";
import type { Dispatcher } from "./Dispatcher.js";
import type { ResultAggregator } from "./ResultAggregator.js";
import type { AgentRegistry } from "./AgentRegistry.js";
import type { ApprovalFinalizer } from "./approvalFinalizer.js";
import type { WorkItemEvent, WorkItemStatus } from "./types.js";
import type { EventSink } from "./events.js";
import { nullSink } from "./events.js";

type DispatchTriggerStatus = "Ready to Research" | "Ready to-do";
type DispatchedFrom = "Researching" | "Doing";

const NEXT_STATUS: Record<DispatchTriggerStatus, DispatchedFrom> = {
  "Ready to Research": "Researching",
  "Ready to-do": "Doing",
};

export const DEFAULT_MAX_CONCURRENT = 4;

export interface Coordinator {
  tick(): Promise<void>;
  /** Current in-flight count. Exposed for tests + diagnostics. */
  readonly inflightCount: () => number;
  /** Awaits all currently in-flight dispatches. Mainly useful for tests. */
  drain(): Promise<void>;
}

export interface CoordinatorDeps {
  readonly poll: Pick<ProjectPoll, "fetchReadyItems">;
  readonly claim: Pick<ClaimItem, "claim">;
  readonly dispatcher: Pick<Dispatcher, "dispatch">;
  readonly aggregator: Pick<ResultAggregator, "update">;
  readonly registry: Pick<AgentRegistry, "get" | "names">;
  /** Default profile name per dispatch-trigger status when item lacks label. */
  readonly defaultProfiles: Record<DispatchTriggerStatus, string>;
  /**
   * Optional per-event override. Takes precedence over the
   * `agent-profile:<name>` label and `defaultProfiles`. Returning `undefined`
   * falls back to label → default. Used for routing by repo/org.
   */
  readonly resolveProfile?: (event: WorkItemEvent) => string | undefined;
  /** Finalizer for `Approved` items. Optional; when omitted, Approved items are ignored. */
  readonly finalizer?: Pick<ApprovalFinalizer, "finalize">;
  /** Optional structured-event sink. Defaults to a no-op. */
  readonly events?: EventSink;
  /** Max concurrent dispatches in-flight. Defaults to 4. */
  readonly maxConcurrent?: number;
}

export const createCoordinator = (deps: CoordinatorDeps): Coordinator => {
  const sink = deps.events ?? nullSink;
  const maxConcurrent = deps.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  // Items currently being dispatched (or finalized). Persists across ticks.
  // Used to enforce `maxConcurrent` and avoid double-claim within the same
  // process (the project-status CAS handles cross-process correctness).
  const inflight = new Set<string>();
  /** Active promise handles for in-flight dispatches — used by `drain()`. */
  const inflightPromises = new Set<Promise<void>>();
  const track = (p: Promise<void>): void => {
    inflightPromises.add(p);
    void p.finally(() => inflightPromises.delete(p));
  };

  const runApproval = async (ev: WorkItemEvent): Promise<void> => {
    inflight.add(ev.itemId);
    try {
      await sink.emit({
        type: "item.claimed",
        itemId: ev.itemId,
        from: "Approved",
        to: "Done",
        repo: ev.issue.repo,
        issueNumber: ev.issue.number,
        issueTitle: ev.issue.title,
      });
      await sink.emit({
        type: "finalize.start",
        itemId: ev.itemId,
        repo: ev.issue.repo,
      });
      try {
        const r = await deps.finalizer!.finalize(ev);
        await sink.emit({
          type: "finalize.done",
          itemId: ev.itemId,
          repo: ev.issue.repo,
          mergedPrNumber: r.merged.mainPrNumber,
          ...(r.closed.supersededPrNumber !== undefined
            ? { supersededPrNumber: r.closed.supersededPrNumber }
            : {}),
        });
      } catch (err) {
        const msg = (err as Error).message;
        console.error(`[approval finalize error] item=${ev.itemId}: ${msg}`);
        await sink.emit({
          type: "finalize.done",
          itemId: ev.itemId,
          repo: ev.issue.repo,
          error: msg,
        });
      }
    } finally {
      inflight.delete(ev.itemId);
    }
  };

  const runDispatch = async (
    ev: WorkItemEvent,
    from: DispatchTriggerStatus,
    to: DispatchedFrom,
  ): Promise<void> => {
    inflight.add(ev.itemId);
    try {
      const profileName =
        deps.resolveProfile?.(ev) ??
        ev.agentProfile ??
        deps.defaultProfiles[from];
      const phase: "research" | "dev" =
        from === "Ready to-do" ? "dev" : "research";
      await sink.emit({
        type: "item.claimed",
        itemId: ev.itemId,
        from,
        to,
        repo: ev.issue.repo,
        issueNumber: ev.issue.number,
        issueTitle: ev.issue.title,
      });
      await sink.emit({
        type: "dispatch.start",
        itemId: ev.itemId,
        repo: ev.issue.repo,
        phase,
        profile: profileName,
      });
      const profile = deps.registry.get(profileName);
      const result = await deps.dispatcher.dispatch(ev, profile);
      await sink.emit({
        type: "dispatch.done",
        itemId: ev.itemId,
        repo: ev.issue.repo,
        phase,
        ...(result.prUrl ? { prUrl: result.prUrl } : {}),
        ...(result.sessionPath ? { sessionPath: result.sessionPath } : {}),
        ...(result.error ? { error: result.error.message } : {}),
      });
      await deps.aggregator.update(result, to);
    } catch (err) {
      console.error(
        `[dispatch crash] item=${ev.itemId}: ${(err as Error).message}`,
      );
    } finally {
      inflight.delete(ev.itemId);
    }
  };

  return {
    inflightCount: () => inflight.size,
    async drain() {
      while (inflightPromises.size > 0) {
        await Promise.allSettled([...inflightPromises]);
      }
    },
    async tick() {
      await sink.emit({ type: "tick.start" });
      let acted = 0;
      try {
        const events = await deps.poll.fetchReadyItems();
        for (const ev of events) {
          if (inflight.size >= maxConcurrent) break;
          if (inflight.has(ev.itemId)) continue;

          if (ev.status === "Approved") {
            if (!deps.finalizer) continue;
            const claimed = await deps.claim.claim(
              ev.itemId,
              "Approved",
              "Done",
            );
            if (!claimed) continue;
            acted++;
            // Fire-and-forget: don't await; lets the tick finish fast so the
            // next 30s timer fires on schedule. The promise chain handles its
            // own errors + the `inflight` set tracks active work.
            track(runApproval(ev));
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
          acted++;
          track(runDispatch(ev, from, to));
        }
      } finally {
        await sink.emit({ type: "tick.done", itemCount: acted });
      }
    },
  };
};
