import { describe, expect, it } from "vitest";
import { createTmuxBridge, resolveTargetPane } from "./tmuxBridge.js";
import type { TmuxRunner } from "./tmuxBridge.js";

const recordRunner = (): {
  calls: { cmd: string; args: string[] }[];
  run: TmuxRunner;
} => {
  const calls: { cmd: string; args: string[] }[] = [];
  const run: TmuxRunner = async (cmd, args) => {
    calls.push({ cmd, args: [...args] });
    return { stdout: "", stderr: "" };
  };
  return { calls, run };
};

describe("tmuxBridge.sendKeys", () => {
  it("sends literal text then Enter by default", async () => {
    const { calls, run } = recordRunner();
    const bridge = createTmuxBridge({ targetPane: "%17", run });
    await bridge.sendKeys("hello world");
    expect(calls).toEqual([
      { cmd: "tmux", args: ["send-keys", "-t", "%17", "-l", "hello world"] },
      { cmd: "tmux", args: ["send-keys", "-t", "%17", "Enter"] },
    ]);
  });

  it("omits Enter when enter=false", async () => {
    const { calls, run } = recordRunner();
    const bridge = createTmuxBridge({ targetPane: "%3", run });
    await bridge.sendKeys("partial", { enter: false });
    expect(calls).toEqual([
      { cmd: "tmux", args: ["send-keys", "-t", "%3", "-l", "partial"] },
    ]);
  });

  it("treats key-name payloads as literal text (not chord)", async () => {
    const { calls, run } = recordRunner();
    const bridge = createTmuxBridge({ targetPane: "%1", run });
    await bridge.sendKeys("C-c", { enter: false });
    // The `-l` flag is what guarantees this; assert it's still in the args.
    expect(calls[0]?.args).toContain("-l");
    expect(calls[0]?.args).toContain("C-c");
  });
});

describe("tmuxBridge.capturePane", () => {
  it("requests scrollback lines from tmux", async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const run: TmuxRunner = async (cmd, args) => {
      calls.push({ cmd, args: [...args] });
      return { stdout: "line a\nline b\n", stderr: "" };
    };
    const bridge = createTmuxBridge({ targetPane: "%4", run });
    const out = await bridge.capturePane(50);
    expect(out).toBe("line a\nline b\n");
    expect(calls[0]?.args).toEqual([
      "capture-pane",
      "-p",
      "-t",
      "%4",
      "-S",
      "-50",
    ]);
  });
});

describe("resolveTargetPane", () => {
  it("prefers explicit flag", () => {
    expect(
      resolveTargetPane("%9", {
        SANDCASTLE_TMUX_TARGET: "%2",
        TMUX_PANE: "%1",
      }),
    ).toBe("%9");
  });

  it("falls back to env override", () => {
    expect(
      resolveTargetPane(undefined, {
        SANDCASTLE_TMUX_TARGET: "%2",
        TMUX_PANE: "%1",
      }),
    ).toBe("%2");
  });

  it("falls back to $TMUX_PANE", () => {
    expect(resolveTargetPane(undefined, { TMUX_PANE: "%1" })).toBe("%1");
  });

  it("returns undefined when nothing is set", () => {
    expect(resolveTargetPane(undefined, {})).toBeUndefined();
  });

  it("treats empty strings as unset", () => {
    expect(
      resolveTargetPane("", { SANDCASTLE_TMUX_TARGET: "", TMUX_PANE: "" }),
    ).toBeUndefined();
  });
});
