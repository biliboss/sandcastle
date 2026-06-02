# Dashboard ↔ tmux send-keys bridge

## Context

The embedded coordinator dashboard already streams the JSONL event log over SSE — the operator can see what's happening, but cannot _act_ on it without leaving the browser and switching panes. Common follow-up actions (re-prompt the running Claude session, abort, ask a clarifying question, retry a failed dispatch) all live in the same tmux pane that launched the coordinator. Bridging that pane to the dashboard collapses the loop.

The coordinator typically runs inside a Claude Code session inside a tmux pane. So the dashboard server already has the ambient identity needed to know _which_ pane to send keys to (`$TMUX_PANE`) — there's no external lookup needed.

## Decision

Add a minimal HTTP control plane to `dashboardServer.ts`:

- New module `tmuxBridge.ts` exposing `sendKeys(text, {enter})` + `capturePane(lines)` — both shell out to `tmux` via `execFile`. Tests inject a runner.
- `POST /act/<verb>` route, server-side allowlist (currently `prompt` only).
- New event type `action.ack {actionId, verb, ok, error?}` emitted into the same JSONL bus after every action attempt. Dashboard correlates POST response → ack via `actionId`.
- Pane resolution chain: `--tmux-target-pane <id>` flag → `SANDCASTLE_TMUX_TARGET` env → `$TMUX_PANE`. When none resolves, action endpoints return 503 and the dock UI stays hidden.
- All `tmux send-keys` invocations use the `-l` (literal) flag so payloads like `C-c` or `Enter` are typed as text rather than interpreted as chords.

## Rejected alternatives

**Shared-secret token in headers.** The server already binds `127.0.0.1` only and verbs are allowlisted. Adding bearer auth on top complicates setup without raising the security floor in the localhost threat model. Easy to add later if the bind ever changes.

**Free-form shell exec endpoint.** Even on localhost, a `POST /exec {cmd}` route would let any tab on the machine drive arbitrary shell. The verb allowlist is the line.

**`orch-state` skill coupling for pane resolution.** Pleasant for the maintainer's personal setup but couples upstream `mattpocock/sandcastle` to a private skill. The flag/env/`$TMUX_PANE` chain is just as ergonomic with zero coupling.

**Server-side polling of tmux output for ack.** The `action.ack` event ships through the existing SSE stream — no second channel, no polling, identical replay semantics.

## Consequences

**Positive**

- Two-keystroke loop: see a problem in the dashboard, type the fix-prompt, hit Enter. No pane switch.
- Same JSONL substrate carries actions and effects — replay works for both.
- Pure module shape (`TmuxBridge` interface with injected runner) keeps the bridge testable without spawning a real tmux.

**Negative**

- The dashboard now mutates external state. A bug in the verb allowlist or path-traversal guard becomes a remote-control vulnerability (mitigated by localhost bind + small allowlist).
- Pane id can become stale if the operator closes/reopens the session. Currently surfaces as a `tmux send-keys` error on the next action; future work could re-resolve through `$TMUX_PANE` of the coord process if the pinned id disappears.

**Neutral**

- Adds a `tmux` host dependency for the bridge feature. The dashboard works without it; the dock just stays hidden when `tmuxEnabled: false`.
