import { describe, expect, it, vi } from "vitest";
import { ensureAgentNetwork, AGENT_NETWORK_NAME } from "./agentNetwork.js";
import type { DockerRunner } from "./buildImageCommand.js";

describe("ensureAgentNetwork", () => {
  it("does nothing when `docker network inspect` succeeds", async () => {
    const docker: DockerRunner = vi.fn().mockResolvedValueOnce({
      stdout: "[{}]",
      stderr: "",
      exitCode: 0,
    });
    await ensureAgentNetwork({ docker });
    expect(docker).toHaveBeenCalledOnce();
    expect((docker as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toEqual([
      "network",
      "inspect",
      AGENT_NETWORK_NAME,
    ]);
  });

  it("creates the network with ICC disabled when inspect fails", async () => {
    const docker: DockerRunner = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "", stderr: "no", exitCode: 1 })
      .mockResolvedValueOnce({ stdout: "id", stderr: "", exitCode: 0 });
    await ensureAgentNetwork({ docker });
    expect(docker).toHaveBeenCalledTimes(2);
    const createArgs = (docker as ReturnType<typeof vi.fn>).mock.calls[1]![0];
    expect(createArgs[0]).toBe("network");
    expect(createArgs[1]).toBe("create");
    expect(createArgs).toContain("--driver");
    expect(createArgs).toContain("bridge");
    expect(createArgs).toContain("--opt");
    expect(createArgs).toContain("com.docker.network.bridge.enable_icc=false");
    expect(createArgs[createArgs.length - 1]).toBe(AGENT_NETWORK_NAME);
  });

  it("throws when network create itself fails", async () => {
    const docker: DockerRunner = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "", stderr: "no", exitCode: 1 })
      .mockResolvedValueOnce({
        stdout: "",
        stderr: "permission denied",
        exitCode: 1,
      });
    await expect(ensureAgentNetwork({ docker })).rejects.toThrow(
      /permission denied/,
    );
  });
});
