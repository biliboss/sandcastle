/**
 * eventLine.js — per-event presentation rules for the station event log.
 *
 * Given a raw coordinator event, returns the visual record needed to render
 * one row inside .station details > .log:
 *   { kind, glyph, html }
 *
 *   kind   — CSS class on .log-line (k-claim | k-start | k-progress | k-done-ok | k-done-err)
 *   glyph  — single VT323 char rendered in the glyph column
 *   html   — inner HTML of the .what column (already escaped)
 *
 * To support a new event type, add a case here AND extend the matching
 * CSS class in css/station.css (`.log-line.k-...`).
 *
 * SECURITY: the returned `html` field is interpolated into the DOM via
 * Alpine's x-html (see index.html), which is XSS-unsafe by design. Every
 * value taken from the event payload MUST go through `escape()` before
 * concatenation. The events themselves come from a trusted source
 * (the coordinator process), but defense-in-depth still escapes them.
 */

import { escape } from "./util.js";

export function renderEventLine(ev) {
  switch (ev.type) {
    case "item.claimed":
      return {
        kind: "k-claim",
        glyph: "»",
        html: `claimed <span class="lbl">${escape(ev.from)}</span> → <span class="lbl">${escape(ev.to)}</span>`,
      };
    case "dispatch.start":
      return {
        kind: "k-start",
        glyph: "$",
        html: `dispatch.start phase=<span class="lbl">${escape(ev.phase)}</span> profile=<span class="lbl">${escape(ev.profile)}</span>`,
      };
    case "dispatch.progress":
      return {
        kind: "k-progress",
        glyph: "·",
        html: `<span class="step">${escape(ev.step)}</span>${ev.detail ? `  ${escape(ev.detail)}` : ""}`,
      };
    case "dispatch.done":
      if (ev.error)
        return {
          kind: "k-done-err",
          glyph: "✗",
          html: `dispatch.done <span class="err">${escape(ev.error)}</span>`,
        };
      if (ev.prUrl)
        return {
          kind: "k-done-ok",
          glyph: "✓",
          html: `dispatch.done · <a href="${escape(ev.prUrl)}" target="_blank">${escape(ev.prUrl)}</a>`,
        };
      return {
        kind: "k-done-ok",
        glyph: "✓",
        html: `dispatch.done · <span style="color:var(--text-dim)">(no PR)</span>`,
      };
    case "finalize.start":
      return { kind: "k-start", glyph: "⚙", html: `finalize.start` };
    case "finalize.done":
      if (ev.error)
        return {
          kind: "k-done-err",
          glyph: "✗",
          html: `finalize.done <span class="err">${escape(ev.error)}</span>`,
        };
      return {
        kind: "k-done-ok",
        glyph: "✓",
        html: `finalize.done · merged #${ev.mergedPrNumber}${ev.supersededPrNumber ? ` · superseded #${ev.supersededPrNumber}` : ""}`,
      };
    default:
      return { kind: "", glyph: "·", html: escape(ev.type) };
  }
}
