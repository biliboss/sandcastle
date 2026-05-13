/**
 * Dispatcher — consumes a `WorkItemEvent`, resolves the bare clone via
 * `RepoCache`, and invokes `sandcastle.run()` with the profile's bundle.
 *
 * `sandcastleRun` is injected so tests can swap the real `run()` for a fake
 * that records arguments. Production wires it to `import { run }
 * from "../run.js"`.
 */

import type { AgentProfile, DispatchResult, WorkItemEvent } from "./types.js";

export interface SandcastleRunArgs {
  readonly agent: AgentProfile["agent"];
  readonly sandbox: ReturnType<AgentProfile["sandbox"]>;
  readonly cwd: string;
  readonly prompt: string;
  readonly branchStrategy: AgentProfile["branchStrategy"];
  readonly env?: Record<string, string>;
}

export type SandcastleRunFn = (
  args: SandcastleRunArgs,
) => Promise<{ readonly output?: string }>;

export interface OpenPRArgs {
  readonly repo: string;
  readonly head: string;
  readonly issueNumber: number;
  readonly title: string;
}

export type OpenPRFn = (args: OpenPRArgs) => Promise<string>;

export interface DispatcherDeps {
  readonly repoCache: { ensureFresh(repo: string): Promise<string> };
  readonly sandcastleRun: SandcastleRunFn;
  /**
   * Optional. When set, the dispatcher invokes it after a successful
   * sandcastle run and stores the returned PR URL on the result.
   */
  readonly openPR?: OpenPRFn;
  readonly sessionDir: string;
}

export interface Dispatcher {
  dispatch(
    event: WorkItemEvent,
    profile: AgentProfile,
  ): Promise<DispatchResult>;
}

const sessionPathFor = (sessionDir: string, itemId: string, repo: string) =>
  `${sessionDir}/${itemId}/${repo.replace("/", "__")}`;

const substituteItemId = (
  strategy: AgentProfile["branchStrategy"],
  itemId: string,
): AgentProfile["branchStrategy"] => {
  if (
    (strategy as { type: string }).type === "branch" &&
    typeof (strategy as { branch?: unknown }).branch === "string"
  ) {
    return {
      ...(strategy as any),
      branch: (strategy as { branch: string }).branch.replace(
        /\$\{itemId\}/g,
        itemId,
      ),
    };
  }
  return strategy;
};

export const createDispatcher = (deps: DispatcherDeps): Dispatcher => ({
  async dispatch(event, profile) {
    const repo = event.issue.repo;
    try {
      const cwd = await deps.repoCache.ensureFresh(repo);
      const env = profile.env?.(repo);
      const substituted = substituteItemId(
        profile.branchStrategy,
        event.itemId,
      );
      await deps.sandcastleRun({
        agent: profile.agent,
        sandbox: profile.sandbox(),
        cwd,
        prompt: event.issue.body,
        branchStrategy: substituted,
        ...(env ? { env } : {}),
      });
      let prUrl: string | undefined;
      if (
        deps.openPR &&
        (substituted as { type: string; branch?: string }).type === "branch" &&
        typeof (substituted as { branch?: string }).branch === "string"
      ) {
        prUrl = await deps.openPR({
          repo,
          head: (substituted as { branch: string }).branch,
          issueNumber: event.issue.number,
          title: event.issue.title,
        });
      }
      return {
        itemId: event.itemId,
        repo,
        sessionPath: sessionPathFor(deps.sessionDir, event.itemId, repo),
        ...(prUrl ? { prUrl } : {}),
      };
    } catch (err) {
      return {
        itemId: event.itemId,
        repo,
        sessionPath: sessionPathFor(deps.sessionDir, event.itemId, repo),
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  },
});
