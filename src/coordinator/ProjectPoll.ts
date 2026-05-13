/**
 * ProjectPoll — reads work items from a GitHub Project (v2) and parses them
 * into `WorkItemEvent`s ready for dispatch.
 *
 * GraphQL transport is injected via `fetchGraphQL` so tests can pass a fake
 * and production can wire `gh api graphql`.
 */

import type { WorkItemEvent, WorkItemStatus } from "./types.js";
import { TRIGGER_STATUSES } from "./types.js";

export type FetchGraphQL = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<any>;

export interface ProjectPollConfig {
  readonly projectNodeId: string;
  readonly statusFieldId: string;
}

export interface ProjectPoll {
  fetchReadyItems(): Promise<WorkItemEvent[]>;
}

const ITEMS_QUERY = `
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 100) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            fieldValues(first: 20) {
              nodes {
                __typename
                ... on ProjectV2ItemFieldSingleSelectValue {
                  field { ... on ProjectV2SingleSelectField { id name } }
                  name
                }
                ... on ProjectV2ItemFieldTextValue {
                  field { ... on ProjectV2Field { name } }
                  text
                }
              }
            }
            content {
              __typename
              ... on Issue {
                number
                title
                body
                repository { nameWithOwner }
                labels(first: 20) { nodes { name } }
              }
            }
          }
        }
      }
    }
  }
`;

const findStatus = (
  fieldValues: any,
  statusFieldId: string,
): WorkItemStatus | undefined => {
  for (const v of fieldValues?.nodes ?? []) {
    if (
      v.__typename === "ProjectV2ItemFieldSingleSelectValue" &&
      v.field?.id === statusFieldId
    ) {
      return v.name as WorkItemStatus;
    }
  }
  return undefined;
};

export const createProjectPoll = (deps: {
  fetchGraphQL: FetchGraphQL;
  config: ProjectPollConfig;
}): ProjectPoll => ({
  async fetchReadyItems(): Promise<WorkItemEvent[]> {
    const data = await deps.fetchGraphQL(ITEMS_QUERY, {
      projectId: deps.config.projectNodeId,
    });
    const nodes = data?.node?.items?.nodes ?? [];
    const events: WorkItemEvent[] = [];
    for (const node of nodes) {
      const status = findStatus(node.fieldValues, deps.config.statusFieldId);
      if (!status) continue;
      if (!TRIGGER_STATUSES.has(status)) continue;
      const content = node.content;
      if (content?.__typename !== "Issue") continue;
      const labels: string[] =
        content.labels?.nodes?.map((l: { name: string }) => l.name) ?? [];
      const profileLabel = labels.find((n) => n.startsWith("agent-profile:"));
      const agentProfile = profileLabel?.slice("agent-profile:".length);
      events.push({
        itemId: node.id,
        status,
        issue: {
          repo: content.repository.nameWithOwner,
          number: content.number,
          title: content.title,
          body: content.body,
        },
        ...(agentProfile ? { agentProfile } : {}),
      });
    }
    return events;
  },
});
