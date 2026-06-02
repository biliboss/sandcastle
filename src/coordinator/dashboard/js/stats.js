/**
 * stats.js — derived helpers for time-based bindings.
 *
 * Alpine drives all rendering via `$store.coord.now`, which main.js bumps on
 * a 1Hz setInterval. Templates compute uptime, per-station elapsed, the
 * countdown number, and the ring's stroke-dashoffset directly from `now`
 * + the relevant timestamp.
 *
 * This file exposes only the small math helpers. The bindings themselves
 * live in index.html.
 */

import { RING_C } from "./config.js";

/** Fraction of pollIntervalSec consumed since the last tick.start. */
export function pollProgress(store) {
  if (!store.pollIntervalSec || !store.lastTickAt) return 0;
  const elapsed = (store.now - new Date(store.lastTickAt).getTime()) / 1000;
  return Math.min(1, elapsed / store.pollIntervalSec);
}

/** Whole seconds remaining until the next coordinator poll. */
export function pollRemaining(store) {
  if (!store.pollIntervalSec || !store.lastTickAt) return null;
  const elapsed = (store.now - new Date(store.lastTickAt).getTime()) / 1000;
  return Math.max(0, Math.ceil(store.pollIntervalSec - elapsed));
}

/** Stroke-dashoffset for the countdown ring SVG. */
export function ringOffset(store) {
  return (RING_C * (1 - pollProgress(store))).toFixed(1);
}
