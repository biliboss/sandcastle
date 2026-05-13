/**
 * pipeline.js — render the 5-node pipeline strip inside a station card.
 *
 * Maps an aggregated item's `.steps` booleans/markers to a sequence of
 * nodes (CACHE → CLONE → EXEC → PUSH → PR) and renders them with the right
 * CSS state class ("done", "active", "err") and the connecting lines.
 *
 * Inputs: an item produced by state.buildItems.
 * Output: an HTML string consumed by `x-html` in index.html.
 *
 * SECURITY: this builder interpolates only string literals + boolean state
 * — no event payload, no user content. Safe under x-html. If you ever add
 * dynamic strings (e.g. step name from item.activeStep), escape them via
 * util.js#escape first.
 */

const stepStateCls = (s) =>
  s === "active" ? "active" : s === true ? "done" : "";

export function pipelineHtml(item) {
  const nodes = [
    { lbl: "CACHE", s: item.steps.cache },
    { lbl: "CLONE", s: item.steps.clone },
    { lbl: "EXEC", s: item.steps.exec },
    { lbl: "PUSH", s: item.steps.push },
    { lbl: "PR", s: item.steps.pr },
  ];
  // On error: mark the first non-done node as the failure point.
  if (item.state === "error") {
    for (const n of nodes) {
      if (n.s !== true) {
        n.s = "err";
        break;
      }
    }
  }
  let html = `<div class="pipeline">`;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const cls = n.s === "err" ? "err" : stepStateCls(n.s);
    html += `<div class="node ${cls}"><div class="glyph"></div><div class="lbl">${n.lbl}</div></div>`;
    if (i < nodes.length - 1) {
      const connDone = nodes[i + 1].s === true || nodes[i].s === true;
      html += `<div class="conn ${connDone ? "done" : ""}"></div>`;
    }
  }
  html += `</div>`;
  return html;
}
