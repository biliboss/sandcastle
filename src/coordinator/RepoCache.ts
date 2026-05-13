/**
 * RepoCache — host-side cache of bare git clones.
 *
 * The coordinator stores one bare repo per `owner/name` at
 * `<cacheDir>/<owner>__<name>.git`. `sandcastle.run()` carves worktrees off
 * the cache rather than cloning per dispatch.
 */

import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileP = promisify(execFile);

export interface GitRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type GitRunner = (args: readonly string[]) => Promise<GitRunResult>;

const defaultGit: GitRunner = async (args) => {
  try {
    const { stdout, stderr } = await execFileP("git", [...args]);
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? String(err),
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
};

export interface RepoCache {
  /** Ensure the bare clone for `repo` exists and is up-to-date. Returns its path. */
  ensureFresh(repo: string): Promise<string>;
}

const cachePathFor = (cacheDir: string, repo: string): string => {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo "${repo}" — expected "owner/name"`);
  }
  return join(cacheDir, `${owner}__${name}.git`);
};

export const createRepoCache = (deps: {
  cacheDir: string;
  git?: GitRunner;
}): RepoCache => {
  const git = deps.git ?? defaultGit;
  return {
    async ensureFresh(repo) {
      const path = cachePathFor(deps.cacheDir, repo);
      const args = existsSync(path)
        ? ["-C", path, "fetch", "--prune", "origin"]
        : ["clone", "--bare", `https://github.com/${repo}.git`, path];
      const result = await git(args);
      if (result.exitCode !== 0) {
        throw new Error(
          `git ${args.join(" ")} failed (exit ${result.exitCode}): ${result.stderr}`,
        );
      }
      return path;
    },
  };
};
