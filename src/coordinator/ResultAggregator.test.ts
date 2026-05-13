import { describe, expect, it, vi } from "vitest";
import { createResultAggregator } from "./ResultAggregator.js";
import type { FetchGraphQL } from "./ProjectPoll.js";
import type { DispatchResult } from "./types.js";

const baseConfig = {
  projectNodeId: "PVT_x",
  statusFieldId: "PVTSSF_status",
  sessionFieldId: "PVTF_session",
  statusOptionIds: {
    "Ready to Research": "opt_rtr",
    Researching: "opt_doing_research",
    "Ready to-do": "opt_rttd",
    Doing: "opt_doing_dev",
    "Ready for Review (Research)": "opt_rfrr",
    "Ready for Review": "opt_rfr",
    Inbox: "opt_inbox",
    Done: "opt_done",
  } as const,
};

describe("createResultAggregator.update", () => {
  it("sets Status to `Ready for Review (Research)` after a successful research dispatch", async () => {
    const fetchGraphQL: FetchGraphQL = vi
      .fn()
      .mockResolvedValue({ updateProjectV2ItemFieldValue: {} });
    const aggregator = createResultAggregator({
      fetchGraphQL,
      config: baseConfig,
    });
    const result: DispatchResult = {
      itemId: "PVTI_a",
      repo: "o/r",
      sessionPath: "/sessions/PVTI_a/o__r",
    };
    await aggregator.update(result, "Researching");

    const calls = (fetchGraphQL as ReturnType<typeof vi.fn>).mock.calls;
    const statusCall = calls.find((c) => (c[1] as any).optionId === "opt_rfrr");
    expect(statusCall).toBeTruthy();
  });

  it("sets Status to `Ready for Review` after a successful dev dispatch", async () => {
    const fetchGraphQL: FetchGraphQL = vi
      .fn()
      .mockResolvedValue({ updateProjectV2ItemFieldValue: {} });
    const aggregator = createResultAggregator({
      fetchGraphQL,
      config: baseConfig,
    });
    await aggregator.update(
      { itemId: "x", repo: "o/r", sessionPath: "/s" },
      "Doing",
    );
    const calls = (fetchGraphQL as ReturnType<typeof vi.fn>).mock.calls;
    expect(
      calls.find((c) => (c[1] as any).optionId === "opt_rfr"),
    ).toBeTruthy();
  });

  it("rolls back Status to `Ready to-do` when dispatch errored from Doing", async () => {
    const fetchGraphQL: FetchGraphQL = vi
      .fn()
      .mockResolvedValue({ updateProjectV2ItemFieldValue: {} });
    const aggregator = createResultAggregator({
      fetchGraphQL,
      config: baseConfig,
    });
    await aggregator.update(
      {
        itemId: "x",
        repo: "o/r",
        sessionPath: "/s",
        error: new Error("boom"),
      },
      "Doing",
    );
    const calls = (fetchGraphQL as ReturnType<typeof vi.fn>).mock.calls;
    expect(
      calls.find((c) => (c[1] as any).optionId === "opt_rttd"),
    ).toBeTruthy();
  });

  it("writes the session path into the Sandcastle Session field", async () => {
    const fetchGraphQL: FetchGraphQL = vi
      .fn()
      .mockResolvedValue({ updateProjectV2ItemFieldValue: {} });
    const aggregator = createResultAggregator({
      fetchGraphQL,
      config: baseConfig,
    });
    await aggregator.update(
      { itemId: "x", repo: "o/r", sessionPath: "/sessions/x/o__r" },
      "Doing",
    );
    const calls = (fetchGraphQL as ReturnType<typeof vi.fn>).mock.calls;
    const sessionCall = calls.find(
      (c) => (c[1] as any).text === "/sessions/x/o__r",
    );
    expect(sessionCall).toBeTruthy();
    expect((sessionCall![1] as any).fieldId).toBe("PVTF_session");
  });
});
