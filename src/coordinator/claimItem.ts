/**
 * claimItem — atomic Status field transition via GraphQL.
 *
 * GitHub Projects v2 doesn't expose true CAS, so we approximate:
 *   1. Re-read the item's current Status.
 *   2. If it matches the expected `fromStatus`, fire the update mutation.
 *   3. Return false otherwise — another coordinator claimed it.
 *
 * Tight race remains between step 1 and step 2; acceptable for a coordinator
 * that polls every N seconds. For stricter guarantees, add a Lock field.
 */

import type { FetchGraphQL } from "./ProjectPoll.js";
import type { WorkItemStatus } from "./types.js";

export interface ClaimItemConfig {
  readonly projectNodeId: string;
  readonly statusFieldId: string;
  readonly statusOptionIds: Readonly<Record<WorkItemStatus, string>>;
}

export interface ClaimItem {
  claim(
    itemId: string,
    fromStatus: WorkItemStatus,
    toStatus: WorkItemStatus,
  ): Promise<boolean>;
}

const READ_QUERY = `
  query($itemId: ID!) {
    node(id: $itemId) {
      ... on ProjectV2Item {
        fieldValueByName(name: "Status") {
          ... on ProjectV2ItemFieldSingleSelectValue { name }
        }
      }
    }
  }
`;

const UPDATE_MUTATION = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }) {
      projectV2Item { id }
    }
  }
`;

export const createClaimItem = (deps: {
  fetchGraphQL: FetchGraphQL;
  config: ClaimItemConfig;
}): ClaimItem => ({
  async claim(itemId, fromStatus, toStatus) {
    const current = await deps.fetchGraphQL(READ_QUERY, { itemId });
    const observed = current?.node?.fieldValueByName?.name;
    if (observed !== fromStatus) return false;

    const optionId = deps.config.statusOptionIds[toStatus];
    if (!optionId) {
      throw new Error(`Missing status option id for "${toStatus}"`);
    }
    await deps.fetchGraphQL(UPDATE_MUTATION, {
      projectId: deps.config.projectNodeId,
      itemId,
      fieldId: deps.config.statusFieldId,
      optionId,
    });
    return true;
  },
});
