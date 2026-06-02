import { describe, expect, it, vi } from "vitest";
import { createDockerRun } from "./dockerRun.js";
import type { DockerRunner } from "./buildImageCommand.js";
import { claudeCode } from "../AgentProvider.js";
import { noSandbox } from "../sandboxes/no-sandbox.js";

const baseRunArgs = {
  agent: claudeCode("claude-opus-4-7"),
  sandbox: noSandbox(),
  cwd: "/tmp/wt-test",
  prompt: "Write research/x.md with 'ok'",
  branchStrategy: {
    type: "branch" as const,
    branch: "coordinator/test",
  },
  env: { ANTHROPIC_AUTH_TOKEN: "tok-test" },
};

describe("createDockerRun", () => {
  it("docker-runs the agent image, exec's claude, and tears down the container", async () => {
    const docker: DockerRunner = vi.fn(async (args) => {
      if (args[0] === "run") {
        return { stdout: "cont-id-123\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "agent output", stderr: "", exitCode: 0 };
    });

    const dockerRun = createDockerRun({
      image: "coordinator/agent-base",
      network: "agent-net",
      docker,
    });
    const result = await dockerRun(baseRunArgs);

    const calls = (docker as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string[],
    );
    // First call: `docker run -d ... agent-base sleep infinity`
    expect(calls[0]![0]).toBe("run");
    expect(calls[0]).toContain("-d");
    expect(calls[0]).toContain("--rm");
    expect(calls[0]).toContain("coordinator/agent-base");
    expect(calls[0]).toContain("--network");
    expect(calls[0]).toContain("agent-net");
    expect(calls[0]).toContain("-v");
    expect(calls[0]!.some((a) => a === "/tmp/wt-test:/workspace:rw")).toBe(
      true,
    );
    expect(calls[0]).toContain("-e");
    expect(calls[0]).toContain("ANTHROPIC_AUTH_TOKEN=tok-test");

    // At least one `exec` call (git config / claude / commit).
    expect(calls.some((c) => c[0] === "exec")).toBe(true);

    // Final `rm -f` to clean up.
    expect(calls[calls.length - 1]![0]).toBe("rm");
    expect(calls[calls.length - 1]).toContain("-f");

    expect(result.output).toBeDefined();
  });

  it("propagates dispatch failure when an exec step fails", async () => {
    const docker: DockerRunner = vi.fn(async (args) => {
      if (args[0] === "run") {
        return { stdout: "cid", stderr: "", exitCode: 0 };
      }
      if (args[0] === "exec" && args.includes("claude")) {
        return { stdout: "", stderr: "auth error", exitCode: 1 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const dockerRun = createDockerRun({
      image: "x",
      docker,
    });
    await expect(dockerRun(baseRunArgs)).rejects.toThrow(/auth error/);
  });

  it("always tears down the container even when claude fails", async () => {
    const calls: string[][] = [];
    const docker: DockerRunner = vi.fn(async (args) => {
      calls.push([...args]);
      if (args[0] === "run") return { stdout: "cid", stderr: "", exitCode: 0 };
      if (args[0] === "exec" && args.includes("claude")) {
        return { stdout: "", stderr: "boom", exitCode: 1 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const dockerRun = createDockerRun({ image: "x", docker });
    await expect(dockerRun(baseRunArgs)).rejects.toThrow();
    expect(calls[calls.length - 1]![0]).toBe("rm");
  });
});
