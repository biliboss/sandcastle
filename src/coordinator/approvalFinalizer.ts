/**
 * Approval finalizer — runs when a work item enters the `Approved` status.
 *
 * Items can have up to two coordinator-opened PRs: one on
 * `coordinator/research/<itemId>` (markdown doc) and one on
 * `coordinator/dev/<itemId>` (implementation). The dev branch was cut off
 * the research branch tip, so dev's diff already carries the research
 * commits. Strategy:
 *
 *   - If a dev PR exists: squash-merge dev (lands research+dev). Close the
 *     research PR with a "superseded by #<dev>" comment — its branch is
 *     gone after the merge auto-delete anyway.
 *   - If only research exists: squash-merge research.
 *   - If neither: fail (someone hit Approved without a PR, suspicious).
 *
 * Local cleanup (branch + worktree) is left to a follow-up; GitHub's
 * `--delete-branch` flag handles the remote side.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DockerRunResult } from "./buildImageCommand.js";
import type { WorkItemEvent } from "./types.js";

const execFileP = promisify(execFile);

type Runner = (args: readonly string[]) => Promise<DockerRunResult>;

const defaultRunner =
  (bin: string): Runner =>
  async (args) => {
    try {
      const { stdout, stderr } = await execFileP(bin, [...args]);
      return { stdout, stderr, exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? String(err),
        exitCode: typeof err.code === "number" ? err.code : 1,
      };
    }
  };

export interface ApprovalFinalizerDeps {
  /** `gh` CLI runner. */
  readonly gh?: Runner;
  /** `git` CLI runner. */
  readonly git?: Runner;
  /** Maps a `<owner>/<repo>` to the host cache repo path. */
  readonly cacheDirFor?: (repo: string) => string;
}

export interface FinalizeResult {
  readonly itemId: string;
  readonly repo: string;
  readonly merged: { mainPrNumber: number };
  readonly closed: { supersededPrNumber?: number };
}

export interface ApprovalFinalizer {
  finalize(event: WorkItemEvent): Promise<FinalizeResult>;
}

interface PrSummary {
  number: number;
  state?: string;
}

const findPr = async (
  gh: Runner,
  repo: string,
  head: string,
): Promise<PrSummary | undefined> => {
  const result = await gh([
    "pr",
    "list",
    "--repo",
    repo,
    "--head",
    head,
    "--state",
    "all",
    "--json",
    "number,state,url",
  ]);
  if (result.exitCode !== 0) return undefined;
  try {
    const parsed = JSON.parse(result.stdout) as PrSummary[];
    return parsed[0];
  } catch {
    return undefined;
  }
};

export const createApprovalFinalizer = (
  deps: ApprovalFinalizerDeps = {},
): ApprovalFinalizer => {
  const gh = deps.gh ?? defaultRunner("gh");
  const git = deps.git ?? defaultRunner("git");
  return {
    async finalize(event) {
      const repo = event.issue.repo;
      const researchHead = `coordinator/research/${event.itemId}`;
      const devHead = `coordinator/dev/${event.itemId}`;
      const research = await findPr(gh, repo, researchHead);
      const dev = await findPr(gh, repo, devHead);
      if (!research && !dev) {
        throw new Error(
          `no PR found for ${event.itemId} (neither ${researchHead} nor ${devHead})`,
        );
      }

      const mainPr = dev ?? research!;
      const merge = await gh([
        "pr",
        "merge",
        String(mainPr.number),
        "--repo",
        repo,
        "--squash",
        "--delete-branch",
      ]);
      if (merge.exitCode !== 0) {
        throw new Error(
          `gh pr merge #${mainPr.number} failed: ${merge.stderr}`,
        );
      }

      let supersededPrNumber: number | undefined;
      if (dev && research) {
        supersededPrNumber = research.number;
        await gh([
          "pr",
          "comment",
          String(research.number),
          "--repo",
          repo,
          "--body",
          `Superseded by #${dev.number} (squash-merged via Sandcastle coordinator).`,
        ]);
        await gh(["pr", "close", String(research.number), "--repo", repo]);
      }

      // Best-effort local cleanup: prune stale branches in the cache repo.
      if (deps.cacheDirFor) {
        const cacheDir = deps.cacheDirFor(repo);
        await git(["-C", cacheDir, "fetch", "--prune", "origin"]);
        for (const b of [researchHead, devHead]) {
          await git(["-C", cacheDir, "branch", "-D", b]);
        }
      }

      return {
        itemId: event.itemId,
        repo,
        merged: { mainPrNumber: mainPr.number },
        closed: { supersededPrNumber },
      };
    },
  };
};
