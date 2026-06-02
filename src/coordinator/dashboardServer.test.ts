import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventBus } from "./eventBus.js";
import { runDashboardServer } from "./dashboardServer.js";

const pickPort = () => 15000 + Math.floor(Math.random() * 1000);

const readSseFrames = async (
  url: string,
  count: number,
  headers: Record<string, string> = {},
): Promise<{ id: string; data: string }[]> => {
  const res = await fetch(url, {
    headers: { accept: "text/event-stream", ...headers },
  });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const frames: { id: string; data: string }[] = [];
  while (frames.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const ids = block.match(/^id: (\d+)$/m);
      const dat = block.match(/^data: (.+)$/m);
      if (ids && dat) frames.push({ id: ids[1]!, data: dat[1]! });
      if (frames.length >= count) break;
    }
  }
  reader.cancel().catch(() => undefined);
  return frames;
};

describe("runDashboardServer", () => {
  let dir: string;
  let close: (() => Promise<void>) | undefined;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dashserv-"));
  });
  afterEach(async () => {
    if (close) await close();
    close = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it("serves the dashboard HTML at /", async () => {
    const bus = createEventBus(join(dir, "events.jsonl"));
    const port = pickPort();
    ({ close } = await runDashboardServer({ bus, port }));
    const text = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
    expect(text).toContain("sandcastle");
  });

  it("replays the JSONL backlog on /stream connect", async () => {
    const bus = createEventBus(join(dir, "events.jsonl"));
    await bus.sink.emit({ type: "tick.start" });
    await bus.sink.emit({ type: "tick.done", itemCount: 2 });
    const port = pickPort();
    ({ close } = await runDashboardServer({ bus, port }));
    const frames = await readSseFrames(`http://127.0.0.1:${port}/stream`, 2);
    expect(frames).toHaveLength(2);
    expect(JSON.parse(frames[0]!.data).type).toBe("tick.start");
    expect(JSON.parse(frames[1]!.data).type).toBe("tick.done");
    expect(Number(frames[1]!.id)).toBeGreaterThan(Number(frames[0]!.id));
  });

  it("resumes from Last-Event-ID byte offset", async () => {
    const bus = createEventBus(join(dir, "events.jsonl"));
    await bus.sink.emit({ type: "tick.start" });
    const afterFirst = bus.currentOffset();
    await bus.sink.emit({ type: "tick.done", itemCount: 0 });
    const port = pickPort();
    ({ close } = await runDashboardServer({ bus, port }));
    const frames = await readSseFrames(`http://127.0.0.1:${port}/stream`, 1, {
      "last-event-id": String(afterFirst),
    });
    expect(JSON.parse(frames[0]!.data).type).toBe("tick.done");
  });

  it("pushes live events emitted after connect", async () => {
    const bus = createEventBus(join(dir, "events.jsonl"));
    const port = pickPort();
    ({ close } = await runDashboardServer({ bus, port }));
    const pending = readSseFrames(`http://127.0.0.1:${port}/stream`, 1);
    // Small delay to ensure the SSE handler is past the replay phase.
    await new Promise((r) => setTimeout(r, 50));
    await bus.sink.emit({ type: "tick.start" });
    const frames = await pending;
    expect(JSON.parse(frames[0]!.data).type).toBe("tick.start");
  });

  it("/info returns the configured pollIntervalSec", async () => {
    const bus = createEventBus(join(dir, "events.jsonl"));
    const port = pickPort();
    ({ close } = await runDashboardServer({ bus, port, pollIntervalSec: 30 }));
    const json = (await fetch(`http://127.0.0.1:${port}/info`).then((r) =>
      r.json(),
    )) as { pollIntervalSec: number };
    expect(json.pollIntervalSec).toBe(30);
  });
});
