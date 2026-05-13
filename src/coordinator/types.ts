/**
 * Multi-repo coordinator types.
 *
 * The coordinator drives `sandcastle.run()` across many repos from a single
 * GitHub Project (v2). See CONTEXT.md "Coordinator layer (multi-repo)" for
 * the ubiquitous language used here.
 */

import type {
  AgentProvider,
  AnySandboxProvider,
  BranchStrategy,
} from "../index.js";

/**
 * Status values matching the GitHub Project board.
 *
 * Two statuses trigger the coordinator:
 *   - "Ready to Research" → research dispatch
 *   - "Ready to-do" → dev dispatch
 *
 * All other statuses are either human-managed (Inbox, Ready for Review*) or
 * terminal (Done).
 */
export type WorkItemStatus =
  | "Inbox"
  | "Ready to Research"
  | "Researching"
  | "Ready for Review (Research)"
  | "Ready to-do"
  | "Doing"
  | "Ready for Review"
  | "Done";

/** Statuses that cause the coordinator to claim and dispatch an item. */
export const TRIGGER_STATUSES: ReadonlySet<WorkItemStatus> = new Set([
  "Ready to Research",
  "Ready to-do",
]);

/** Status the coordinator transitions an item to when claiming it. */
export const CLAIM_TRANSITIONS: Record<string, WorkItemStatus> = {
  "Ready to Research": "Researching",
  "Ready to-do": "Doing",
};

/**
 * A parsed row from the GitHub Project, ready to dispatch.
 *
 * `agentProfile` is optional because not every item carries the
 * `agent-profile:<name>` label. The dispatcher falls back to a profile
 * derived from the status (research vs dev).
 */
export interface WorkItemEvent {
  /** Project v2 item node ID — used for status CAS. */
  readonly itemId: string;
  /** The status the item was in when the poll picked it up. */
  readonly status: WorkItemStatus;
  /** The issue backing this work item. */
  readonly issue: {
    readonly repo: string;
    readonly number: number;
    readonly title: string;
    readonly body: string;
  };
  /** Optional named profile from an `agent-profile:<name>` label. */
  readonly agentProfile?: string;
}

/**
 * A named bundle of providers + config that the dispatcher uses to invoke
 * `sandcastle.run()`. Users define profiles in `.coordinator/profiles.ts`.
 */
export interface AgentProfile {
  readonly agent: AgentProvider;
  readonly sandbox: () => AnySandboxProvider;
  readonly branchStrategy: BranchStrategy;
  /** Optional per-repo env resolver. */
  readonly env?: (repo: string) => Record<string, string>;
}

/** Result of dispatching one work item. */
export interface DispatchResult {
  readonly itemId: string;
  readonly repo: string;
  readonly sessionPath?: string;
  readonly prUrl?: string;
  readonly error?: Error;
}
