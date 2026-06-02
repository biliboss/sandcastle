/**
 * RepoCache — host-side cache of regular (non-bare) git clones.
 *
 * The coordinator stores one working clone per `owner/name` at
 * `<cacheDir>/<owner>__<name>`. `sandcastle.run()` uses this as its `cwd`;
 * Sandcastle's WorktreeManager handles branch strategy on top.
 *
 * Why not bare? `sandcastle.run()` expects a working tree (a git repo with a
 * checked-out index it can carve worktrees off). A `--bare` clone has objects
 * but no working tree, so `run({ cwd: <bare> })` fails. The trade-off is disk
 * usage — but a working clone is still shared across runs via worktrees, so
 * the cost is one checked-out tree per repo, not per dispatch.
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
  /** Ensure the working clone for `repo` exists and is up-to-date. Returns its path. */
  ensureFresh(repo: string): Promise<string>;
}

const cachePathFor = (cacheDir: string, repo: string): string => {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo "${repo}" — expected "owner/name"`);
  }
  // Flat layout: `<cacheDir>/<name>`. Two repos with the same name across
  // different owners would collide — accept that limitation in exchange for
  // a layout that humans can `cd` into without slug decoding.
  return join(cacheDir, name);
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
        : ["clone", `https://github.com/${repo}.git`, path];
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
