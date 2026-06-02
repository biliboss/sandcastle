# dashboard/

Static assets served by `dashboardServer.ts` for the embedded coordinator
dashboard. Browser loads `index.html` → six CSS files + Alpine.js (CDN) +
ES module entry (`js/main.js`). No build step.

## Layout

```
dashboard/
  index.html            # shell + Alpine templates (x-for/x-text/x-html)
  README.md             # this file
  css/                  # split by visual region (theme/header/sections/station/recent/dock)
  js/
    main.js             # Alpine bootstrap: store + magics + x-data factory
    state.js            # buildStore() — $store.coord (events, items, ack, tmux, now)
    stream.js           # SSE wiring → store.pushEvent
    actions.js          # /info + /act/prompt — operates on store
    stats.js            # pollProgress / pollRemaining / ringOffset (helpers)
    classifyError.js    # stderr → {kind, cls}  (mirror of errorClassifier.ts)
    eventLine.js        # event → {kind, glyph, html}  (used via $eventLine magic)
    pipeline.js         # item → HTML for the 5-node strip  (used via $pipeline magic)
    util.js             # fmtTime, fmtElapsed, fmtUptime, escape, $
    config.js           # constants: PIPELINE, RING_C, TICK_HISTORY_MAX, TOAST_MS
```

## Reactive model

State lives in `Alpine.store("coord")` (registered in `main.js` from
`buildStore()`). Templates in `index.html` read it via `$store.coord.*`.
Helpers are exposed as Alpine magics so templates stay declarative:

| Magic        | Purpose                                            |
| ------------ | -------------------------------------------------- |
| `$fmt`       | `{ time, elapsed, uptime, escape }`                |
| `$classify`  | `classifyError(stderr) → { kind, cls }`            |
| `$eventLine` | `renderEventLine(ev) → { kind, glyph, html }`      |
| `$pipeline`  | `pipelineHtml(item) → string` (used with `x-html`) |
| `$poll`      | `{ remaining, ringOffset }` for the countdown ring |

A 1Hz `setInterval` (in `dashboard.init()`) bumps `$store.coord.now`, which
makes uptime, per-station elapsed, and the countdown ring re-evaluate.

## What stays imperative

Tiny surfaces where Alpine costs more than it saves:

- `#connState` dot — `stream.js` writes `style.color` directly on SSE open/error.

Everything else is declarative.

## Adding a new event type

1. Extend the union in `src/coordinator/events.ts`.
2. Update emit sites (`Dispatcher.ts`, `Coordinator.ts`, etc).
3. Add a case in `js/eventLine.js` for the station log.
4. If it should affect aggregation, extend `rebuildItems` in `js/state.js`.
5. If it needs a new CSS class, add `.log-line.k-<kind>` in `css/station.css`.

## Adding a new action verb

1. Add to `ACTION_VERBS` set in `dashboardServer.ts`.
2. Add a branch in `handleAction` for the new verb.
3. Add a UI affordance in `index.html` and a method on the `dashboard`
   x-data factory in `js/main.js` (or extend `actions.js`).
4. Acks ride the existing `action.ack` event — no new type needed.

## Adding a new derived view

Add a getter on the store object returned by `buildStore()` in `state.js`.
Templates pick it up automatically because Alpine treats getters as
reactive computed values.

## Conventions

- **One responsibility per file.**
- **Templates own structure; helpers own logic.** Anything more than a
  ternary in a `:class` or `x-text` should move into a magic helper.
- **Element ids are minimal**: only used by `stream.js` (`#connState`)
  because it's the lone imperative DOM target.
- **`classifyError.js` mirrors `src/coordinator/errorClassifier.ts`.**
  Change one, change the other.
