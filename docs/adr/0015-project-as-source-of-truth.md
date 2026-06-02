# GitHub Project (v2) as the coordinator's source of truth

## Context

The multi-repo coordinator layer (`src/coordinator/`) drives `sandcastle.run()` across many repos. It needs a place to record:

- what work items exist
- what state each is in (researching / done / waiting on human review)
- which repo(s) each item targets
- where to find the captured Sandcastle session

A naive choice would be a local SQLite or a custom REST service. Both add operational surface (migrations, backups, deploy, auth) that we don't otherwise need.

GitHub Projects v2 already supplies:

- a repo-agnostic board that natively spans repositories
- native fields (`Repository`, `Linked pull requests`, `Parent issue`, `Sub-issues progress`) that match the coordinator's data model 1:1
- a GraphQL API with both reads and writes
- a UI that humans already use for review gates
- per-organisation auth via `gh` CLI

## Decision

Use a GitHub Project (v2) board as the **only** persistent store the coordinator depends on. The coordinator process itself is stateless — every restart re-reads the project to discover what to do.

State that must persist across coordinator restarts lives on the project:

| Coordinator data        | Project surface                                                     |
| ----------------------- | ------------------------------------------------------------------- |
| Work queue              | Project items in `Ready to Research` / `Ready to-do`                |
| In-flight items         | Project items in `Researching` / `Doing`                            |
| Review queue            | Project items in `Ready for Review (Research)` / `Ready for Review` |
| Multi-repo work         | Parent issue + sub-issues each with `Repository` field              |
| Session log location    | `Sandcastle Session` text field                                     |
| Agent profile selection | `agent-profile:<name>` label on the backing issue                   |

State that doesn't need to persist (current tick's in-memory event list, transient errors) stays in the coordinator process and is recomputed on restart.

## Consequences

**Positive**

- No coordinator-owned database to provision, back up, or migrate.
- The same UI humans already use for review gates is the operator surface for the coordinator — no separate dashboard to build.
- Multiple coordinator hosts can run in parallel against the same project; the project's status field plus a CAS claim (ADR 0016) keeps them consistent.
- Native sub-issue rollup gives parent items free progress tracking when a piece of work fans out across repos.

**Negative**

- Coordinator throughput is bounded by GraphQL rate limits (5000 points/hour per token). Each tick consumes ~3 points per ready item.
- A custom field schema (`Agent Profile`, `Sandcastle Session`) must be created in each project. `coordinator init` resolves the field IDs and writes them to `.coordinator/config.json` so subsequent commands skip the lookup.
- Items can only express what the Projects v2 schema allows; anything outside that (e.g. a complex dependency graph) belongs in the issue body, not in a custom field.
- If GitHub is down, the coordinator can't tick. Acceptable for an AFK-agent workflow but worth flagging.

## Alternatives considered

- **Local SQLite + filesystem state** — rejected: requires a dashboard for humans to triage, doesn't span repos for free.
- **Jira / Linear** — rejected: would add a non-GitHub dependency for a tool that otherwise lives entirely inside the GitHub ecosystem.
- **A separate orchestrator service (REST + DB)** — rejected: ops cost is large relative to the leverage gained.
