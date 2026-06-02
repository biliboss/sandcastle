/**
 * main.js — entry. Wires Alpine.js to the dashboard.
 *
 * Runs on `alpine:init` (fired before Alpine walks the DOM):
 *   1. Register $store.coord (state.js#buildStore) + its init/teardown.
 *   2. Register pure-helper magics:
 *        $fmt        — { time, elapsed, uptime, escape }
 *        $classify   — classifyError(stderr) → { kind, cls }
 *        $eventLine  — renderEventLine(ev) → { kind, glyph, html }
 *        $pipeline   — pipelineHtml(item) → string
 *        $poll       — { remaining, ringOffset } (countdown helpers)
 *   3. Register the `dashboard` x-data factory used by <body x-data="dashboard">.
 *
 * Lifecycle:
 *   dashboard.init()     — fetchInfo → startSse → start 1Hz tick
 *   dashboard.destroy()  — store.teardown() (clears interval + closes SSE)
 *
 * Alpine.js loads ahead of this file via a <script defer> in index.html.
 */

import { buildStore } from "./state.js";
import { startSse } from "./stream.js";
import { fetchInfo, sendPrompt, tickNow } from "./actions.js";
import { pollRemaining, ringOffset } from "./stats.js";
import { classifyError } from "./classifyError.js";
import { groupErrors } from "./errorGrouping.js";
import { isStuck } from "./stuck.js";
import { heartbeatLagSeries, polylinePoints } from "./sparkline.js";
import { renderEventLine } from "./eventLine.js";
import { pipelineHtml } from "./pipeline.js";
import { fmtTime, fmtElapsed, fmtUptime, escape } from "./util.js";

document.addEventListener("alpine:init", () => {
  Alpine.store("coord", buildStore());

  Alpine.magic("fmt", () => ({
    time: fmtTime,
    elapsed: fmtElapsed,
    uptime: fmtUptime,
    escape,
  }));
  Alpine.magic("classify", () => classifyError);
  Alpine.magic("groupErrors", () => groupErrors);
  Alpine.magic("isStuck", () => isStuck);
  Alpine.magic("sparkline", () => ({
    series: heartbeatLagSeries,
    points: polylinePoints,
  }));
  Alpine.magic("eventLine", () => renderEventLine);
  Alpine.magic("pipeline", () => pipelineHtml);
  Alpine.magic("poll", () => ({ remaining: pollRemaining, ringOffset }));

  Alpine.data("dashboard", () => ({
    init() {
      const store = Alpine.store("coord");
      fetchInfo(store).then(() => startSse(store));
      // 1Hz tick — bumping store.now refreshes every binding that reads it
      // (uptime, per-station elapsed counters, countdown ring + number).
      store._tickIntervalId = setInterval(() => {
        store.now = Date.now();
      }, 1000);
    },
    destroy() {
      Alpine.store("coord").teardown();
    },
    onPromptEnter(e) {
      // .enter modifier on the input dispatches us; we just ship + clear.
      const text = e.target.value;
      e.target.value = "";
      sendPrompt(Alpine.store("coord"), text);
    },
    tickNow() {
      return tickNow(Alpine.store("coord"));
    },
    issueHref(item) {
      if (!item.repo || !item.issueNumber) return null;
      return `https://github.com/${item.repo}/issues/${item.issueNumber}`;
    },
  }));
});
