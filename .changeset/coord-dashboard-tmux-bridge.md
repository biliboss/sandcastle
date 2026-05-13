---
"@ai-hero/sandcastle": patch
---

coordinator: dashboard ↔ tmux send-keys bridge. New `--tmux-target-pane %N` flag (or `SANDCASTLE_TMUX_TARGET` env, or auto-detect `$TMUX_PANE`) wires the dashboard's bottom prompt dock to a tmux pane via `tmux send-keys -l`. POST `/act/prompt {text}` returns an `actionId`; coordinator emits `action.ack {actionId, verb, ok, error?}` once the send completes.

Dashboard refactored from a single 1,100-line `dashboard.html` into a `dashboard/` directory: 6 CSS files split by visual region, 10 ES module JS files (no build step — browser-native `import`), and an HTML shell driven by Alpine.js v3 (CDN, no bundler). Reactive state lives in `Alpine.store("coord")` and templates use `x-for`/`x-text`/`x-html` against that store; pure helpers are exposed as Alpine magics (`$fmt`, `$classify`, `$eventLine`, `$pipeline`, `$poll`). The server serves the bundle via a new `/static/<path>` route (path-traversal guarded). Postbuild copies the full directory into `dist/coordinator/dashboard/`. Each file carries an inline header doc comment for future agent-driven refactors.

Failed dispatches surface a colored error-kind chip (`[AUTH]`, `[CLONE]`, `[PUSH_REJECT]`, `[TIMEOUT]`, `[UNKNOWN]`) classified by a new pure module `errorClassifier.ts`, with the dashboard mirroring the regex set in `dashboard/js/classifyError.js`. Click an error row to expand the full stderr.
