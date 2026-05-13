import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventBus, type BusEvent } from "./eventBus.js";

describe("createEventBus", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bus-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends a JSONL line per emit and tracks monotonic byte offsets", async () => {
    const file = join(dir, "events.jsonl");
    const bus = createEventBus(file);
    await bus.sink.emit({ type: "tick.start" });
    await bus.sink.emit({ type: "tick.done", itemCount: 1 });

    const text = await readFile(file, "utf8");
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(bus.currentOffset()).toBe(Buffer.byteLength(text, "utf8"));
  });

  it("notifies live subscribers with the byte offset id", async () => {
    const file = join(dir, "events.jsonl");
    const bus = createEventBus(file);
    const seen: BusEvent[] = [];
    const off = bus.subscribe((e) => seen.push(e));
    await bus.sink.emit({ type: "tick.start" });
    await bus.sink.emit({ type: "tick.done", itemCount: 0 });
    off();
    expect(seen).toHaveLength(2);
    expect(seen[0]!.id).toBeGreaterThan(0);
    expect(seen[1]!.id).toBeGreaterThan(seen[0]!.id);
    expect(seen[1]!.id).toBe(bus.currentOffset());
  });

  it("unsubscribe stops further notifications", async () => {
    const file = join(dir, "events.jsonl");
    const bus = createEventBus(file);
    const seen: BusEvent[] = [];
    const off = bus.subscribe((e) => seen.push(e));
    await bus.sink.emit({ type: "tick.start" });
    off();
    await bus.sink.emit({ type: "tick.done", itemCount: 0 });
    expect(seen).toHaveLength(1);
  });
});
