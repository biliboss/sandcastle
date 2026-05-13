#!/usr/bin/env node
/**
 * `orchestrator` CLI entry. Two subcommands so far:
 *   orchestrator init --project <n> [--owner <login>]
 *   orchestrator start
 *
 * Both read/write `.orchestrator/config.json` under the current cwd.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createGhFetchGraphQL } from "./ghFetchGraphQL.js";
import { runInitCommand } from "./initCommand.js";
import { runStartLoop, realSleep } from "./startCommand.js";
import { createProjectPoll } from "./ProjectPoll.js";
import { createClaimItem } from "./claimItem.js";
import { createDispatcher } from "./Dispatcher.js";
import { createResultAggregator } from "./ResultAggregator.js";
import { createAgentRegistry } from "./AgentRegistry.js";
import { createCoordinator } from "./Coordinator.js";
import { createRepoCache } from "./RepoCache.js";
import { run } from "../run.js";

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
  const raw = await readFile(join(cwd, ".orchestrator/config.json"), "utf8");
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
        `wrote .orchestrator/config.json for ${owner}/${projectNumber}`,
      );
      return;
    }
    case "start": {
      const config = await loadConfig(cwd);
      const profilesPath = join(cwd, ".orchestrator/profiles.js");
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
        cacheDir: join(process.env.HOME ?? cwd, ".orchestrator/repos"),
      });
      const dispatcher = createDispatcher({
        repoCache,
        sandcastleRun: (args) => run(args as any) as any,
        sessionDir: join(process.env.HOME ?? cwd, ".orchestrator/sessions"),
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
      console.error("Usage: orchestrator <init|start> [args]");
      process.exit(2);
  }
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
