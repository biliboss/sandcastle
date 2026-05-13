# Multi-Repo Coordinator on Sandcastle

Research for the multi-repo coordinator layer on top of [`@ai-hero/sandcastle`](https://github.com/mattpocock/sandcastle).

**Date:** 2026-05-13

A coordination layer over `sandcastle.run()` that drives AI coding agents across multiple repositories from a single GitHub Project (v2) board. Sandcastle stays per-repo; the coordinator adds the cross-repo dimension without touching the core.

> **Note on terminology:** Sandcastle already has an internal `Orchestrator` class (the per-run iteration loop). To avoid confusion, this layer is named **Coordinator**. See `CONTEXT.md` § "Coordinator layer (multi-repo)".

---

## 1 Overview

### 1.1 Problem

Sandcastle's primitives (`run()`, `createSandbox()`, `wt.*`) are single-repo by design:

- One `SandboxProvider` instance → one isolated environment → one worktree → one repo.
- `WorktreeManager` operates within a single git repo.
- No cross-repo state, no cross-repo identity, no cross-repo merging.

Real-world AFK workflows span many repos: a fix lands in `web`, a contract bump in `proto`, a migration in `infra`. Coordinating those by hand cancels the leverage Sandcastle gives.

### 1.2 Solution shape

A thin **orchestrator layer** that:

1. Reads work items from a **GitHub Project (v2)** — the only construct GitHub gives you that natively spans repos.
2. Resolves each item to one or more `(repo, branch, prompt)` tuples.
3. Dispatches each tuple to its own `sandcastle.run()` in parallel.
4. Aggregates results back into the Project as field updates and PRs.

GitHub Projects v2 is the source of truth. Sandcastle is the execution substrate. The orchestrator is the glue.

### 1.3 Non-goals

- Replacing Sandcastle's per-repo sandbox model.
- Cross-repo atomic merges (impossible without a monorepo or merge-queue federation).
- Building a UI — the GitHub Project IS the UI.

---

## 2 Key Concepts and Ubiquitous Language

**Project**:
A GitHub Project (v2) board that can contain issues from many repositories. The orchestration unit of work.
_Avoid_: "board" (too UI-flavoured), "epic" (too Jira-flavoured).

**Work item**:
A single row in the Project, backed by a GitHub issue in some repo. Has fields: status, assignee-agent, target-repos, prompt-source.
_Avoid_: "task", "ticket".

**Target repo**:
A repository that participates in a work item's execution. One work item can have N target repos.

**Dispatch**:
The act of converting one work item into N `sandcastle.run()` invocations (one per target repo).

**Run**:
A single `sandcastle.run()` invocation. 1 run = 1 sandbox = 1 repo = 1 worktree = 1 candidate PR.

**Agent profile**:
Named bundle of (`AgentProvider`, `SandboxProvider`, branch strategy, env). Selected via a Project field.

**Coordinator**:
The host process that polls the Project, dispatches runs, collects results. Stateless except for the Project itself.

---

## 3 Architecture

### 3.1 Layer diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Project (v2)                       │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ work items (issues from N repos)                       │ │
│  │ fields: status, agent-profile, repos[], prompt-path    │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │ GraphQL (poll / webhook)
┌──────────────────────────▼──────────────────────────────────┐
│                      Coordinator                            │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │ ProjectPoll │→ │ Dispatcher   │→ │ ResultAggregator │   │
│  └─────────────┘  └──────────────┘  └─────────────────┘   │
│         │              │                    │              │
│         │              ▼                    │              │
│         │      ┌───────────────┐            │              │
│         │      │ AgentRegistry │            │              │
│         │      └───────────────┘            │              │
└─────────┼──────────────┼────────────────────┼──────────────┘
          │              │                    │
          │              ▼ N parallel          │
          │     ┌────────────────────┐         │
          │     │ sandcastle.run()   │         │
          │     │   per (item,repo)  │         │
          │     └────────┬───────────┘         │
          │              ▼                     │
          │     ┌────────────────────┐         │
          │     │ SandboxProvider    │         │
          │     │ (docker/podman/    │         │
          │     │  vercel/daytona)   │         │
          │     └────────┬───────────┘         │
          │              ▼                     │
          │     ┌────────────────────┐         │
          │     │ git worktree +     │         │
          │     │ agent (claudeCode/ │         │
          │     │ codex/...)         │         │
          │     └────────┬───────────┘         │
          │              ▼                     │
          │     ┌────────────────────┐         │
          │     │ PR on target repo  │─────────┘
          │     └────────────────────┘
          ▼
   project field update (status → "in review")
```

### 3.2 Components

#### 3.2.1 ProjectPoll

Polls the GitHub Project via GraphQL on an interval (or listens to webhooks). Emits `WorkItemEvent` for each item entering a triggering status (e.g. `Ready → InProgress`).

Key API:

```ts
interface WorkItemEvent {
  itemId: string; // Project v2 item node ID
  issue: { repo: string; number: number; title: string; body: string };
  agentProfile: string; // free-form field, resolved by AgentRegistry
  targetRepos: string[]; // free-form field, comma-separated owner/name
  promptPath?: string; // optional override; falls back to issue body
}
```

#### 3.2.2 AgentRegistry

Maps `agentProfile` strings (e.g. `claude-opus-fast`, `codex-strict`) to a concrete `(AgentProvider, SandboxProvider, BranchStrategy, env)` bundle. Loaded from `.orchestrator/profiles.ts`.

```ts
export const profiles: Record<string, AgentProfile> = {
  "claude-opus-fast": {
    agent: claudeCode("claude-opus-4-7"),
    sandbox: () => docker(),
    branchStrategy: { type: "named", template: "orchestrator/{itemId}" },
    env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY! },
  },
  "codex-strict": {
    agent: codex("gpt-5"),
    sandbox: () => vercel(),
    branchStrategy: { type: "merge-to-head" },
  },
};
```

#### 3.2.3 Dispatcher

Takes a `WorkItemEvent`, expands to N runs (one per `targetRepos[i]`), and launches them in parallel via `Promise.allSettled`. Each run:

1. Clones/fetches the target repo into a local cache (`~/.orchestrator/repos/<owner>__<name>`).
2. Calls `sandcastle.run({ agent, sandbox, cwd, promptFile, branchStrategy })`.
3. On success: opens a PR with body `Resolves <project-item-url>`.
4. On failure: writes the captured session log + error as an issue comment.

#### 3.2.4 ResultAggregator

After all N runs for an item resolve, updates Project fields:

- `Status` → `In Review` if all PRs opened, `Failed` if any errored, `Partial` mixed.
- `PR Links` → markdown list of opened PRs.
- `Sandcastle Session` → path to captured session JSONL (resumeable via `wt.run({ resume })`).

#### 3.2.5 Repo cache

Shared, append-only cache of bare clones at `~/.orchestrator/repos/`. Dispatcher does `git fetch` (cheap) before each run, then Sandcastle's `WorktreeManager` carves a worktree off the cache. Avoids cloning per run.

### 3.3 Concurrency model

- Per-item parallelism: N target repos run concurrently.
- Cross-item parallelism: bounded by `MAX_CONCURRENT_RUNS` env (default 4) — each run holds a sandbox (heavy).
- Backpressure: poll only picks up new items when the in-flight set is below cap.

---

## 4 GitHub Project Schema

### 4.1 Project selection (setup)

Sandcastle's `sandcastle init` scaffolds `.sandcastle/`. The orchestrator extends it with `.orchestrator/config.json` carrying the Project pointer.

Setup wizard:

```bash
gh project list --owner @me --limit 50    # show recent projects
orchestrator init --project 16            # write config
```

`config.json`:

```json
{
  "projectNumber": 16,
  "projectOwner": "biliboss",
  "projectNodeId": "PVT_kwHOABZNT84BXCg7",
  "pollIntervalSec": 30,
  "statusFieldId": "PVTSSF_lAHOABZNT84BXCg7zhSSLps",
  "repositoryFieldId": "PVTF_lAHOABZNT84BXCg7zhSSLp8"
}
```

### 4.2 Status workflow (real, from project 16)

```
Inbox
  ↓
Ready to Research        ← human moves here when problem worth investigating
  ↓
Researching              ← orchestrator dispatches RESEARCH agent
  ↓
Ready for Review (Research)  ← HUMAN GATE 1 — review research output
  ↓
Ready to-do              ← human moves here after approving research
  ↓
Doing                    ← orchestrator dispatches DEV agent
  ↓
Ready for Review         ← HUMAN GATE 2 — review PR(s)
  ↓
Done                     ← all PRs merged
```

Two automation triggers, two human gates. Items can skip stages (e.g. trivial fix: `Inbox → Ready to-do → Doing → Ready for Review → Done` — no research phase).

### 4.3 Stage mapping

| Status                        | Actor         | Action                                                                                  |
| ----------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| `Inbox`                       | human         | triage; decide if research needed                                                       |
| `Ready to Research`           | human → bot   | trigger: orchestrator picks up, CAS → `Researching`                                     |
| `Researching`                 | bot           | runs **research profile**: agent produces a research doc (markdown PR or issue comment) |
| `Ready for Review (Research)` | human         | reviews research; either rejects (back to `Researching`) or approves → `Ready to-do`    |
| `Ready to-do`                 | human → bot   | trigger: orchestrator picks up, CAS → `Doing`                                           |
| `Doing`                       | bot           | runs **dev profile**: agent produces code PR per target repo                            |
| `Ready for Review`            | human         | reviews PR(s); merges via repo merge queue                                              |
| `Done`                        | bot (webhook) | all linked PRs merged → status auto-flip                                                |

### 4.4 Native fields (project 16 already has them — no extension needed)

| Field                  | Use                                                               |
| ---------------------- | ----------------------------------------------------------------- |
| `Status`               | Workflow above                                                    |
| `Repository`           | **Native multi-repo field** — orchestrator reads target repo here |
| `Linked pull requests` | Auto-populated when PR body references issue                      |
| `Parent issue`         | Sub-issue tree → orchestrator can fan out children in parallel    |
| `Sub-issues progress`  | Native rollup for parent items                                    |
| `Labels`               | Tag `agent-profile:claude-opus-fast` etc — replaces custom field  |
| `Reviewers`            | Drives PR reviewer assignment                                     |

Two custom fields the orchestrator NEEDS to add:

| New field            | Type          | Purpose                                                |
| -------------------- | ------------- | ------------------------------------------------------ |
| `Agent Profile`      | Single-select | research-profile / dev-profile keys from `profiles.ts` |
| `Sandcastle Session` | Text          | session JSONL path for resume                          |

(Prompt source = issue body or linked markdown file referenced in body — no extra field.)

### 4.5 Multi-repo via sub-issues

Native pattern (already supported by Projects v2):

```
Parent issue: "Bump @org/proto to v3.2 across consumers"
  ├── sub-issue: org/web — bump proto
  ├── sub-issue: org/mobile — bump proto
  └── sub-issue: org/admin — bump proto
```

Each sub-issue is its own row with its own `Repository` field. Orchestrator dispatches sub-issues independently in parallel. Parent's `Sub-issues progress` rolls up natively.

This is cleaner than a `Target Repos` CSV — uses native GH primitives, gives each repo its own audit trail.

---

## 5 Runtime Flow

### 5.1 Happy path

```
1. User adds issue from org/web to Project.
2. User fills fields: Status=Ready, Agent Profile=claude-opus-fast,
   Target Repos="org/web,org/mobile", Prompt Path=".orchestrator/prompts/X.md".
3. Coordinator polls Project (every 30s).
4. Picks up item; CAS Status → In Progress.
5. Dispatcher resolves profile, fetches both repo caches.
6. Two sandcastle.run() in parallel:
   - org/web    → Docker sandbox → worktree → claudeCode → PR #142
   - org/mobile → Docker sandbox → worktree → claudeCode → PR #87
7. ResultAggregator updates fields:
   Status=In Review, PR Links="- org/web#142\n- org/mobile#87"
8. Human reviews each PR independently; merges via repo's own merge queue.
9. Coordinator detects all PRs merged via webhook → Status=Done.
```

### 5.2 Failure modes

| Failure                        | Coordinator action                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| Sandbox creation fails         | Mark run failed, comment on issue, no PR for that repo                                       |
| Agent idle timeout             | Sandcastle raises `AgentIdleTimeoutError`; comment + session path for resume                 |
| Some PRs open, some fail       | Status → `Partial`; PR Links lists successes, comments list failures                         |
| Coordinator crash mid-dispatch | On restart, items stuck in `In Progress` past TTL → re-dispatch (idempotent via branch name) |
| Target repo missing            | Validation rejects item before status flip; comment on issue                                 |

### 5.3 Resume

Each run captures a Sandcastle session JSONL. `Sandcastle Session` field stores the path. User can manually replay:

```bash
orchestrator resume --item <itemId> --repo org/web
```

Internally calls `sandcastle.wt.run({ resume: sessionPath, ... })`.

---

## 6 Implementation Sketch

### 6.1 Project layout

```
orchestrator/
├── src/
│   ├── ProjectPoll.ts          # GraphQL poller
│   ├── ProjectGraphQL.ts       # typed wrappers around Projects v2 API
│   ├── AgentRegistry.ts        # loads .orchestrator/profiles.ts
│   ├── Dispatcher.ts           # WorkItemEvent → N runs
│   ├── RepoCache.ts            # bare-clone manager
│   ├── ResultAggregator.ts     # writes back to Project
│   ├── Coordinator.ts          # wires components, runs loop
│   └── main.ts                 # CLI entry: `orchestrator start|resume|status`
├── .orchestrator/
│   ├── profiles.ts             # user-defined AgentProfile map
│   ├── prompts/                # shared prompt templates
│   └── .env                    # tokens
└── package.json
```

### 6.2 Coordinator pseudocode

```ts
import { run } from "@ai-hero/sandcastle";

async function coordinatorTick() {
  const events = await projectPoll.fetchReadyItems();
  for (const ev of events) {
    if (!(await projectPoll.tryClaim(ev.itemId))) continue; // CAS

    const profile = agentRegistry.get(ev.agentProfile);
    const runs = ev.targetRepos.map((repo) =>
      executeRun(ev, repo, profile).catch((e) => ({ repo, error: e })),
    );

    const results = await Promise.allSettled(runs);
    await resultAggregator.update(ev.itemId, results);
  }
}

async function executeRun(
  ev: WorkItemEvent,
  repo: string,
  profile: AgentProfile,
) {
  const cwd = await repoCache.ensureFresh(repo);
  const promptFile = await resolvePrompt(ev, cwd);

  const result = await run({
    agent: profile.agent,
    sandbox: profile.sandbox(),
    cwd,
    promptFile,
    branchStrategy: profile.branchStrategy,
    sessionDir: `~/.orchestrator/sessions/${ev.itemId}/${repo.replace("/", "__")}`,
  });

  const prUrl = await openPR(repo, result.branch, `Resolves ${ev.issueUrl}`);
  return { repo, prUrl, sessionPath: result.sessionPath };
}
```

### 6.3 CLI surface

```bash
orchestrator start              # run coordinator loop
orchestrator dispatch <itemId>  # force-dispatch one item (debug)
orchestrator resume <itemId> <repo>
orchestrator status             # show in-flight runs
orchestrator profiles           # list known agent profiles
```

---

## 7 Sandcastle Touchpoints

Things the orchestrator uses but does NOT reimplement:

- `sandcastle.run()` — every run.
- `SandboxProvider` interface — `docker()`, `podman()`, `vercel()`, `daytona()` selectable per profile.
- `AgentProvider` — `claudeCode`, `codex`, `pi`, `opencode` selectable per profile.
- `BranchStrategy` — `named` / `merge-to-head` / `head`.
- Session capture/resume — stored path piped into Project field.
- `WorktreeManager` (indirect via `run()`) — worktrees off the repo cache.

Things the orchestrator adds on top:

- Cross-repo coordination.
- Project-as-source-of-truth.
- Run fan-out (1 item → N sandboxes).
- Cache layer for bare clones.

---

## 8 Cross-Cutting Concerns

### 8.1 Git as database (worktrees)

Git itself is the durable store:

- **Bare repo cache** at `~/.orchestrator/repos/<owner>__<name>.git` (single clone, never deleted).
- Each run → `git worktree add` off the cache → isolated FS tree, shared object DB.
- Branch = transaction. Worktree = working set. Reflog = history.
- No separate state DB needed for "what did the agent do" — `git log <branch>` answers it.
- Worktree cleanup after PR merge → `git worktree remove`; branch survives in remote.

Implications:

- Concurrent runs on same repo, different branches → zero contention (worktrees are independent FS trees, same object DB).
- Idempotent dispatch: branch name = `orchestrator/<itemId>` → re-dispatch finds existing branch, resumes.
- No "lost work" — agent commits land in branch; even if sandbox dies, branch persists in remote.

### 8.2 Environment variables

Three layers, last wins:

```
.orchestrator/.env              ← global secrets (ANTHROPIC_API_KEY, GH_TOKEN)
.orchestrator/profiles.ts       ← per-profile env (model selection, agent flags)
.orchestrator/repos/<owner>__<name>/.env.orchestrator   ← per-repo overrides
```

Per-repo file lives **outside** the worktree (in cache dir), gitignored by convention. Loaded by orchestrator, passed via `run({ env })`. Sandcastle's `EnvResolver` already handles merging provider env + caller env — orchestrator just composes upstream.

Secret distribution rules:

- Never commit secrets to target repos.
- Orchestrator host process owns secrets; passes via sandbox env injection (Docker/Podman `-e`, Vercel sandbox env API).
- For isolated providers (Vercel/Daytona), env crosses network → use provider's secret API, not arg passing.

`profiles.ts` signature supports per-repo callback:

```ts
{
  agent: claudeCode("claude-opus-4-7"),
  sandbox: docker,
  env: (repo: string) => ({
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
    ...(repo === "mktvirtual/muki-bot" ? { MUKI_API_KEY: process.env.MUKI_API_KEY! } : {}),
  }),
}
```

### 8.3 Logs / session capture

Sandcastle already captures per-run session JSONL (events, tool calls, text deltas). Orchestrator wraps:

```
~/.orchestrator/sessions/
  <itemId>/
    <repo-slug>/
      session.jsonl       ← Sandcastle stream events
      stdout.log          ← agent stdout (mirrored)
      stderr.log          ← agent stderr
      meta.json           ← profile, branch, timing, exit, PR url
```

Session path written back to Project field `Sandcastle Session` → human can:

- `orchestrator inspect <itemId> <repo>` → tail logs
- `orchestrator resume <itemId> <repo>` → `wt.run({ resume: <path> })`
- `orchestrator export <itemId>` → bundle all sessions as zip for postmortem

Retention: keep N days (env `LOG_RETENTION_DAYS=30`); on cleanup, archive to `s3://...` if `LOG_ARCHIVE_URL` set, else delete.

Log noise: agent stream is verbose. Two views:

- **Live**: orchestrator TUI tails active runs (uses Sandcastle's `Display` + `Output`).
- **Audit**: JSONL never truncated; queryable via `jq` for token usage, tool calls, errors.

## 9 Open Questions

1. **PR merge synchronization** — when an item's repos have dependent changes (proto bump consumed by web), should we gate PR merges in order? Probable answer: out of scope; let CI handle it per repo. Document the limitation.
2. **Cost guardrails** — N parallel sandboxes per item × M concurrent items. Need a global cap and per-profile budget.
3. **Secret distribution** — `ANTHROPIC_API_KEY` per profile; do we want per-repo overrides? Yes, via `.orchestrator/profiles.ts` callback signature `(repo) => env`.
4. **Webhook vs poll** — start with poll (simpler, no public endpoint). Migrate to webhook if latency matters.
5. **Drift between cache and remote** — `git fetch --prune` on every `ensureFresh`. If a branch is rebased upstream, we use the new tip.

---

## 10 Glossary

- **AFK agent**: an AI coding agent the human leaves running unattended.
- **Bind-mount sandbox**: Sandcastle provider where host FS is mounted into the sandbox (Docker, Podman).
- **Isolated sandbox**: Sandcastle provider with its own FS, requiring sync-in/sync-out (Vercel, Daytona).
- **CAS**: compare-and-swap, used here for the `Status` field transition to prevent double-dispatch.
- **GitHub Projects v2**: GitHub's repo-agnostic board product; the only first-class GitHub primitive that spans repos.
- **Work item**: a row in a Project, backed by an issue in some repo.
