# This fork is a product, not a clean PR

## Context

The multi-repo coordinator started as a feature branch on a fork of `mattpocock/sandcastle`. Several decisions during design (ADRs 0015–0020) require touching the surface of Sandcastle itself:

- Extend `DockerOptions` with `memory`, `cpus`, `readOnly`, `tmpfs` for hardening (gap surfaced during the OrbStack grill).
- Bypass `sandcastle docker build-image`'s per-repo image convention in favour of a shared `coordinator/agent-base` (ADR 0018).
- Wire the coordinator's `Dispatcher` directly into `sandcastle.run()`'s options surface.

Keeping every change minimal and upstream-friendly would impose two costs:

- Coordinator features stall on upstream review cycles.
- Some changes (e.g. cross-cutting `DockerOptions` extensions) are unlikely to land upstream as-is.

## Decision

This fork (`biliboss/sandcastle`, branch `feat/multi-repo-orchestrator`) is treated as **our own product**, not as a candidate PR to `mattpocock/sandcastle`. We modify Sandcastle internals freely when the coordinator's needs justify it.

Specifically:

- `DockerOptions` is extended in this fork to expose container hardening flags (resource caps, read-only rootfs, tmpfs, proxy env).
- `WorktreeManager`'s default worktree location is overridden by the coordinator to `~/src/factory/.worktrees/<repo>/<branch>` (ADR 0007's lock semantics remain intact).
- Any future Sandcastle internal we need is fair game.

Where a change is generally useful AND upstream-friendly, we may open a separate PR on `mattpocock/sandcastle` mirroring the patch — but the fork is not blocked on that PR's review.

## Consequences

**Positive**

- The coordinator ships at our pace. Design pressure flows from our use case, not from upstream's intent.
- We can take cross-cutting changes (provider extensions, agent provider tweaks) that would be too invasive for a PR.
- Decisions are documented locally (this ADR set), removing the need to write upstream-justification docs for every internal change.

**Negative**

- Rebase from upstream gets harder as our patches accumulate. We accept this — upstream sync is a periodic chore, not a per-commit constraint.
- Bug fixes in upstream Sandcastle don't reach us automatically. We pull them in deliberate batches.
- The package name `@ai-hero/sandcastle` is now ambiguous: same name, divergent contents. Publishing this fork to npm would require a rename. For now we run from source, so the ambiguity is internal only.

## Alternatives considered

- **Stay upstream-clean** — rejected: blocks coordinator velocity on review cycles.
- **Rename the fork to `@biliboss/coordinator` and depend on `@ai-hero/sandcastle` as a library** — deferred: a future option once the coordinator API stabilises. Until then the deep integration with Sandcastle internals makes a separate package premature.
