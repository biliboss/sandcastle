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
import { createDockerRun } from "./dockerRun.js";

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
  const fetchGraphQL = createGhFetchGraphQL();

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
      const { profiles, defaultProfiles } = (await import(profilesPath)) as {
        profiles: Parameters<typeof createAgentRegistry>[0]["profiles"];
        defaultProfiles: Parameters<
          typeof createCoordinator
        >[0]["defaultProfiles"];
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
      const repoCache = createRepoCache({
        cacheDir:
          process.env.COORDINATOR_REPO_DIR ??
          join(process.env.HOME ?? cwd, "src/factory"),
      });
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
      const dispatcher = createDispatcher({
        repoCache,
        sandcastleRun: dockerRunFn,
        openPR: createGhOpenPR(),
        sessionDir: join(process.env.HOME ?? cwd, ".coordinator/sessions"),
        worktreeBaseDir: process.env.COORDINATOR_WORKTREE_DIR,
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
      const coordinator = createCoordinator({
        poll,
        claim,
        dispatcher,
        aggregator,
        registry,
        defaultProfiles,
      });

      const controller = new AbortController();
      process.on("SIGINT", () => controller.abort());
      process.on("SIGTERM", () => controller.abort());

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
      console.error("Usage: coordinator <init|build-image|start> [args]");
      process.exit(2);
  }
};

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
