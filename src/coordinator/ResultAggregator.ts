/**
 * ResultAggregator — writes a `DispatchResult` back to the Project.
 *
 * - On success: Status → next gate (`Ready for Review (Research)` or
 *   `Ready for Review`), Sandcastle Session field → session path.
 * - On failure: Status rolls back to the trigger status so a human can decide
 *   to retry. Session path still written so logs are reachable.
 */

import type { FetchGraphQL } from "./ProjectPoll.js";
import type { DispatchResult, WorkItemStatus } from "./types.js";

export interface ResultAggregatorConfig {
  readonly projectNodeId: string;
  readonly statusFieldId: string;
  readonly sessionFieldId: string;
  readonly statusOptionIds: Readonly<Record<WorkItemStatus, string>>;
}

export interface ResultAggregator {
  update(
    result: DispatchResult,
    dispatchedFrom: "Researching" | "Doing",
  ): Promise<void>;
}

const SET_OPTION = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }) { projectV2Item { id } }
  }
`;

const SET_TEXT = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $text: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { text: $text }
    }) { projectV2Item { id } }
  }
`;

const nextStatusOnSuccess = (
  dispatchedFrom: "Researching" | "Doing",
): WorkItemStatus =>
  dispatchedFrom === "Researching"
    ? "Ready for Review (Research)"
    : "Ready for Review";

const rollbackStatus = (
  dispatchedFrom: "Researching" | "Doing",
): WorkItemStatus =>
  dispatchedFrom === "Researching" ? "Ready to Research" : "Ready to-do";

export const createResultAggregator = (deps: {
  fetchGraphQL: FetchGraphQL;
  config: ResultAggregatorConfig;
}): ResultAggregator => ({
  async update(result, dispatchedFrom) {
    const target = result.error
      ? rollbackStatus(dispatchedFrom)
      : nextStatusOnSuccess(dispatchedFrom);
    const optionId = deps.config.statusOptionIds[target];
    if (!optionId) {
      throw new Error(
        `Aggregator: no statusOptionId for "${target}" (dispatchedFrom=${dispatchedFrom}, hasError=${!!result.error}). Available keys: ${Object.keys(
          deps.config.statusOptionIds,
        ).join(", ")}`,
      );
    }

    if (result.sessionPath && deps.config.sessionFieldId) {
      await deps.fetchGraphQL(SET_TEXT, {
        projectId: deps.config.projectNodeId,
        itemId: result.itemId,
        fieldId: deps.config.sessionFieldId,
        text: result.sessionPath,
      });
    }
    console.log(
      `[aggregator] flipping ${result.itemId} → ${target} (optionId=${optionId})`,
    );
    await deps.fetchGraphQL(SET_OPTION, {
      projectId: deps.config.projectNodeId,
      itemId: result.itemId,
      fieldId: deps.config.statusFieldId,
      optionId,
    });
  },
});
