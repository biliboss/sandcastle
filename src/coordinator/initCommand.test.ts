import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInitCommand } from "./initCommand.js";
import type { FetchGraphQL } from "./ProjectPoll.js";

const fakeMetadata = () => ({
  user: {
    projectV2: {
      id: "PVT_kwHOABZNT84BXCg7",
      number: 16,
      fields: {
        nodes: [
          {
            __typename: "ProjectV2SingleSelectField",
            id: "PVTSSF_status",
            name: "Status",
            options: [
              { id: "opt_inbox", name: "Inbox" },
              { id: "opt_rtr", name: "Ready to Research" },
              { id: "opt_doing_research", name: "Researching" },
              { id: "opt_rfrr", name: "Ready for Review (Research)" },
              { id: "opt_rttd", name: "Ready to-do" },
              { id: "opt_doing_dev", name: "Doing" },
              { id: "opt_rfr", name: "Ready for Review" },
              { id: "opt_done", name: "Done" },
            ],
          },
          {
            __typename: "ProjectV2Field",
            id: "PVTF_repo",
            name: "Repository",
          },
        ],
      },
    },
  },
});

describe("runInitCommand", () => {
  it("writes .coordinator/config.json with resolved field ids and status options", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "init-"));
    const fetchGraphQL: FetchGraphQL = vi
      .fn()
      .mockResolvedValue(fakeMetadata());

    await runInitCommand({
      cwd,
      fetchGraphQL,
      projectNumber: 16,
      projectOwner: "biliboss",
    });

    const raw = await readFile(join(cwd, ".coordinator/config.json"), "utf8");
    const config = JSON.parse(raw);
    expect(config.projectNumber).toBe(16);
    expect(config.projectOwner).toBe("biliboss");
    expect(config.projectNodeId).toBe("PVT_kwHOABZNT84BXCg7");
    expect(config.statusFieldId).toBe("PVTSSF_status");
    expect(config.statusOptionIds["Ready to-do"]).toBe("opt_rttd");
    expect(config.statusOptionIds.Done).toBe("opt_done");
  });

  it("throws when the project has no Status field", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "init-"));
    const fetchGraphQL: FetchGraphQL = vi.fn().mockResolvedValue({
      user: { projectV2: { id: "P", number: 1, fields: { nodes: [] } } },
    });
    await expect(
      runInitCommand({
        cwd,
        fetchGraphQL,
        projectNumber: 1,
        projectOwner: "x",
      }),
    ).rejects.toThrow(/Status field/);
  });
});
