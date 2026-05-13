# Agent containers attach to an ICC-disabled bridge network

## Context

Each dispatch runs in its own Docker container. By default, all containers on Docker's `bridge` network can reach each other on every port. With multiple concurrent dispatches — and the coordinator's design encourages it — one agent could:

- discover and reach a sibling agent's HTTP server, MCP socket, or debug port
- exfiltrate workspace state from a sibling worktree
- coordinate with a sibling without the operator's knowledge

The agent's outbound internet access (talking to `api.anthropic.com`, `github.com`, npm registry) is a separate concern, handled in a follow-up.

## Decision

The coordinator creates a dedicated Docker bridge network with inter-container communication disabled, and pins every dispatch container to it.

```bash
docker network create \
  --driver bridge \
  --opt com.docker.network.bridge.enable_icc=false \
  agent-net
```

Profiles pass `network: "agent-net"` through `docker({ network })`. Sandcastle already accepts this option; no provider change needed.

The network is created lazily by `coordinator start` if absent (idempotent). Removal is manual — once provisioned, the network is shared across all hosts that need it.

## Consequences

**Positive**

- Sibling agents cannot reach each other. A compromised agent loses one whole class of lateral movement.
- Zero runtime cost. ICC is enforced by the bridge's `iptables` rules.
- Sandcastle's `network` option is reused, so no provider extension needed for this ADR alone.

**Negative**

- Outbound internet is still wide open. A malicious or runaway agent can still reach arbitrary hosts (DNS exfiltration, third-party APIs, etc.). Mitigating this needs an egress allowlist (squid/tinyproxy on a sibling container), tracked as a follow-up.
- Agents that _want_ to talk to each other (e.g. a research agent serving its output to a reviewer agent in the same project) need to opt in to a different network or work via the host filesystem.
- The shared network is a single namespace — if a future agent profile needs different siblings, we'll need per-project networks.

## Follow-up

Out of scope for this ADR but tracked:

- Stand up a `coordinator-proxy` container running squid/tinyproxy with an allowlist of `api.anthropic.com`, `github.com`, npm registry, github content CDN.
- Dispatch containers inject `HTTPS_PROXY=http://coordinator-proxy:3128` via `docker({ env })`.
- This will be a separate ADR when implemented (likely 0023).

## Alternatives considered

- **`--network none`** — rejected: cuts off `api.anthropic.com`, breaks the agent.
- **Default bridge network** — rejected: no isolation between sibling agents.
- **Per-dispatch ephemeral network** — rejected: `docker network create` per dispatch adds overhead and complicates cleanup; doesn't change the security posture vs. one shared ICC-disabled network.
