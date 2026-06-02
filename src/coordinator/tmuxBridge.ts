/**
 * `tmuxBridge.ts` — minimal control-plane wrapper around `tmux`.
 *
 * Lets the dashboard send keystrokes into a target tmux pane (typically the
 * Claude Code session that owns the running coordinator) and read back its
 * scrollback. Used by `dashboardServer`'s POST /act/* routes.
 *
 * Target pane resolution order (handled by `resolveTargetPane`):
 *   1. explicit flag           (--tmux-target-pane %N)
 *   2. SANDCASTLE_TMUX_TARGET  (env override)
 *   3. $TMUX_PANE              (coordinator's own pane when run under tmux)
 *
 * All commands shell out via `execFile`. Tests inject `run`.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export interface TmuxRunResult {
  readonly stdout: string;
  readonly stderr: string;
}

export type TmuxRunner = (
  cmd: string,
  args: readonly string[],
) => Promise<TmuxRunResult>;

export interface TmuxBridge {
  readonly targetPane: string;
  sendKeys(text: string, opts?: { enter?: boolean }): Promise<void>;
  capturePane(lines?: number): Promise<string>;
}

export interface TmuxBridgeOptions {
  readonly targetPane: string;
  readonly run?: TmuxRunner;
}

const defaultRun: TmuxRunner = async (cmd, args) => {
  const { stdout, stderr } = await execFileP(cmd, [...args]);
  return { stdout, stderr };
};

export const createTmuxBridge = (opts: TmuxBridgeOptions): TmuxBridge => {
  const run = opts.run ?? defaultRun;
  const pane = opts.targetPane;
  return {
    targetPane: pane,
    async sendKeys(text, { enter = true } = {}) {
      // `-l` = literal. Prevents tmux key-name translation so a payload like
      // "C-c" or "Enter" is typed as text, not interpreted as a chord.
      await run("tmux", ["send-keys", "-t", pane, "-l", text]);
      if (enter) {
        await run("tmux", ["send-keys", "-t", pane, "Enter"]);
      }
    },
    async capturePane(lines = 200) {
      const { stdout } = await run("tmux", [
        "capture-pane",
        "-p",
        "-t",
        pane,
        "-S",
        `-${lines}`,
      ]);
      return stdout;
    },
  };
};

export const resolveTargetPane = (
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
): string | undefined => {
  const candidate = flag || env.SANDCASTLE_TMUX_TARGET || env.TMUX_PANE;
  return candidate && candidate.length > 0 ? candidate : undefined;
};
