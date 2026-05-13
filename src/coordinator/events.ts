/**
 * `events.ts` — structured event stream for the coordinator. Each event is
 * appended as one JSON line to `eventsFile`. The dashboard server tails this
 * file to render live state.
 *
 * Events are intentionally narrow + flat — easier to render, easier to grep.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type CoordinatorEvent =
  | { type: "tick.start"; ts: string }
  | { type: "tick.done"; ts: string; itemCount: number }
  | {
      type: "item.claimed";
      ts: string;
      itemId: string;
      from: string;
      to: string;
      repo: string;
      issueNumber: number;
      issueTitle: string;
    }
  | {
      type: "dispatch.start";
      ts: string;
      itemId: string;
      repo: string;
      phase: "research" | "dev";
      profile: string;
    }
  | {
      type: "agent.session";
      ts: string;
      itemId: string;
      repo: string;
      phase: "research" | "dev";
      /** Host path to the Claude Code session jsonl for this dispatch. */
      sessionPath: string;
    }
  | {
      type: "dispatch.progress";
      ts: string;
      itemId: string;
      repo: string;
      phase: "research" | "dev";
      step: string;
      detail?: string;
    }
  | {
      type: "dispatch.done";
      ts: string;
      itemId: string;
      repo: string;
      phase: "research" | "dev";
      prUrl?: string;
      sessionPath?: string;
      error?: string;
    }
  | {
      type: "finalize.start";
      ts: string;
      itemId: string;
      repo: string;
    }
  | {
      type: "finalize.done";
      ts: string;
      itemId: string;
      repo: string;
      mergedPrNumber?: number;
      supersededPrNumber?: number;
      error?: string;
    }
  | {
      type: "action.ack";
      ts: string;
      /** UUID generated server-side; dashboard correlates POST response → event. */
      actionId: string;
      /** Verb from the dashboard action allowlist (e.g. "prompt"). */
      verb: string;
      /** Whether the side-effect (tmux send-keys) completed without throwing. */
      ok: boolean;
      /** Short error message when ok=false. */
      error?: string;
    };

export type CoordinatorEventInput = CoordinatorEvent extends infer E
  ? E extends { ts: string }
    ? Omit<E, "ts">
    : never
  : never;

export interface EventSink {
  emit(event: CoordinatorEventInput): Promise<void>;
}

export const createFileEventSink = (eventsFile: string): EventSink => {
  let ensured = false;
  const ensureDir = async () => {
    if (ensured) return;
    await mkdir(dirname(eventsFile), { recursive: true });
    ensured = true;
  };
  return {
    async emit(partial) {
      try {
        await ensureDir();
        const event = { ts: new Date().toISOString(), ...partial };
        await appendFile(eventsFile, JSON.stringify(event) + "\n", "utf8");
      } catch (err) {
        // Events are best-effort — never break a tick because logging failed.
        console.error(`[events] emit failed: ${(err as Error).message}`);
      }
    },
  };
};

export const nullSink: EventSink = {
  async emit() {
    /* no-op */
  },
};
