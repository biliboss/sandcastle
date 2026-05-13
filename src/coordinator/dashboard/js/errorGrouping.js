/**
 * errorGrouping.js — collapse identical-root errors in the recent strip.
 *
 * Two pure functions:
 *
 *   errorSignature(item) → string | null
 *     Stable signature for grouping. Strips noise (digits, paths, quoted
 *     strings, URLs) so the SAME failure mode reading two different repos
 *     produces the SAME signature. Non-error items return null.
 *
 *   groupErrors(items) → [{ item, count, signature }]
 *     Walks `items` once, preserving order. Adjacent or distant items
 *     sharing a signature collapse into one group; the FIRST occurrence
 *     becomes the representative. Non-error items always pass through with
 *     count=1 — successful PRs are never aggregated.
 *
 * The dashboard render replaces the `for-each item` loop in the recent
 * section with `for-each group`, showing `xN` next to the chip when
 * group.count > 1.
 */

import { classifyError } from "./classifyError.js";

/** Normalize stderr text so accidental noise doesn't fragment grouping. */
function normalizeForSignature(stderr) {
  return (
    String(stderr || "")
      .toLowerCase()
      // Strip URLs (http, https, git@host:path).
      .replace(/https?:\/\/\S+/g, "<url>")
      .replace(/git@[\w.-]+:\S+/g, "<gitssh>")
      // Strip absolute paths.
      .replace(/\/[\w./-]+/g, "<path>")
      // Strip quoted strings (single + double).
      .replace(/'[^']*'/g, "<q>")
      .replace(/"[^"]*"/g, "<q>")
      // Strip digits.
      .replace(/\d+/g, "<n>")
      // Collapse repeated whitespace.
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function errorSignature(item) {
  if (item.state !== "error" || !item.error) return null;
  const { kind } = classifyError(item.error);
  // Known kinds collapse on the kind alone — operator wants "I have N auth
  // failures", not "here are N near-identical 401 messages". UNKNOWN keeps
  // the full normalized message so distinct novel errors stay separate.
  if (kind === "UNKNOWN") return `UNKNOWN:${normalizeForSignature(item.error)}`;
  return `${kind}:`;
}

export function groupErrors(items) {
  const out = [];
  const indexBySig = new Map();
  for (const item of items) {
    const sig = errorSignature(item);
    if (sig === null) {
      // Non-error items never collapse.
      out.push({ item, count: 1, signature: null });
      continue;
    }
    const existing = indexBySig.get(sig);
    if (existing !== undefined) {
      out[existing].count += 1;
    } else {
      indexBySig.set(sig, out.length);
      out.push({ item, count: 1, signature: sig });
    }
  }
  return out;
}
