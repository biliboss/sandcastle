# Shared `coordinator/agent-base` image (not per-repo)

## Context

Sandcastle's `docker()` provider expects one image per project. The default flow is `sandcastle docker build-image`, which builds from a `Dockerfile` in the **host repo** and tags the result `sandcastle:<repo>`. Each project owns its own image.

The coordinator layer (ADR 0015) drives `sandcastle.run()` across many repos read from a GitHub Project. Most target repos won't have a `Dockerfile` — they're application code, not container projects. Building one image per target repo would mean:

- a `Dockerfile` per repo (intrusive — most repos don't want one)
- one image rebuild per repo per coordinator host
- N images on disk for N repos, even when 90% of the toolchain is identical

## Decision

The coordinator ships a single image, `coordinator/agent-base`, and uses it for **every** dispatch regardless of target repo. The image is built from `src/coordinator/docker/Dockerfile` in this fork and tagged locally via a new subcommand:

```bash
coordinator build-image    # docker build -t coordinator/agent-base ./src/coordinator/docker
```

Agent profiles pass `imageName: "coordinator/agent-base"` to `docker()`, so Sandcastle's image-derivation logic (which would otherwise produce `sandcastle:<repo>`) is bypassed.

## Consequences

**Positive**

- Coordinator works against arbitrary repos with no upstream changes to those repos.
- One image build per coordinator host, not per dispatch.
- Hardening (read-only rootfs, tmpfs, resource caps, user setup) lives in one place.
- Removes a friction point — most candidate repos can join the coordinator's queue immediately.

**Negative**

- The image is opinionated. Repos needing a toolchain not in the base must opt in via a per-repo setup hook (ADR 0019).
- Diverges from Sandcastle's per-repo image convention, so a coordinator-using fork can't piggyback on `sandcastle docker build-image`.
- Image authority becomes our problem: if the base is broken, every dispatch breaks.

## Alternatives considered

- **Per-repo `Dockerfile` + `sandcastle docker build-image`** — rejected: requires intrusive changes to every target repo and produces N images.
- **Polyglot fat image with every toolchain** — rejected: 3-5 GB image, slow pulls, most toolchains unused per dispatch (see ADR 0019 for the opt-in alternative).
- **Pre-built image in a registry (ghcr.io)** — deferred: adds CI + auth surface. Local `build-image` is enough for the current single-host use case.
