# Use the `gh` CLI for GraphQL instead of adding an Octokit dependency

## Context

The coordinator layer talks to the GitHub GraphQL API for every poll, claim, and field update. The two obvious transport choices are:

- `@octokit/graphql` (or `@octokit/rest`) — a typed JS client, the standard way to talk to GitHub from Node.
- The `gh` CLI's `gh api graphql` subcommand — wraps the same API, reuses the user's existing GitHub auth.

Sandcastle's existing dependency footprint is intentionally small (`effect`, `@clack/prompts`, no HTTP client). Adding Octokit would pull in `node-fetch` / `undici` shims and a typed-client surface that we'd touch in exactly one layer.

The `gh` CLI is a hard prerequisite for the broader workflow anyway: humans use it to manage the project, the coordinator opens PRs through it, and downstream `wt` integrations rely on `gh pr create`. Requiring it for GraphQL transport doesn't add a new prerequisite — it just leans on one we already have.

## Decision

Implement GraphQL transport via `gh api graphql -f query=<text> -F <var>=<value>`. The coordinator never imports Octokit. The transport is exposed as a small `FetchGraphQL` function that the rest of the layer depends on; production wires it to `createGhFetchGraphQL` (which shells `gh`), tests pass an in-memory fake.

```ts
type FetchGraphQL = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<any>;
```

## Consequences

**Positive**

- Zero new runtime dependencies. The coordinator subpath stays as light as the rest of `@ai-hero/sandcastle`.
- Auth comes for free: `gh auth login` already covers it, including org-restricted tokens and per-host config (`gh auth login --hostname enterprise.example.com`).
- The transport is trivially injectable for tests — the fake is a `vi.fn()`, no `nock` or `msw` needed.
- The exact same query text can be pasted into `gh api graphql -f query=...` from the shell to reproduce a coordinator call. Useful when debugging field IDs or option IDs.

**Negative**

- No typed GraphQL responses. Each call site validates the shape it needs. The codebase uses `any` at the transport boundary and narrows inside each module — a deliberate trade-off documented in the type definitions.
- Spawning `gh` per call has more overhead than keeping an HTTP keep-alive open. At the coordinator's tick rate (poll every 30 s, a few mutations per dispatched item) this is negligible — under 10 process spawns/min in steady state.
- `gh` must be on `$PATH` for the host running the coordinator. CI environments without `gh` need to install it (one apt/brew step).

## Alternatives considered

- **`@octokit/graphql`** — rejected: adds a runtime dependency for a use case that doesn't justify it.
- **Raw `fetch` + manual `Authorization: bearer <token>`** — rejected: requires us to own token storage, refresh logic, and enterprise-host config. `gh` already solves those.
- **Mixed: `gh` for auth probe, Octokit for queries** — rejected: two transports complicate testing.
