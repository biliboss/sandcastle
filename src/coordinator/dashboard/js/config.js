/**
 * config.js — centralized constants and taxonomies.
 *
 * Anything that would be a magic number, a hand-tuned threshold, or a
 * domain enumeration belongs here so future agents/developers can edit one
 * place rather than grep through render code.
 *
 * Keep this file dependency-free: it must be safe to import from anywhere.
 */

/** Pipeline step taxonomy — the 5 nodes that compose a dispatch.
 *  `id`/`endId` map to event.step values from dispatch.progress events.
 *  See src/coordinator/Dispatcher.ts for the emit sites. */
export const PIPELINE = [
  { id: "cache.ensure", lbl: "CACHE" },
  { id: "git.clone", lbl: "CLONE" },
  { id: "agent.exec.start", lbl: "EXEC", endId: "agent.exec.done" },
  { id: "git.push", lbl: "PUSH" },
  { id: "pr.open", lbl: "PR" },
];

/** Maximum tick bars retained for the tick-history strip in the header. */
export const TICK_HISTORY_MAX = 30;

/** Circumference of the countdown ring (2πr where r=34). Used to map
 *  remaining-time fraction to SVG stroke-dashoffset. */
export const RING_C = 2 * Math.PI * 34;

/** Duration the action.ack toast stays visible (ms). */
export const TOAST_MS = 2400;

/** Truncation cap for error preview shown in the recent-row right column. */
export const ERR_PREVIEW_CHARS = 80;
