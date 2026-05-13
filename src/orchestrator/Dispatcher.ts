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

export interface DispatcherDeps {
  readonly repoCache: { ensureFresh(repo: string): Promise<string> };
  readonly sandcastleRun: SandcastleRunFn;
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

export const createDispatcher = (deps: DispatcherDeps): Dispatcher => ({
  async dispatch(event, profile) {
    const repo = event.issue.repo;
    try {
      const cwd = await deps.repoCache.ensureFresh(repo);
      const env = profile.env?.(repo);
      await deps.sandcastleRun({
        agent: profile.agent,
        sandbox: profile.sandbox(),
        cwd,
        prompt: event.issue.body,
        branchStrategy: profile.branchStrategy,
        ...(env ? { env } : {}),
      });
      return {
        itemId: event.itemId,
        repo,
        sessionPath: sessionPathFor(deps.sessionDir, event.itemId, repo),
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
