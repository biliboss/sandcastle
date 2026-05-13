import { describe, expect, it, vi } from "vitest";
import { createProjectPoll } from "./ProjectPoll.js";
import type { FetchGraphQL } from "./ProjectPoll.js";

const baseConfig = {
  projectNodeId: "PVT_kwHOABZNT84BXCg7",
  statusFieldId: "PVTSSF_lAHOABZNT84BXCg7zhSSLps",
};

/** Build a fake GraphQL response with one project item. */
const fakeResponseWithOneItem = (status: string) => ({
  node: {
    items: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        {
          id: "PVTI_lAHOABZNT84BXCg7zga1",
          fieldValues: {
            nodes: [
              {
                __typename: "ProjectV2ItemFieldSingleSelectValue",
                field: { id: baseConfig.statusFieldId, name: "Status" },
                name: status,
              },
              {
                __typename: "ProjectV2ItemFieldTextValue",
                field: { name: "Repository" },
                text: "https://github.com/mktvirtual/muki-bot",
              },
            ],
          },
          content: {
            __typename: "Issue",
            number: 42,
            title: "feat(agent): example",
            body: "Body of issue",
            repository: { nameWithOwner: "mktvirtual/muki-bot" },
            labels: { nodes: [] },
          },
        },
      ],
    },
  },
});

/** Build a response with multiple items, one per provided status. */
const fakeResponseWithStatuses = (statuses: string[]) => ({
  node: {
    items: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: statuses.map((status, i) => ({
        id: `PVTI_item_${i}`,
        fieldValues: {
          nodes: [
            {
              __typename: "ProjectV2ItemFieldSingleSelectValue",
              field: { id: baseConfig.statusFieldId, name: "Status" },
              name: status,
            },
          ],
        },
        content: {
          __typename: "Issue",
          number: i,
          title: `t${i}`,
          body: "",
          repository: { nameWithOwner: "o/r" },
          labels: { nodes: [] },
        },
      })),
    },
  },
});

describe("createProjectPoll.fetchReadyItems", () => {
  it("parses one ready-to-do item into a WorkItemEvent", async () => {
    const fetchGraphQL: FetchGraphQL = vi
      .fn()
      .mockResolvedValue(fakeResponseWithOneItem("Ready to-do"));

    const poll = createProjectPoll({ fetchGraphQL, config: baseConfig });
    const events = await poll.fetchReadyItems();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      itemId: "PVTI_lAHOABZNT84BXCg7zga1",
      status: "Ready to-do",
      issue: {
        repo: "mktvirtual/muki-bot",
        number: 42,
        title: "feat(agent): example",
        body: "Body of issue",
      },
    });
  });

  it("filters out items in non-trigger statuses", async () => {
    const fetchGraphQL: FetchGraphQL = vi
      .fn()
      .mockResolvedValue(
        fakeResponseWithStatuses([
          "Inbox",
          "Ready to Research",
          "Researching",
          "Ready for Review (Research)",
          "Ready to-do",
          "Doing",
          "Ready for Review",
          "Done",
        ]),
      );
    const poll = createProjectPoll({ fetchGraphQL, config: baseConfig });
    const events = await poll.fetchReadyItems();
    const statuses = events.map((e: { status: string }) => e.status);
    expect(statuses).toEqual(["Ready to Research", "Ready to-do"]);
  });

  it("skips items whose content is a DraftIssue (no backing repo)", async () => {
    const fetchGraphQL: FetchGraphQL = vi.fn().mockResolvedValue({
      node: {
        items: {
          nodes: [
            {
              id: "PVTI_draft",
              fieldValues: {
                nodes: [
                  {
                    __typename: "ProjectV2ItemFieldSingleSelectValue",
                    field: { id: baseConfig.statusFieldId, name: "Status" },
                    name: "Ready to-do",
                  },
                ],
              },
              content: {
                __typename: "DraftIssue",
                title: "draft",
                body: "",
              },
            },
          ],
        },
      },
    });
    const poll = createProjectPoll({ fetchGraphQL, config: baseConfig });
    expect(await poll.fetchReadyItems()).toEqual([]);
  });

  it("returns empty array when no items present", async () => {
    const fetchGraphQL: FetchGraphQL = vi
      .fn()
      .mockResolvedValue({ node: { items: { nodes: [] } } });
    const poll = createProjectPoll({ fetchGraphQL, config: baseConfig });
    expect(await poll.fetchReadyItems()).toEqual([]);
  });

  it("extracts agent profile from a `agent-profile:<name>` label", async () => {
    const fetchGraphQL: FetchGraphQL = vi.fn().mockResolvedValue({
      node: {
        items: {
          nodes: [
            {
              id: "PVTI_x",
              fieldValues: {
                nodes: [
                  {
                    __typename: "ProjectV2ItemFieldSingleSelectValue",
                    field: { id: baseConfig.statusFieldId, name: "Status" },
                    name: "Ready to-do",
                  },
                ],
              },
              content: {
                __typename: "Issue",
                number: 1,
                title: "t",
                body: "",
                repository: { nameWithOwner: "o/r" },
                labels: {
                  nodes: [
                    { name: "bug" },
                    { name: "agent-profile:claude-opus-fast" },
                  ],
                },
              },
            },
          ],
        },
      },
    });
    const poll = createProjectPoll({ fetchGraphQL, config: baseConfig });
    const events = await poll.fetchReadyItems();
    expect(events[0]?.agentProfile).toBe("claude-opus-fast");
  });

  it("leaves agentProfile undefined when no profile label present", async () => {
    const fetchGraphQL: FetchGraphQL = vi
      .fn()
      .mockResolvedValue(fakeResponseWithOneItem("Ready to-do"));
    const poll = createProjectPoll({ fetchGraphQL, config: baseConfig });
    const events = await poll.fetchReadyItems();
    expect(events[0]?.agentProfile).toBeUndefined();
  });
});
