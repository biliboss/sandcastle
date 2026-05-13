#!/usr/bin/env node
/**
 * `coordinator` CLI entry. Two subcommands so far:
 *   coordinator init --project <n> [--owner <login>]
 *   coordinator start
 *
 * Both read/write `.coordinator/config.json` under the current cwd.
 */

import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { createGhFetchGraphQL } from "./ghFetchGraphQL.js";
import { runInitCommand } from "./initCommand.js";
import {
  runBuildImageCommand,
  AGENT_BASE_IMAGE_TAG,
} from "./buildImageCommand.js";
import { runStartLoop, realSleep } from "./startCommand.js";
import { createProjectPoll } from "./ProjectPoll.js";
import { createClaimItem } from "./claimItem.js";
import { createDispatcher } from "./Dispatcher.js";
import { createResultAggregator } from "./ResultAggregator.js";
import { createAgentRegistry } from "./AgentRegistry.js";
import { createCoordinator } from "./Coordinator.js";
import { createRepoCache } from "./RepoCache.js";
import { ensureAgentNetwork } from "./agentNetwork.js";
import { createGhOpenPR } from "./openPR.js";
import { createGhFetchComments } from "./fetchComments.js";
import { createGhPostComment } from "./postComment.js";
import { createApprovalFinalizer } from "./approvalFinalizer.js";
import { createDockerRun } from "./dockerRun.js";
import { createGhFetchDefaultBranch } from "./fetchDefaultBranch.js";
import { createEventBus } from "./eventBus.js";
import { runDashboardServer } from "./dashboardServer.js";
import { createTmuxBridge, resolveTargetPane } from "./tmuxBridge.js";
import { spawn } from "node:child_process";

interface Config {
  projectNumber: number;
  projectOwner: string;
  projectNodeId: string;
  pollIntervalSec: number;
  statusFieldId: string;
  repositoryFieldId?: string;
  sessionFieldId?: string;
  statusOptionIds: Record<string, string>;
}

const loadConfig = async (cwd: string): Promise<Config> => {
  const raw = await readFile(join(cwd, ".coordinator/config.json"), "utf8");
  return JSON.parse(raw) as Config;
};

const parseArg = (argv: string[], flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const main = async (argv: string[]): Promise<void> => {
  const [, , subcommand, ...rest] = argv;
  const cwd = process.cwd();
  // The events sink is constructed inside the `start` branch (it depends on
  // `cwd`), so we late-bind the rate-limit forwarder via a mutable holder.
  // While idle (init/build-image), no listener fires and the wrapper is a no-op.
  const rateLimitListenerRef: {
    fn?: (info: { remaining: number; limit: number; resetAt: string }) => void;
  } = {};
  const fetchGraphQL = createGhFetchGraphQL({
    onRateLimit: (info) => rateLimitListenerRef.fn?.(info),
  });

  switch (subcommand) {
    case "init": {
      const projectNumber = Number(parseArg(rest, "--project"));
      const projectOwner = parseArg(rest, "--owner") ?? "@me";
      if (!projectNumber) {
        throw new Error("Missing --project <number>");
      }
      const owner =
        projectOwner === "@me"
          ? await resolveViewerLogin(fetchGraphQL)
          : projectOwner;
      await runInitCommand({
        cwd,
        fetchGraphQL,
        projectNumber,
        projectOwner: owner,
      });
      console.log(
        `wrote .coordinator/config.json for ${owner}/${projectNumber}`,
      );
      return;
    }
    case "build-image": {
      const here = new URL(".", import.meta.url).pathname;
      await runBuildImageCommand({
        dockerfileDir: join(here, "docker"),
      });
      console.log(`built image ${AGENT_BASE_IMAGE_TAG}`);
      return;
    }
    case "start": {
      await ensureAgentNetwork();
      const config = await loadConfig(cwd);
      const profilesPath = await resolveProfilesPath(cwd);
      const { profiles, defaultProfiles, resolveProfile } = (await import(
        profilesPath
      )) as {
        profiles: Parameters<typeof createAgentRegistry>[0]["profiles"];
        defaultProfiles: Parameters<
          typeof createCoordinator
        >[0]["defaultProfiles"];
        resolveProfile?: Parameters<
          typeof createCoordinator
        >[0]["resolveProfile"];
      };

      const poll = createProjectPoll({
        fetchGraphQL,
        config: {
          projectNodeId: config.projectNodeId,
          statusFieldId: config.statusFieldId,
        },
      });
      const claim = createClaimItem({
        fetchGraphQL,
        config: {
          projectNodeId: config.projectNodeId,
          statusFieldId: config.statusFieldId,
          statusOptionIds: config.statusOptionIds as any,
        },
      });
      const cacheRoot = repoCacheDirRoot(cwd);
      const repoCache = createRepoCache({ cacheDir: cacheRoot });
      // Bypass Sandcastle's docker provider — see dockerRun.ts header.
      const dockerRunFn = createDockerRun({
        image: process.env.COORDINATOR_IMAGE ?? "coordinator/agent-base",
        network: process.env.COORDINATOR_NETWORK ?? "agent-net",
        memory: process.env.COORDINATOR_MEMORY ?? "4g",
        cpus: Number(process.env.COORDINATOR_CPUS ?? 2),
        tmpfs: (process.env.COORDINATOR_TMPFS ?? "/tmp:rw,size=512m")
          .split(",,")
          .filter(Boolean),
      });
      const bus = createEventBus(eventsFilePath(cwd));
      const events = bus.sink;
      rateLimitListenerRef.fn = (info) => {
        void events.emit({ type: "gh.ratelimit", ...info });
      };
      const dispatcher = createDispatcher({
        repoCache,
        sandcastleRun: dockerRunFn,
        openPR: createGhOpenPR(),
        fetchComments: createGhFetchComments(),
        postComment: createGhPostComment(),
        fetchDefaultBranch: createGhFetchDefaultBranch(),
        sessionDir: join(process.env.HOME ?? cwd, ".coordinator/sessions"),
        worktreeBaseDir: process.env.COORDINATOR_WORKTREE_DIR,
        events,
      });
      const aggregator = createResultAggregator({
        fetchGraphQL,
        config: {
          projectNodeId: config.projectNodeId,
          statusFieldId: config.statusFieldId,
          sessionFieldId: config.sessionFieldId ?? "",
          statusOptionIds: config.statusOptionIds as any,
        },
      });
      const registry = createAgentRegistry({ profiles });
      const finalizer = createApprovalFinalizer({
        cacheDirFor: (repo) => join(repoCacheDirRoot(cwd), repo.split("/")[1]!),
      });
      const maxConcurrent = Number(process.env.COORDINATOR_MAX_CONCURRENT ?? 4);
      const coordinator = createCoordinator({
        poll,
        claim,
        dispatcher,
        aggregator,
        registry,
        defaultProfiles,
        finalizer,
        events,
        maxConcurrent,
        ...(resolveProfile ? { resolveProfile } : {}),
      });

      const controller = new AbortController();
      process.on("SIGINT", () => controller.abort());
      process.on("SIGTERM", () => controller.abort());

      // Embedded dashboard (on by default). `--no-dashboard` disables it
      // entirely; `--dashboard-port` overrides the port; `--no-open` skips
      // the auto-open behavior.
      const dashboardEnabled = !rest.includes("--no-dashboard");
      let dashboard: { close: () => Promise<void> } | undefined;
      if (dashboardEnabled) {
        const port = Number(
          parseArg(rest, "--dashboard-port") ??
            process.env.COORDINATOR_DASHBOARD_PORT ??
            4747,
        );
        const host = parseArg(rest, "--dashboard-host") ?? "127.0.0.1";
        const targetPane = resolveTargetPane(
          parseArg(rest, "--tmux-target-pane"),
          process.env,
        );
        const tmuxBridge = targetPane
          ? createTmuxBridge({ targetPane })
          : undefined;
        if (tmuxBridge) {
          console.log(
            `[dashboard] tmux bridge → pane ${tmuxBridge.targetPane}`,
          );
        }
        const handle = await runDashboardServer({
          bus,
          port,
          host,
          pollIntervalSec: config.pollIntervalSec,
          ...(tmuxBridge ? { tmuxBridge, events: bus.sink } : {}),
        });
        dashboard = handle;
        const noOpen = rest.includes("--no-open");
        if (!noOpen) {
          const opener =
            process.platform === "darwin"
              ? "open"
              : process.platform === "win32"
                ? "explorer"
                : "xdg-open";
          spawn(opener, [handle.url], {
            stdio: "ignore",
            detached: true,
          }).unref();
        }
      }

      const teardown = async () => {
        controller.abort();
        if (dashboard) await dashboard.close().catch(() => undefined);
      };
      process.on("SIGINT", teardown);
      process.on("SIGTERM", teardown);

      await runStartLoop({
        coordinator,
        sleep: realSleep,
        pollIntervalMs: config.pollIntervalSec * 1000,
        signal: controller.signal,
        onError: (err) => console.error("[tick error]", err),
      });
      return;
    }
    default:
      console.error(
        "Usage: coordinator <init|build-image|start> [--dashboard-port N] [--no-dashboard] [--no-open] [--tmux-target-pane %N]",
      );
      process.exit(2);
  }
};

const eventsFilePath = (cwd: string): string =>
  process.env.COORDINATOR_EVENTS_FILE ??
  join(process.env.HOME ?? cwd, ".coordinator/events.jsonl");

const repoCacheDirRoot = (cwd: string): string =>
  process.env.COORDINATOR_REPO_DIR ??
  join(process.env.HOME ?? cwd, "src/factory");

const resolveProfilesPath = async (cwd: string): Promise<string> => {
  for (const ext of [".ts", ".mts", ".js", ".mjs"]) {
    const candidate = join(cwd, `.coordinator/profiles${ext}`);
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(`No .coordinator/profiles.{ts,mts,js,mjs} found in ${cwd}.`);
};

const resolveViewerLogin = async (
  fetchGraphQL: ReturnType<typeof createGhFetchGraphQL>,
): Promise<string> => {
  const data = await fetchGraphQL("query { viewer { login } }");
  return data.viewer.login as string;
};

main(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
