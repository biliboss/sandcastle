import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileEventSink } from "./events.js";

describe("createFileEventSink", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "events-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends one JSON line per emit with an ISO timestamp", async () => {
    const file = join(dir, "events.jsonl");
    const sink = createFileEventSink(file);
    await sink.emit({ type: "tick.start" });
    await sink.emit({ type: "tick.done", itemCount: 2 });

    const lines = (await readFile(file, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    const [a, b] = lines.map((l) => JSON.parse(l));
    expect(a.type).toBe("tick.start");
    expect(b.type).toBe("tick.done");
    expect(b.itemCount).toBe(2);
    expect(new Date(a.ts).toString()).not.toBe("Invalid Date");
  });

  it("creates the parent directory on first emit", async () => {
    const file = join(dir, "nested/deeper/events.jsonl");
    const sink = createFileEventSink(file);
    await sink.emit({ type: "tick.start" });
    const content = await readFile(file, "utf8");
    expect(content).toContain("tick.start");
  });
});
