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
import type { EventSink } from "./events.js";
import { nullSink } from "./events.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";

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
  /**
   * Host path mounted into the container as `CLAUDE_CONFIG_DIR`. The
   * coordinator-owned docker runner bind-mounts this to
   * `/home/agent/.claude`, which causes the agent's session jsonl to land
   * on the host where the dashboard can tail it.
   */
  readonly sessionDir?: string;
}

export type SandcastleRunFn = (args: SandcastleRunArgs) => Promise<{
  readonly output?: string;
  /** Host path to the agent session jsonl, if captured. */
  readonly sessionPath?: string;
}>;

export interface OpenPRArgs {
  readonly repo: string;
  readonly head: string;
  readonly issueNumber: number;
  readonly title: string;
}

export type OpenPRFn = (args: OpenPRArgs) => Promise<string>;

export interface FetchCommentsArgs {
  readonly repo: string;
  readonly issueNumber: number;
}
export type FetchCommentsFn = (args: FetchCommentsArgs) => Promise<string[]>;

export interface PostCommentArgs {
  readonly repo: string;
  readonly issueNumber: number;
  readonly body: string;
}
export type PostCommentFn = (args: PostCommentArgs) => Promise<void>;

/** Resolves the default branch (e.g. main, master, trunk) for a repo. */
export type FetchDefaultBranchFn = (repo: string) => Promise<string>;

export interface DispatcherDeps {
  readonly repoCache: { ensureFresh(repo: string): Promise<string> };
  readonly sandcastleRun: SandcastleRunFn;
  /**
   * Optional. When set, the dispatcher invokes it after a successful
   * sandcastle run and stores the returned PR URL on the result.
   */
  readonly openPR?: OpenPRFn;
  /** Optional. Fetches issue comments to include in the agent prompt. */
  readonly fetchComments?: FetchCommentsFn;
  /**
   * Optional. Posts a status comment on the source issue after every
   * dispatch — success or failure. Gives humans an audit trail even when
   * a PR didn't open.
   */
  readonly postComment?: PostCommentFn;
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
  /** Optional event sink for live dashboard progress. */
  readonly events?: EventSink;
  /**
   * Resolves a repo's default branch. Default falls back to "main", but
   * some mktvirtual repos use "master" / other names — without this lookup
   * `git clone --branch main` fails on those repos.
   */
  readonly fetchDefaultBranch?: FetchDefaultBranchFn;
}

export interface Dispatcher {
  dispatch(
    event: WorkItemEvent,
    profile: AgentProfile,
  ): Promise<DispatchResult>;
}

const sessionPathFor = (sessionDir: string, itemId: string, repo: string) =>
  `${sessionDir}/${itemId}/${repo.replace("/", "__")}`;

type Phase = "research" | "dev";

const phaseFor = (status: string): Phase =>
  status === "Ready to-do" ? "dev" : "research";

const substituteItemId = (
  strategy: AgentProfile["branchStrategy"],
  itemId: string,
  phase: Phase,
): AgentProfile["branchStrategy"] => {
  if (
    (strategy as { type: string }).type === "branch" &&
    typeof (strategy as { branch?: unknown }).branch === "string"
  ) {
    return {
      ...(strategy as any),
      branch: (strategy as { branch: string }).branch
        .replace(/\$\{itemId\}/g, itemId)
        .replace(/\$\{phase\}/g, phase),
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
const composeResearchPrompt = (
  event: WorkItemEvent,
  comments: string[] = [],
): string => {
  const issueRef = `${event.issue.repo}#${event.issue.number}`;
  const title = event.issue.title;
  const body = event.issue.body || "(no body)";
  const commentSection = comments.length
    ? "\n\n--- issue comments (newest last) ---\n" +
      comments.join("\n\n") +
      "\n--- end comments ---"
    : "";
  return [
    `You are a research agent for the multi-repo coordinator.`,
    ``,
    `Task: ${title}`,
    `Source issue: ${issueRef}`,
    ``,
    `--- issue body ---`,
    body,
    `--- end body ---`,
    commentSection,
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

/**
 * Dev prompt — for items pulled from the `Ready to-do` queue. Agent is
 * expected to implement the feature/fix described in the issue body, run
 * the project's tests if any, and commit the working result.
 */
const composeDevPrompt = (
  event: WorkItemEvent,
  comments: string[] = [],
): string => {
  const issueRef = `${event.issue.repo}#${event.issue.number}`;
  const title = event.issue.title;
  const body = event.issue.body || "(no body)";
  const commentSection = comments.length
    ? "\n\n--- issue comments (newest last; treat as additional instructions) ---\n" +
      comments.join("\n\n") +
      "\n--- end comments ---"
    : "";
  return [
    `You are a development agent for the multi-repo coordinator.`,
    ``,
    `Task: ${title}`,
    `Source issue: ${issueRef}`,
    ``,
    `--- issue body ---`,
    body,
    `--- end body ---`,
    commentSection,
    ``,
    `Implement the change described above (and any directives in comments).`,
    `Match the project's existing`,
    `conventions (read CLAUDE.md, AGENTS.md, README.md, CONTEXT.md first if`,
    `they exist). Run the project's tests/typecheck/lint if a sensible target`,
    `is obvious. When the implementation is complete, you MUST run:`,
    ``,
    `  git add -A`,
    `  git commit -m "feat: <short summary>"  # or fix:, refactor:, etc.`,
    ``,
    `If the work is not finishable in one turn, commit whatever is ready and`,
    `note what's missing in the commit body. Failing to commit will mark`,
    `this dispatch as failed. Do not push.`,
  ].join("\n");
};

const composePrompt = (
  event: WorkItemEvent,
  comments: string[] = [],
): string =>
  event.status === "Ready to-do"
    ? composeDevPrompt(event, comments)
    : composeResearchPrompt(event, comments);

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

const postDispatchComment = async (
  deps: DispatcherDeps,
  event: WorkItemEvent,
  result: DispatchResult,
  phase: Phase,
): Promise<void> => {
  if (!deps.postComment) return;
  const lines: string[] = [
    `**Sandcastle coordinator — ${phase} dispatch**`,
    ``,
  ];
  if (result.error) {
    lines.push(`Outcome: ❌ failed`);
    lines.push("");
    lines.push(`Error:`);
    lines.push("```");
    lines.push(result.error.message);
    lines.push("```");
  } else if (result.prUrl) {
    lines.push(`Outcome: ✅ PR opened`);
    lines.push("");
    lines.push(`PR: ${result.prUrl}`);
  } else {
    lines.push(`Outcome: ⚠️ completed without a PR`);
  }
  lines.push("");
  lines.push(`Session log: \`${result.sessionPath}\``);
  try {
    await deps.postComment({
      repo: result.repo,
      issueNumber: event.issue.number,
      body: lines.join("\n"),
    });
  } catch (e) {
    console.error(
      `[postComment failed] item=${event.itemId}: ${(e as Error).message}`,
    );
  }
};

export const createDispatcher = (deps: DispatcherDeps): Dispatcher => ({
  async dispatch(event, profile) {
    const repo = event.issue.repo;
    const git = deps.git ?? defaultGit;
    const sink = deps.events ?? nullSink;
    const phase: "research" | "dev" = phaseFor(event.status);
    const progress = (step: string, detail?: string) =>
      sink.emit({
        type: "dispatch.progress",
        itemId: event.itemId,
        repo,
        phase,
        step,
        ...(detail ? { detail } : {}),
      });
    try {
      await progress("cache.ensure");
      const cacheDir = await deps.repoCache.ensureFresh(repo);
      const env = profile.env?.(repo);
      const phase = phaseFor(event.status);
      const substituted = substituteItemId(
        profile.branchStrategy,
        event.itemId,
        phase,
      );

      // Resolve the worktree path. For the branch strategy we cut a worktree
      // off the cache repo so the container mounts an isolated checkout. For
      // other strategies we fall back to the cache dir directly.
      let cwd = cacheDir;
      let branchName: string | undefined;
      let baseBranch: string | undefined;
      if (
        (substituted as { type: string; branch?: string }).type === "branch" &&
        typeof (substituted as { branch?: string }).branch === "string"
      ) {
        branchName = (substituted as { branch: string }).branch;
        const base = deps.worktreeBaseDir ?? `${cacheDir}/.coord-worktrees`;
        const repoName = basename(cacheDir);
        cwd = join(base, repoName, branchSlug(branchName));

        // Fresh dispatch every time — remove any stale checkout (Q3 decision
        // during the 2026-05-13 grill: predictability over disk-savings).
        if (existsSync(cwd)) {
          await rm(cwd, { recursive: true, force: true });
        }

        // Refresh the cache + pull the prior-phase branch if it exists, so
        // a dev dispatch can branch off the research output (Q2 decision).
        await runGit(git, ["-C", cacheDir, "fetch", "origin"], "git fetch");
        const researchBranch = `coordinator/research/${event.itemId}`;
        const defaultBranch =
          (await deps.fetchDefaultBranch?.(repo).catch(() => undefined)) ??
          "main";
        let cloneBranch = defaultBranch;
        if (phase === "dev") {
          const lsRemote = await git([
            "ls-remote",
            "--heads",
            `https://github.com/${repo}.git`,
            researchBranch,
          ]);
          if (lsRemote.exitCode === 0 && lsRemote.stdout.trim() !== "") {
            // Fetch the research branch into the cache so --shared clone
            // can see it as a local ref.
            await runGit(
              git,
              [
                "-C",
                cacheDir,
                "fetch",
                "origin",
                `${researchBranch}:refs/heads/${researchBranch}`,
              ],
              "git fetch research branch",
            );
            cloneBranch = researchBranch;
          }
        }
        baseBranch = cloneBranch;
        // No --shared: that creates `.git/objects/info/alternates` pointing
        // at the host cache path, which the bind-mounted container rewrites
        // to an invalid `/workspace/.alt-objects` path. Plain clone uses
        // hardlinks within the same filesystem (cheap) and produces a
        // self-contained `.git` dir that travels into the container fine.
        await progress("git.clone", `branch=${cloneBranch}`);
        await runGit(
          git,
          ["clone", "--branch", cloneBranch, cacheDir, cwd],
          "git clone (dispatch)",
        );
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

      const comments = deps.fetchComments
        ? await deps
            .fetchComments({
              repo,
              issueNumber: event.issue.number,
            })
            .catch(() => [])
        : [];
      const wrappedPrompt = composePrompt(event, comments);
      await progress("agent.exec.start");
      const sessionDir = sessionPathFor(deps.sessionDir, event.itemId, repo);
      const runResult = await deps.sandcastleRun({
        agent: profile.agent,
        sandbox: profile.sandbox(),
        cwd,
        prompt: wrappedPrompt,
        branchStrategy: substituted,
        ...(env ? { env } : {}),
        sessionDir,
      });
      if (runResult.sessionPath) {
        await sink.emit({
          type: "agent.session",
          itemId: event.itemId,
          repo,
          phase,
          sessionPath: runResult.sessionPath,
        });
      }
      await progress("agent.exec.done");

      // After the agent has run inside the worktree, decide what to ship.
      let prUrl: string | undefined;
      if (branchName) {
        // Count only commits this dispatch added on top of its clone base.
        // For research that's origin/main; for dev that's the research
        // branch the dev clone was forked off.
        const baseRef = `origin/${baseBranch ?? "main"}`;
        const ahead = (
          await runGit(
            git,
            ["-C", cwd, "rev-list", "--count", "HEAD", `^${baseRef}`],
            "git rev-list",
          )
        ).trim();
        if (ahead === "0") {
          throw new Error(
            `agent produced no commits on ${branchName} — nothing to ship`,
          );
        }
        await progress("git.push", `branch=${branchName} ahead=${ahead}`);
        // Force-with-lease: coord/* branches are coord-owned + ephemeral. A
        // prior aborted dispatch can leave commits on the remote branch that
        // diverge from the fresh-cloned-from-main local history; reject is
        // safe to overwrite. `--force-with-lease` is the cautious variant —
        // refuses if the remote tip is unexpected (so we never clobber a
        // concurrent dispatch).
        await runGit(
          git,
          ["-C", cwd, "push", "--force-with-lease", "-u", "origin", branchName],
          "git push",
        );
        if (deps.openPR) {
          await progress("pr.open");
          prUrl = await deps.openPR({
            repo,
            head: branchName,
            issueNumber: event.issue.number,
            title: event.issue.title,
          });
        }
      }

      const result = {
        itemId: event.itemId,
        repo,
        sessionPath: sessionPathFor(deps.sessionDir, event.itemId, repo),
        ...(prUrl ? { prUrl } : {}),
      };
      await postDispatchComment(deps, event, result, phaseFor(event.status));
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        `[dispatch error] item=${event.itemId} repo=${repo}: ${error.message}`,
      );
      const result = {
        itemId: event.itemId,
        repo,
        sessionPath: sessionPathFor(deps.sessionDir, event.itemId, repo),
        error,
      };
      await postDispatchComment(deps, event, result, phaseFor(event.status));
      return result;
    }
  },
});
