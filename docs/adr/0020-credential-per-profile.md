# One credential per agent profile (via Claude Code long-lived tokens)

## Context

The user runs multiple Claude Code identities side by side on the same host:

- `claude-pessoal` → `CLAUDE_CONFIG_DIR=~/.claude-pessoal`, personal Anthropic subscription
- `claude-mukutu` → `CLAUDE_CONFIG_DIR=~/.claude-mukutu`, work subscription

The coordinator dispatches against repos owned by different GitHub orgs (`mktvirtual/*` vs `biliboss/*`). Each dispatch must run with the correct identity — billing, rate limits, and access scopes all depend on it.

Claude Code stores its short-lived OAuth refresh token in the host's secret store (macOS Keychain entries named `Claude Code-credentials-<hash>`, one per `CLAUDE_CONFIG_DIR`). The Keychain is not reachable from a Linux container.

`claude setup-token` produces a **long-lived authentication token** that doesn't require Keychain access. The token is portable: write it to a file, inject it as an env var into the container, the in-container Claude reads it.

## Decision

Each credential set is a distinct **agent profile**. The label vocabulary on a GitHub Project item — `agent-profile:claude-pessoal`, `agent-profile:claude-mukutu` — selects both the agent runtime config AND the credential.

```ts
// .coordinator/profiles.ts
const claudePessoal: AgentProfile = {
  agent: claudeCode("claude-opus-4-7"),
  sandbox: () =>
    docker({
      imageName: "coordinator/agent-base",
      env: loadEnvFile(".coordinator/.env.pessoal"), // ANTHROPIC_AUTH_TOKEN=...
      network: "agent-net",
    }),
  branchStrategy: { type: "branch", branch: "coordinator/${itemId}" },
};

const claudeMukutu: AgentProfile = {
  agent: claudeCode("claude-opus-4-7"),
  sandbox: () =>
    docker({
      imageName: "coordinator/agent-base",
      env: loadEnvFile(".coordinator/.env.mukutu"),
      network: "agent-net",
    }),
  branchStrategy: { type: "branch", branch: "coordinator/${itemId}" },
};

export const profiles = {
  "claude-pessoal": claudePessoal,
  "claude-mukutu": claudeMukutu,
};
```

Token files are produced once per identity:

```bash
CLAUDE_CONFIG_DIR=~/.claude-pessoal claude setup-token > .coordinator/.env.pessoal
CLAUDE_CONFIG_DIR=~/.claude-mukutu  claude setup-token > .coordinator/.env.mukutu
```

`.coordinator/` is already gitignored (per the existing project layout); the token files inherit that.

## Consequences

**Positive**

- No keychain access at dispatch time. No interactive auth prompt on the host.
- Containers receive a token rather than a refresh path — works on Linux with no extra host integration.
- The label `agent-profile:<name>` already exists in the schema and is recognised by `ProjectPoll`. Credential routing is a parsing artifact, not a new field.
- Profiles double as a policy boundary: dispatches against `mktvirtual/*` are pinned to the work identity by convention.

**Negative**

- Long-lived tokens are higher-risk than per-session OAuth. Token files must stay outside Git and have tight filesystem permissions (mode 600).
- Token rotation is manual: `claude setup-token` needs to be re-run per identity when Anthropic revokes or rotates.
- Mapping `repo → credential` is implicit in profile choice. A future contributor adding a `mktvirtual` repo to the queue must remember to label it `agent-profile:claude-mukutu` or accept the default profile, which may use the wrong identity.

## Alternatives considered

- **Extract OAuth from Keychain per dispatch via `security find-generic-password`** — rejected: prompts the user every time, doesn't work in headless mode.
- **`ANTHROPIC_API_KEY` (pay-as-you-go API)** — rejected: bypasses subscription, costs money proportional to agent traffic.
- **Hard-coded `repo → credential` map in `profiles.ts`** — rejected: hides the choice from the GitHub UI, where humans triage work.
- **Custom `Credentials` field in the Project board** — rejected: doubles the schema for something the existing `agent-profile` label already encodes.
