/**
 * classifyError.js — client-side mirror of src/coordinator/errorClassifier.ts.
 *
 * Returns { kind, cls } where:
 *   kind  — display label rendered into the chip ("AUTH", "CLONE", …)
 *   cls   — CSS modifier class on .err-chip (lowercase: "auth", "clone", …)
 *
 * IMPORTANT: keep the regex set here in lock-step with errorClassifier.ts.
 * If you change one, change the other. The TS version is the source of
 * truth — this file exists only so the dashboard can render chips without a
 * round-trip to the server.
 */

export function classifyError(stderr) {
  const s = String(stderr || "");
  if (/401|invalid bearer|failed to authenticate/i.test(s))
    return { kind: "AUTH", cls: "auth" };
  if (
    /git clone .* failed|cloning into|fatal: repository .* not found/i.test(s)
  )
    return { kind: "CLONE", cls: "clone" };
  if (
    /git push .* failed|\[rejected\]|non-fast-forward|updates were rejected/i.test(
      s,
    )
  )
    return { kind: "PUSH_REJECT", cls: "push_reject" };
  if (/timed out|timeout|deadline exceeded|killed container/i.test(s))
    return { kind: "TIMEOUT", cls: "timeout" };
  return { kind: "UNKNOWN", cls: "unknown" };
}
