/**
 * `ensureAgentNetwork` — idempotently provisions the `agent-net` bridge
 * (ICC disabled). See ADR 0022.
 *
 * Coordinator calls this before the first dispatch. Subsequent runs are
 * no-ops because `docker network inspect agent-net` succeeds.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DockerRunner } from "./buildImageCommand.js";

const execFileP = promisify(execFile);

export const AGENT_NETWORK_NAME = "agent-net";

const defaultDocker: DockerRunner = async (args) => {
  try {
    const { stdout, stderr } = await execFileP("docker", [...args]);
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? String(err),
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
};

export const ensureAgentNetwork = async (deps?: {
  docker?: DockerRunner;
}): Promise<void> => {
  const docker = deps?.docker ?? defaultDocker;
  const inspect = await docker(["network", "inspect", AGENT_NETWORK_NAME]);
  if (inspect.exitCode === 0) return;

  const create = await docker([
    "network",
    "create",
    "--driver",
    "bridge",
    "--opt",
    "com.docker.network.bridge.enable_icc=false",
    AGENT_NETWORK_NAME,
  ]);
  if (create.exitCode !== 0) {
    throw new Error(
      `docker network create ${AGENT_NETWORK_NAME} failed: ${create.stderr}`,
    );
  }
};
