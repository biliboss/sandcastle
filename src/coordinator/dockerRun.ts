/**
 * `dockerRun` — coordinator-owned container runner that bypasses Sandcastle's
 * docker provider.
 *
 * Sandcastle's `docker()` provider expects a per-repo image and has a race
 * between `docker run -d` and the subsequent `docker exec` step (the
 * `safe.directory` setup runs before the container's CMD is fully alive).
 * The coordinator already commits to a shared `coordinator/agent-base`
 * image (ADR 0018) and runs the agent against a worktree mounted at
 * `/workspace`, so the docker contract here is small enough to own.
 *
 * Pipeline per dispatch:
 *   1. `docker run -d --rm ... agent-base sleep infinity`
 *   2. `docker exec` to git-config the workspace and run claude
 *   3. `docker rm -f` (cleanup)
 *
 * Output is the agent's stdout. Tests inject a fake `docker` runner.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { SandcastleRunArgs, SandcastleRunFn } from "./Dispatcher.js";
import type { DockerRunner } from "./buildImageCommand.js";

const execFileP = promisify(execFile);

const defaultDocker: DockerRunner = async (args) => {
  try {
    const { stdout, stderr } = await execFileP("docker", [...args], {
      maxBuffer: 128 * 1024 * 1024,
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

export interface DockerRunOptions {
  /** The agent image (default: `coordinator/agent-base`). */
  readonly image?: string;
  readonly network?: string;
  readonly memory?: string;
  readonly cpus?: number;
  readonly tmpfs?: readonly string[];
  /** Extra `-v host:container[:flag]` mounts beyond the worktree. */
  readonly extraMounts?: readonly string[];
  readonly docker?: DockerRunner;
  /** Container name prefix (default: `coordinator-agent`). */
  readonly namePrefix?: string;
}

const newContainerName = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const buildRunArgs = (
  opts: DockerRunOptions,
  args: SandcastleRunArgs,
  containerName: string,
  sessionDir: string | undefined,
): string[] => {
  const hostUid = process.getuid?.() ?? 1000;
  const hostGid = process.getgid?.() ?? 1000;
  const runArgs: string[] = [
    "run",
    "-d",
    "--rm",
    "--name",
    containerName,
    "--user",
    `${hostUid}:${hostGid}`,
    "-v",
    `${args.cwd}:/workspace:rw`,
  ];
  if (sessionDir) {
    // Per-dispatch CLAUDE_CONFIG_DIR mount. The container writes its session
    // jsonl under `/home/agent/.claude/projects/-workspace/<sessionId>.jsonl`
    // — that lands on the host at `<sessionDir>/projects/-workspace/...`,
    // making the agent's turn-by-turn log visible to the dashboard.
    runArgs.push("-v", `${sessionDir}:/home/agent/.claude:rw`);
    runArgs.push("-e", "CLAUDE_CONFIG_DIR=/home/agent/.claude");
  }
  for (const m of opts.extraMounts ?? []) runArgs.push("-v", m);
  for (const [k, v] of Object.entries(args.env ?? {})) {
    runArgs.push("-e", `${k}=${v}`);
  }
  if (opts.network) runArgs.push("--network", opts.network);
  if (opts.memory) runArgs.push("--memory", opts.memory);
  if (typeof opts.cpus === "number") runArgs.push("--cpus", String(opts.cpus));
  for (const t of opts.tmpfs ?? []) runArgs.push("--tmpfs", t);
  runArgs.push(opts.image ?? "coordinator/agent-base");
  runArgs.push("sleep", "infinity");
  return runArgs;
};

const execIn = (containerName: string, cmd: string[]): string[] => [
  "exec",
  "-w",
  "/workspace",
  containerName,
  ...cmd,
];

export const createDockerRun = (opts: DockerRunOptions): SandcastleRunFn => {
  const docker = opts.docker ?? defaultDocker;
  const namePrefix = opts.namePrefix ?? "coordinator-agent";
  return async (args) => {
    const containerName = newContainerName(namePrefix);
    const sessionId = randomUUID();
    const sessionDir = args.sessionDir;
    if (sessionDir) {
      try {
        mkdirSync(sessionDir, { recursive: true });
      } catch {
        // best-effort; the docker bind-mount will create it too on most engines.
      }
    }
    const run = await docker(
      buildRunArgs(opts, args, containerName, sessionDir),
    );
    if (run.exitCode !== 0) {
      throw new Error(`docker run failed: ${run.stderr}`);
    }
    const cleanup = async () => {
      await docker(["rm", "-f", containerName]);
    };
    try {
      // Trust the worktree (host-side uid).
      const trust = await docker(
        execIn(containerName, [
          "git",
          "config",
          "--global",
          "--add",
          "safe.directory",
          "/workspace",
        ]),
      );
      if (trust.exitCode !== 0) {
        throw new Error(`git config (safe.directory) failed: ${trust.stderr}`);
      }
      // Set a stable identity for any commits the agent makes.
      await docker(
        execIn(containerName, [
          "git",
          "config",
          "user.email",
          "coordinator@ai-hero.local",
        ]),
      );
      await docker(
        execIn(containerName, [
          "git",
          "config",
          "user.name",
          "Sandcastle Coordinator",
        ]),
      );
      // Run the agent. We embed the prompt directly — it goes through
      // `docker exec`'s argv, so we don't have to worry about shell escaping
      // inside the container.
      const agentExec = await docker(
        execIn(containerName, [
          "claude",
          "--print",
          "--output-format",
          "text",
          "--dangerously-skip-permissions",
          ...(sessionDir ? ["--session-id", sessionId] : []),
          args.prompt,
        ]),
      );
      if (agentExec.exitCode !== 0) {
        throw new Error(
          `claude failed (exit ${agentExec.exitCode}): ${agentExec.stderr || agentExec.stdout}`,
        );
      }
      // Claude Code encodes the cwd into the project dirname by replacing
      // `/` with `-`. Container cwd is `/workspace`, so the encoded form is
      // `-workspace`. The session jsonl lands at:
      //   <sessionDir>/projects/-workspace/<sessionId>.jsonl
      const sessionPath = sessionDir
        ? `${sessionDir}/projects/-workspace/${sessionId}.jsonl`
        : undefined;
      return {
        output: agentExec.stdout,
        ...(sessionPath ? { sessionPath } : {}),
      };
    } finally {
      await cleanup();
    }
  };
};
