/**
 * state.js — Alpine.store("coord") factory + incremental dispatch-item map.
 *
 * Mutation flow:
 *   stream.js → store.pushEvent(ev)
 *     ├─ tick.start  → updates store.lastTickAt
 *     ├─ tick.done   → appends store.tickHistory (capped)
 *     ├─ action.ack  → routes to store.handleAck
 *     └─ everything else → push to store.events AND apply to store._itemsMap
 *
 * Read path:
 *   templates read $store.coord.{items, active, completed, errored, recentTicks, ...}
 *   `items` is a snapshot of the internal Map's values — O(items) per access,
 *   not O(events). Active/completed/errored/okCount are O(items).
 *
 * Lifecycle:
 *   teardown() — invoked from dashboard.destroy() to clear interval/SSE.
 *
 * Determinism contract: pushing N events one-by-one MUST yield the same
 * `items` shape as a from-scratch rebuild over the same N events. The test
 * suite (state.test.ts) pins this contract — any change to applyItemEvent
 * needs to keep all those tests green.
 */

import { TICK_HISTORY_MAX } from "./config.js";

export function buildStore() {
  return {
    events: [],
    tickHistory: [],
    lastTickAt: null,
    pollIntervalSec: null,
    bootedAt: Date.now(),
    now: Date.now(),
    tmux: { enabled: false, target: "" },
    /** "init" | "open" | "error" — drives the header connection dot. */
    connState: "init",
    ack: { hint: "ready", toast: { msg: "", isErr: false, show: false } },
    pendingActions: new Map(),

    // Internal: incremental item aggregation. Mutated only by pushEvent →
    // applyItemEvent. Templates read it via the `items` getter below.
    _itemsMap: new Map(),

    // Mutable handles for teardown — set by stream.js + main.js.
    _es: null,
    _tickIntervalId: null,
    _toastTimer: null,

    /** Receive one SSE event. All event-driven state mutation lives here so
     *  read-side getters can stay pure. */
    pushEvent(ev) {
      if (ev.type === "action.ack") {
        this.handleAck(ev);
        return;
      }
      if (ev.type === "tick.start") {
        this.lastTickAt = ev.ts;
        return;
      }
      if (ev.type === "tick.done") {
        this.tickHistory.push({ ts: ev.ts, busy: (ev.itemCount ?? 0) > 0 });
        // Bound the array so unbounded sessions don't grow without limit.
        if (this.tickHistory.length > TICK_HISTORY_MAX * 4) {
          this.tickHistory.splice(
            0,
            this.tickHistory.length - TICK_HISTORY_MAX * 4,
          );
        }
        return;
      }
      this.events.push(ev);
      applyItemEvent(this._itemsMap, ev);
    },

    handleAck(ev) {
      this.pendingActions.delete(ev.actionId);
      if (ev.ok) {
        this.ack.hint = "ack · ready";
        this.toast(`${ev.verb} ack`, false);
      } else {
        this.ack.hint = "ack · failed";
        this.toast(`${ev.verb} failed: ${ev.error || "unknown"}`, true);
      }
    },

    toast(msg, isErr) {
      this.ack.toast = { msg, isErr, show: true };
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => {
        this.ack.toast = { ...this.ack.toast, show: false };
      }, 2400);
    },

    /** Released on dashboard.destroy() — interval + SSE handle. */
    teardown() {
      if (this._tickIntervalId) clearInterval(this._tickIntervalId);
      if (this._toastTimer) clearTimeout(this._toastTimer);
      if (this._es) {
        try {
          this._es.close();
        } catch {
          /* ignore */
        }
      }
      this._tickIntervalId = null;
      this._toastTimer = null;
      this._es = null;
    },

    // --- Derived views (read-only over _itemsMap + tickHistory) ---

    get items() {
      return [...this._itemsMap.values()];
    },
    get active() {
      return this.items
        .filter((i) => i.state === "running")
        .sort((a, b) => (a.lastTs < b.lastTs ? 1 : -1));
    },
    get completed() {
      return this.items
        .filter((i) => i.state === "ok" || i.state === "error")
        .sort((a, b) => (a.lastTs < b.lastTs ? 1 : -1))
        .slice(0, 12);
    },
    get errored() {
      return this.items.filter((i) => i.state === "error").length;
    },
    get okCount() {
      return this.items.filter((i) => i.state === "ok").length;
    },
    get recentTicks() {
      return this.tickHistory.slice(-TICK_HISTORY_MAX);
    },
  };
}

/**
 * Apply one event to the items map. Pure with respect to `map` only —
 * no other store fields mutated here.
 *
 * Exported so the test suite can verify equivalence with a from-scratch
 * rebuild on the same event sequence.
 */
export function applyItemEvent(map, ev) {
  const id = ev.itemId;
  if (!id) return;
  let item = map.get(id);
  if (!item) {
    item = {
      itemId: id,
      repo: ev.repo,
      title: ev.issueTitle,
      issueNumber: ev.issueNumber,
      events: [],
      firstTs: ev.ts,
      lastTs: ev.ts,
      state: "running",
      phase: null,
      profile: null,
      prUrl: null,
      error: null,
      steps: {
        cache: false,
        clone: false,
        exec: false,
        push: false,
        pr: false,
      },
      activeStep: null,
    };
    map.set(id, item);
  }
  if (ev.repo) item.repo = ev.repo;
  if (ev.issueTitle) item.title = ev.issueTitle;
  if (ev.issueNumber) item.issueNumber = ev.issueNumber;
  if (ev.phase) item.phase = ev.phase;
  if (ev.profile) item.profile = ev.profile;
  if (ev.prUrl) item.prUrl = ev.prUrl;
  if (ev.error) item.error = ev.error;
  item.events.push(ev);
  item.lastTs = ev.ts;

  if (ev.type === "dispatch.progress") {
    item.activeStep = ev.step;
    switch (ev.step) {
      case "cache.ensure":
        item.steps.cache = true;
        break;
      case "git.clone":
        item.steps.clone = true;
        break;
      case "agent.exec.start":
        item.steps.exec = "active";
        break;
      case "agent.exec.done":
        item.steps.exec = true;
        break;
      case "git.push":
        item.steps.push = true;
        break;
      case "pr.open":
        item.steps.pr = "active";
        break;
    }
  }
  if (ev.type === "dispatch.start") item.firstTs = ev.ts;
  if (ev.type === "dispatch.done") {
    item.state = ev.error ? "error" : "ok";
    if (!ev.error) {
      item.steps.cache =
        item.steps.clone =
        item.steps.push =
        item.steps.pr =
          true;
      item.steps.exec = true;
      item.activeStep = null;
    }
  }
  if (ev.type === "finalize.start") item.phase = "approved";
  if (ev.type === "finalize.done") {
    item.state = ev.error ? "error" : "ok";
    item.phase = "approved";
  }
  if (ev.from === "Approved") item.phase = "approved";
}
