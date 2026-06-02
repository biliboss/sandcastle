/**
 * stream.js — SSE wiring. Pure store mutation; no DOM access.
 *
 * The EventSource handle is stored on `store._es` so dashboard.destroy()
 * (via store.teardown()) can close it cleanly. Connection state is mirrored
 * to `store.connState` so the header dot can be Alpine-bound.
 */

export function startSse(store) {
  const es = new EventSource("/stream");
  store._es = es;
  store.connState = "init";
  es.onopen = () => {
    store.connState = "open";
  };
  es.onerror = () => {
    store.connState = "error";
  };
  es.onmessage = (e) => {
    try {
      const ev = JSON.parse(e.data);
      store.pushEvent(ev);
    } catch {
      /* malformed line — ignore */
    }
  };
}
