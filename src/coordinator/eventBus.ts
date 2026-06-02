/**
 * `eventBus.ts` — durable + live event distribution for the coordinator.
 *
 * One sink, two consumers:
 *   1. JSONL file (durability + replay across coord restarts)
 *   2. EventEmitter (live SSE push to connected dashboards)
 *
 * Each event line gets a monotonic byte-offset id (post-write file size),
 * so SSE clients can resume via `Last-Event-ID` by seeking that offset in
 * the JSONL file — no separate index needed.
 */

import { EventEmitter } from "node:events";
import { appendFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { CoordinatorEventInput, EventSink } from "./events.js";

/** A persisted event with its post-write byte-offset id. */
export interface BusEvent {
  /** Byte offset AFTER this event's line in the JSONL file. Strictly monotonic. */
  readonly id: number;
  /** The serialized JSON line (no trailing newline). */
  readonly line: string;
  /** The parsed event payload (timestamp already attached). */
  readonly event: Record<string, unknown>;
}

export interface EventBus {
  readonly sink: EventSink;
  readonly eventsFile: string;
  /** Current file byte size = id of the last-written event. */
  readonly currentOffset: () => number;
  /** Subscribe to live events. Returns an unsubscribe function. */
  subscribe: (listener: (e: BusEvent) => void) => () => void;
}

export const createEventBus = (eventsFile: string): EventBus => {
  mkdirSync(dirname(eventsFile), { recursive: true });
  let offset = existsSync(eventsFile) ? statSync(eventsFile).size : 0;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  const sink: EventSink = {
    async emit(partial: CoordinatorEventInput) {
      try {
        const event = { ts: new Date().toISOString(), ...partial } as Record<
          string,
          unknown
        >;
        const line = JSON.stringify(event);
        const buf = Buffer.from(line + "\n", "utf8");
        appendFileSync(eventsFile, buf);
        offset += buf.length;
        emitter.emit("event", { id: offset, line, event } satisfies BusEvent);
      } catch (err) {
        console.error(`[events] emit failed: ${(err as Error).message}`);
      }
    },
  };

  return {
    sink,
    eventsFile,
    currentOffset: () => offset,
    subscribe(listener) {
      emitter.on("event", listener);
      return () => emitter.off("event", listener);
    },
  };
};
