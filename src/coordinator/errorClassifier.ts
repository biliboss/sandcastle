/**
 * `errorClassifier.ts` — best-effort classifier for dispatch failure stderr.
 *
 * Pure function. Recognises a small set of failure patterns the coordinator
 * routinely surfaces (auth, clone, push-reject, timeout) so the dashboard can
 * render an at-a-glance chip instead of forcing the operator to read raw text.
 *
 * Falls back to UNKNOWN when no pattern matches.
 */

export type ErrorKind =
  | "AUTH"
  | "CLONE"
  | "PUSH_REJECT"
  | "TIMEOUT"
  | "UNKNOWN";

export interface ClassifiedError {
  readonly kind: ErrorKind;
  readonly summary: string;
}

export const classifyError = (stderr: string): ClassifiedError => {
  if (/401|invalid bearer|failed to authenticate/i.test(stderr)) {
    return { kind: "AUTH", summary: "auth failed (401 / invalid bearer)" };
  }
  if (
    /git clone .* failed|cloning into|fatal: repository .* not found/i.test(
      stderr,
    )
  ) {
    return { kind: "CLONE", summary: "git clone failed" };
  }
  if (
    /git push .* failed|\[rejected\]|non-fast-forward|updates were rejected/i.test(
      stderr,
    )
  ) {
    return { kind: "PUSH_REJECT", summary: "push rejected (non-fast-forward)" };
  }
  if (/timed out|timeout|deadline exceeded|killed container/i.test(stderr)) {
    return { kind: "TIMEOUT", summary: "dispatch timeout" };
  }
  return { kind: "UNKNOWN", summary: stderr.slice(0, 80) };
};
