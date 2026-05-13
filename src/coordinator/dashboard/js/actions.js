/**
 * actions.js — /info bootstrap + /act/prompt POST.
 *
 * No DOM mutation. Reads + writes $store.coord exclusively. The dock,
 * toast, and hint surfaces are all driven by store fields via Alpine
 * directives in index.html.
 */

export async function fetchInfo(store) {
  try {
    const info = await fetch("/info", { cache: "no-store" }).then((r) =>
      r.json(),
    );
    store.pollIntervalSec = info.pollIntervalSec;
    store.tmux = {
      enabled: Boolean(info.tmuxEnabled),
      target: info.tmuxTarget || "?",
    };
    store.tickNowEnabled = Boolean(info.tickNowEnabled);
  } catch {
    /* server unreachable — leave defaults */
  }
}

export async function tickNow(store) {
  store.ack.hint = "tick…";
  try {
    const res = await fetch("/act/tick-now", { method: "POST" });
    const data = await res.json();
    if (!data.ok) {
      store.ack.hint = "error";
      store.toast(`tick failed: ${data.error || res.status}`, true);
      return;
    }
    store.pendingActions.set(data.actionId, { verb: "tick-now", sentAt: Date.now() });
    store.ack.hint = "tick poked";
  } catch (err) {
    store.ack.hint = "error";
    store.toast(`tick failed: ${err.message}`, true);
  }
}

export async function sendPrompt(store, text) {
  if (!text) return;
  store.ack.hint = "sending…";
  try {
    const res = await fetch("/act/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!data.ok) {
      store.ack.hint = "error";
      store.toast(`prompt failed: ${data.error || res.status}`, true);
      return;
    }
    store.pendingActions.set(data.actionId, {
      verb: "prompt",
      sentAt: Date.now(),
    });
    store.ack.hint = "sent · waiting ack";
  } catch (err) {
    store.ack.hint = "error";
    store.toast(`prompt failed: ${err.message}`, true);
  }
}
