import { describe, expect, it } from "vitest";
import { classifyError } from "./errorClassifier.js";

describe("classifyError", () => {
  it("tags 401 / invalid-bearer stderr as AUTH", () => {
    const stderr =
      "claude failed [exit 1]: Failed to authenticate. API Error: 401 Invalid bearer token";
    const result = classifyError(stderr);
    expect(result.kind).toBe("AUTH");
    expect(result.summary.toLowerCase()).toContain("auth");
  });

  it("falls back to UNKNOWN with truncated stderr as summary", () => {
    const stderr =
      "weird novel failure mode the regex set hasn't seen before, just a freeform string";
    const result = classifyError(stderr);
    expect(result.kind).toBe("UNKNOWN");
    // Summary surfaces the raw stderr (capped) so the operator still sees signal.
    expect(result.summary).toContain("weird novel failure");
    expect(result.summary.length).toBeLessThanOrEqual(80);
  });

  // Integration sanity — exact strings observed in the live dashboard screenshot.
  describe("integration with real coordinator stderr", () => {
    it.each([
      [
        "AUTH",
        "claude failed [exit 1]: Failed to authenticate. API Error: 401 Invalid bearer to",
      ],
      [
        "CLONE",
        "git clone [dispatch] failed: Cloning into '/Users/billiboss/src/factory/mkt-dash",
      ],
      [
        "PUSH_REJECT",
        "git push failed: To https://github.com/mktvirtual/muki-bot.git ! [rejected]",
      ],
    ] as const)("classifies real %s sample", (expected, stderr) => {
      expect(classifyError(stderr).kind).toBe(expected);
    });
  });

  it("tags container/agent timeout as TIMEOUT", () => {
    const stderr =
      "agent.exec timed out after 900s; killed container coord-agent-abc123";
    const result = classifyError(stderr);
    expect(result.kind).toBe("TIMEOUT");
    expect(result.summary.toLowerCase()).toContain("timeout");
  });

  it("tags rejected non-fast-forward push as PUSH_REJECT", () => {
    const stderr =
      "git push failed: To https://github.com/mktvirtual/muki-bot.git ! [rejected]   feat/x -> feat/x (non-fast-forward)";
    const result = classifyError(stderr);
    expect(result.kind).toBe("PUSH_REJECT");
    expect(result.summary.toLowerCase()).toContain("push");
  });

  it("tags git clone failure as CLONE", () => {
    const stderr =
      "git clone [dispatch] failed: Cloning into '/Users/billiboss/src/factory/mkt-dash'... fatal: repository 'https://github.com/x/y.git/' not found";
    const result = classifyError(stderr);
    expect(result.kind).toBe("CLONE");
    expect(result.summary.toLowerCase()).toContain("clone");
  });
});
