# CAS-style claim on the project's Status field

## Context

ADR 0015 commits the coordinator to using a GitHub Project (v2) as its only persistent store. The coordinator polls the project on an interval and dispatches every item in a trigger status (`Ready to Research` or `Ready to-do`).

Multiple coordinator hosts can run against the same project — useful for HA, useful for one host per developer machine. Without coordination they'd race: two coordinators both see the same item in `Ready to-do`, both spawn a Sandcastle run, both push branches, both open PRs.

GitHub Projects v2 has no native lock primitive and no atomic CAS on a field. The closest building block is "set field value" — a write that doesn't take a precondition.

## Decision

Approximate CAS in application code via a **read-then-write** sequence on the `Status` field:

1. The coordinator's poll returns items in trigger statuses.
2. Before dispatching, the coordinator re-reads each item's Status via `node.fieldValueByName("Status")`.
3. If the re-read value still equals the trigger status (`Ready to-do`), the coordinator writes the next status (`Doing`) and proceeds.
4. If the re-read value has changed (someone else moved it), the coordinator skips the item.

The window between read and write is small (one mutation round-trip). The race is bounded: two coordinators can both succeed only if both reads observe the trigger status AND both writes interleave before either sees the other's update. In practice GraphQL responses are serial enough that this is rare, and a duplicate dispatch is recoverable (idempotent branch name per item — see ADR 0017 / `branchStrategy: { type: "named", template: "coordinator/{itemId}" }`).

## Consequences

**Positive**

- No new infrastructure (lock service, distributed coordination layer) needed.
- A "Doing" status visible to humans doubles as the indicator that something is running — no separate "in-flight" view needed.
- A coordinator crash mid-dispatch leaves the item in `Doing`. On restart, that status is not a trigger, so it won't be re-dispatched automatically. A human (or a janitor job) can roll it back to `Ready to-do` after a TTL.

**Negative**

- The race window is narrow but non-zero. If exact-once dispatch matters, this approach is insufficient — but for AFK-agent work the cost of a rare duplicate dispatch is low (one wasted run, branch name collision detected by Sandcastle).
- The coordinator pays one extra GraphQL round-trip per item per tick (the read-back). Within the rate-limit budget for realistic project sizes (~150 items, 30 s tick).
- The `Status` field becomes load-bearing — renaming or removing it breaks the coordinator. `coordinator init` snapshots the field ID into `.coordinator/config.json` to limit the blast radius.

## Alternatives considered

- **Add a dedicated `Lock` text field** holding the coordinator's hostname + timestamp — rejected: complicates the schema and still needs read-then-write to be correct.
- **External lock service (Redis, Postgres advisory locks)** — rejected: violates ADR 0015's commitment to "the project IS the store".
- **Single-coordinator constraint** — rejected: prevents per-developer setups and removes the HA story.
