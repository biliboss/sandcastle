# Pane mirror via tmux pipe-pane + xterm.js, not capture-pane polling

## Context

The dashboard's tmux send-keys bridge (ADR 0023) lets the operator drive the running Claude pane from the browser, but it's still write-only. To close the loop the dashboard needs to _show_ what the pane is doing — what Claude printed in response, what the shell echoed. Two ways to lift pane output into the browser:

1. **Poll** with `tmux capture-pane -p -t <pane>` every N seconds, diff, send the new bytes.
2. **Stream** with `tmux pipe-pane -o -t <pane> 'cat >> <file>'` once at startup, then tail-follow the file from the server and forward to SSE.

## Decision

Use option 2: `tmux pipe-pane` writes the live pane stream to a file under `~/.coordinator/pane.log`; a new SSE route (`/mirror/stream`) tails it with the same byte-offset replay pattern as `/stream`. The browser renders the bytes through xterm.js for ANSI fidelity (colors, cursor, TUI redraws).

The log file is capped (rotated by truncate-from-head when it exceeds N×TICK lines). On client connect, the server replays the last N bytes via `Last-Event-ID` then attaches the live tail.

## Rejected alternatives

**`tmux capture-pane` polling.** Three problems:

- The visible pane is a snapshot of the screen, not the scrollback delta — to "stream" you have to diff, and `capture-pane` doesn't give a stable cursor position to diff from.
- Polling cadence is a knob: too fast wastes CPU, too slow loses latency on TUI redraws.
- Doesn't capture between-poll output that flushes and scrolls off.

**Strip ANSI → plain text.** Cheaper to render, but loses Claude's colored output and any TUI formatting. Also breaks the "I'm watching the same thing the operator sees" mental model.

**Server-side ANSI-to-HTML conversion.** Works for log-style output, breaks on cursor-positioning TUIs (Claude's progress UI). xterm.js is the only thing that survives the full ANSI surface.

## Consequences

**Positive**

- The mirror panel uses the same byte-offset replay primitive as the main event SSE — one mental model, one bug class to test.
- xterm.js renders identically to a "real" terminal so the operator's mental map of what the pane shows transfers.
- Read-only ↔ two-way is a small step (just bind keystroke events back to `/act/mirror-prompt`).

**Negative**

- xterm.js adds ~300KB to the bundle. Mitigated by lazy-loading: only fetched when the operator opens the mirror rail.
- `tmux pipe-pane` writes a file that grows unboundedly without rotation — must cap on the server side.
- `pipe-pane` is process-bound: when the targeted pane exits, the file stops growing, and the dashboard sees a quiet stream rather than an error. Need to surface that as a "pane closed" toast.

**Neutral**

- Adds one more host dependency on `tmux`, already required by the send-keys bridge (ADR 0023).
