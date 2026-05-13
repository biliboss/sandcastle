/**
 * `fetchDefaultBranch` — looks up a repo's default branch via `gh api repos/<repo>`.
 * Cached per-repo for the coordinator process lifetime — default branch
 * rarely changes and a stale value is recoverable (worst case: one failed
 * dispatch, then a restart picks up the new value).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FetchDefaultBranchFn } from "./Dispatcher.js";

const execFileP = promisify(execFile);

export const createGhFetchDefaultBranch = (): FetchDefaultBranchFn => {
  const cache = new Map<string, string>();
  return async (repo) => {
    const cached = cache.get(repo);
    if (cached) return cached;
    try {
      const { stdout } = await execFileP("gh", [
        "api",
        `repos/${repo}`,
        "--jq",
        ".default_branch",
      ]);
      const branch = stdout.trim() || "main";
      cache.set(repo, branch);
      return branch;
    } catch {
      // Fall back to "main"; the clone will fail loudly if the fallback is
      // wrong, which surfaces the bad repo on the dashboard rather than
      // silently masking it.
      return "main";
    }
  };
};
