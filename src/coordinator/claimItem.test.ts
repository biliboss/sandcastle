import { describe, expect, it, vi } from "vitest";
import { createClaimItem } from "./claimItem.js";
import type { FetchGraphQL } from "./ProjectPoll.js";

const baseConfig = {
  projectNodeId: "PVT_x",
  statusFieldId: "PVTSSF_status",
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

describe("createClaimItem", () => {
  it("issues an updateProjectV2ItemFieldValue mutation when current status matches", async () => {
    const fetchGraphQL: FetchGraphQL = vi
      .fn()
      .mockResolvedValueOnce({
        // verify current status
        node: { fieldValueByName: { name: "Ready to-do" } },
      })
      .mockResolvedValueOnce({
        updateProjectV2ItemFieldValue: { projectV2Item: { id: "x" } },
      });

    const claim = createClaimItem({ fetchGraphQL, config: baseConfig });
    const ok = await claim.claim("PVTI_item", "Ready to-do", "Doing");

    expect(ok).toBe(true);
    expect(fetchGraphQL).toHaveBeenCalledTimes(2);
    const mutationArgs = (fetchGraphQL as ReturnType<typeof vi.fn>).mock
      .calls[1]!;
    const vars = mutationArgs[1] as Record<string, unknown>;
    expect(vars.projectId).toBe("PVT_x");
    expect(vars.itemId).toBe("PVTI_item");
    expect(vars.fieldId).toBe("PVTSSF_status");
    expect(vars.optionId).toBe("opt_doing_dev");
  });

  it("returns false without mutating when current status no longer matches", async () => {
    const fetchGraphQL: FetchGraphQL = vi.fn().mockResolvedValueOnce({
      node: { fieldValueByName: { name: "Doing" } }, // someone else claimed
    });
    const claim = createClaimItem({ fetchGraphQL, config: baseConfig });
    const ok = await claim.claim("PVTI_item", "Ready to-do", "Doing");
    expect(ok).toBe(false);
    expect(fetchGraphQL).toHaveBeenCalledTimes(1);
  });
});
