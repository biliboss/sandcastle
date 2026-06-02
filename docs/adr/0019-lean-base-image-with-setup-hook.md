# Lean base image + opt-in per-repo setup hook

## Context

ADR 0018 commits to a single shared `coordinator/agent-base` image used across every dispatch. The image's toolchain is now a contested resource: the coordinator targets repos in many languages (JavaScript, Python, Go, Rust, Ruby, Java) but every byte added to the image hits cold-start latency on every dispatch and disk on every coordinator host.

We want the image as lean as possible — but the coordinator still has to be useful for non-trivial repos that need to build, lint, or test.

## Decision

The base image carries only what is universally useful:

- `git`, `curl`, `ca-certificates`
- `node` + `npm` (Claude Code itself is a Node app)
- `@anthropic-ai/claude-code` (the agent)
- `ripgrep`, `fd`, `jq` (agent-friendly file tooling)

Per-repo customisation is opt-in via a `.coordinator/setup.sh` script committed to the **target repo**. If the file exists on the cloned worktree, the container runs it as the `agent` user before invoking Claude. Repos that need a Go toolchain, a Python venv, or `pnpm install` ship that script themselves.

```
container start
  ↓
[ -x /workspace/.coordinator/setup.sh ] && bash /workspace/.coordinator/setup.sh
  ↓
exec claude ...
```

## Consequences

**Positive**

- Base image stays around 500 MB. Pull-once cost is bounded.
- Toolchain decisions live with the repo that needs them, not with the coordinator.
- Repos that don't need extra tooling (markdown-only collections, research-only items) pay nothing.
- The setup-hook contract is small and easy to inspect for new contributors.

**Negative**

- A repo without `setup.sh` that needs a non-JS toolchain will fail at the agent's first build/test attempt. The agent doesn't have a way to install system packages — by design, the image is read-only at the system layer.
- Two-tier mental model: "what's in the base" vs "what the repo brings". Surprising for users used to all-in-one images.
- The setup hook runs untrusted code from the target repo. Acceptable because the container is already isolated (read-only rootfs, no host secrets beyond mounted credentials), but it does mean a malicious repo can mine cycles inside the container's resource budget.

## Alternatives considered

- **Fat polyglot base** — rejected: 3-5 GB image, most layers unused per dispatch.
- **Per-language base family (`agent-base-go`, `agent-base-python`, ...)** — deferred: defensible if the setup-hook proves too slow, but adds an image dimension to maintain.
- **Detect language at dispatch and install on the fly** — rejected: slow first dispatch per repo, no caching across containers (rootfs is read-only).
