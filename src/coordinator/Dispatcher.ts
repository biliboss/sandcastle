/**
 * Dispatcher — consumes a `WorkItemEvent`, resolves the bare clone via
 * `RepoCache`, and invokes `sandcastle.run()` with the profile's bundle.
 *
 * `sandcastleRun` is injected so tests can swap the real `run()` for a fake
 * that records arguments. Production wires it to `import { run }
 * from "../run.js"`.
 */

import type { AgentProfile, DispatchResult, WorkItemEvent } from "./types.js";
import type { GitRunner } from "./RepoCache.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";

const execFileP = promisify(execFile);

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
  /**
   * Base directory under which the dispatcher creates per-branch worktrees:
   * `<worktreeBaseDir>/<repoName>/<branchSlug>`. Required for the
   * branch-strategy path; coordinator wires this from
   * `COORDINATOR_WORKTREE_DIR` (see ADR 0007 / 0021).
   */
  readonly worktreeBaseDir?: string;
  /** Injected git runner (tests); production uses execFile("git", ...). */
  readonly git?: GitRunner;
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

const branchSlug = (branch: string): string =>
  branch.replace(/[^a-zA-Z0-9._-]/g, "-");

/**
 * Wrap the issue body with explicit "do work + commit" instructions so the
 * agent finishes its turn with at least one commit on the branch. Without
 * this, single-pass dispatches frequently leave the worktree untouched.
 */
const composeResearchPrompt = (event: WorkItemEvent): string => {
  const issueRef = `${event.issue.repo}#${event.issue.number}`;
  const title = event.issue.title;
  const body = event.issue.body || "(no body)";
  return [
    `You are a research agent for the multi-repo coordinator.`,
    ``,
    `Task: ${title}`,
    `Source issue: ${issueRef}`,
    ``,
    `--- issue body ---`,
    body,
    `--- end body ---`,
    ``,
    `Produce a research document at \`research/<slug>.md\` in the current`,
    `working directory. Be concise and concrete — recommendations, trade-offs,`,
    `risks. After writing the file, you MUST run:`,
    ``,
    `  git add research/<slug>.md`,
    `  git commit -m "research: <short summary>"`,
    ``,
    `Failing to commit will mark this dispatch as failed. Do not push.`,
  ].join("\n");
};

const runGit = async (
  git: GitRunner,
  args: readonly string[],
  desc: string,
): Promise<string> => {
  const result = await git(args);
  if (result.exitCode !== 0) {
    throw new Error(`${desc} failed: ${result.stderr.trim() || result.stdout}`);
  }
  return result.stdout;
};

export const createDispatcher = (deps: DispatcherDeps): Dispatcher => ({
  async dispatch(event, profile) {
    const repo = event.issue.repo;
    const git = deps.git ?? defaultGit;
    try {
      const cacheDir = await deps.repoCache.ensureFresh(repo);
      const env = profile.env?.(repo);
      const substituted = substituteItemId(
        profile.branchStrategy,
        event.itemId,
      );

      // Resolve the worktree path. For the branch strategy we cut a worktree
      // off the cache repo so the container mounts an isolated checkout. For
      // other strategies we fall back to the cache dir directly.
      let cwd = cacheDir;
      let branchName: string | undefined;
      if (
        (substituted as { type: string; branch?: string }).type === "branch" &&
        typeof (substituted as { branch?: string }).branch === "string"
      ) {
        branchName = (substituted as { branch: string }).branch;
        const base = deps.worktreeBaseDir ?? `${cacheDir}/.coord-worktrees`;
        const repoName = basename(cacheDir);
        cwd = join(base, repoName, branchSlug(branchName));
        if (!existsSync(cwd)) {
          // Refresh cache, then make a *standalone* clone for this dispatch
          // (not a worktree). Worktrees use a `.git` file pointing to the
          // parent repo's host path, which a bind-mounted container can't
          // resolve. A clone has its own `.git` dir → portable into the
          // container. The clone is shallow + shared so the cost stays low.
          await runGit(git, ["-C", cacheDir, "fetch", "origin"], "git fetch");
          await runGit(
            git,
            ["clone", "--shared", "--branch", "main", cacheDir, cwd],
            "git clone (dispatch)",
          );
          // Point the dispatch clone's `origin` at the real GitHub remote so
          // the post-run push hits the right place.
          await runGit(
            git,
            [
              "-C",
              cwd,
              "remote",
              "set-url",
              "origin",
              `https://github.com/${repo}.git`,
            ],
            "git remote set-url",
          );
          await runGit(
            git,
            ["-C", cwd, "checkout", "-b", branchName],
            "git checkout -b",
          );
        }
      }

      const wrappedPrompt = composeResearchPrompt(event);
      await deps.sandcastleRun({
        agent: profile.agent,
        sandbox: profile.sandbox(),
        cwd,
        prompt: wrappedPrompt,
        branchStrategy: substituted,
        ...(env ? { env } : {}),
      });

      // After the agent has run inside the worktree, decide what to ship.
      let prUrl: string | undefined;
      if (branchName) {
        const ahead = (
          await runGit(
            git,
            ["-C", cwd, "rev-list", "--count", "HEAD", "^origin/main"],
            "git rev-list",
          )
        ).trim();
        if (ahead === "0") {
          throw new Error(
            `agent produced no commits on ${branchName} — nothing to ship`,
          );
        }
        await runGit(
          git,
          ["-C", cwd, "push", "-u", "origin", branchName],
          "git push",
        );
        if (deps.openPR) {
          prUrl = await deps.openPR({
            repo,
            head: branchName,
            issueNumber: event.issue.number,
            title: event.issue.title,
          });
        }
      }

      return {
        itemId: event.itemId,
        repo,
        sessionPath: sessionPathFor(deps.sessionDir, event.itemId, repo),
        ...(prUrl ? { prUrl } : {}),
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        `[dispatch error] item=${event.itemId} repo=${repo}: ${error.message}`,
      );
      return {
        itemId: event.itemId,
        repo,
        sessionPath: sessionPathFor(deps.sessionDir, event.itemId, repo),
        error,
      };
    }
  },
});
