import { describe, expect, it, vi } from "vitest";
import {
  runBuildImageCommand,
  AGENT_BASE_IMAGE_TAG,
} from "./buildImageCommand.js";
import type { DockerRunner } from "./buildImageCommand.js";

describe("runBuildImageCommand", () => {
  it("invokes `docker build -t coordinator/agent-base <dockerfileDir>`", async () => {
    const docker: DockerRunner = vi
      .fn()
      .mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await runBuildImageCommand({
      docker,
      dockerfileDir: "/tmp/dockerfile-dir",
    });
    expect(docker).toHaveBeenCalledOnce();
    const [args] = (docker as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(args[0]).toBe("build");
    expect(args).toContain("-t");
    expect(args).toContain(AGENT_BASE_IMAGE_TAG);
    expect(args[args.length - 1]).toBe("/tmp/dockerfile-dir");
  });

  it("forwards host UID/GID as build args by default", async () => {
    const docker: DockerRunner = vi
      .fn()
      .mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await runBuildImageCommand({
      docker,
      dockerfileDir: "/d",
      hostUid: 501,
      hostGid: 20,
    });
    const [args] = (docker as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(args).toContain("--build-arg");
    expect(args).toContain("AGENT_UID=501");
    expect(args).toContain("AGENT_GID=20");
  });

  it("throws when docker exits non-zero", async () => {
    const docker: DockerRunner = vi
      .fn()
      .mockResolvedValue({ stdout: "", stderr: "bad", exitCode: 1 });
    await expect(
      runBuildImageCommand({ docker, dockerfileDir: "/d" }),
    ).rejects.toThrow(/docker build/);
  });
});
