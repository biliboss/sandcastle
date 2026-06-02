/**
 * `coordinator build-image` — builds the shared `coordinator/agent-base`
 * image locally from `src/coordinator/docker/Dockerfile` (see ADR 0018).
 *
 * No registry. Each coordinator host builds locally on demand.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export const AGENT_BASE_IMAGE_TAG = "coordinator/agent-base";

export interface DockerRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type DockerRunner = (
  args: readonly string[],
) => Promise<DockerRunResult>;

const defaultDocker: DockerRunner = async (args) => {
  try {
    const { stdout, stderr } = await execFileP("docker", [...args], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? String(err),
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
};

export const runBuildImageCommand = async (deps: {
  docker?: DockerRunner;
  dockerfileDir: string;
  hostUid?: number;
  hostGid?: number;
}): Promise<void> => {
  const docker = deps.docker ?? defaultDocker;
  const hostUid = deps.hostUid ?? process.getuid?.() ?? 1000;
  const hostGid = deps.hostGid ?? process.getgid?.() ?? 1000;

  const args: string[] = [
    "build",
    "-t",
    AGENT_BASE_IMAGE_TAG,
    "--build-arg",
    `AGENT_UID=${hostUid}`,
    "--build-arg",
    `AGENT_GID=${hostGid}`,
    deps.dockerfileDir,
  ];

  const result = await docker(args);
  if (result.exitCode !== 0) {
    throw new Error(
      `docker build failed (exit ${result.exitCode}): ${result.stderr}`,
    );
  }
};
