/**
 * util.js — small pure helpers used everywhere.
 *
 * Exports:
 *   escape(s)       — HTML-escape a string for safe innerHTML interpolation
 *                     via x-html (used inside eventLine.js + pipeline.js)
 *   fmtTime(iso)    — ISO timestamp → "HH:MM:SS"
 *   fmtElapsed(ms)  — milliseconds → "T+MM:SS"
 *   fmtUptime(ms)   — milliseconds → "HH:MM:SS"
 *
 * Pure functions only. No DOM mutation, no state. Alpine handles DOM access
 * declaratively via $store/$refs/x-bind — there's no need for a $() shortcut.
 */

export const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export const fmtTime = (iso) => {
  try {
    return new Date(iso).toTimeString().slice(0, 8);
  } catch {
    return iso;
  }
};

export const fmtElapsed = (ms) => {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `T+${mm}:${ss}`;
};

export const fmtUptime = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${ss}`;
};
