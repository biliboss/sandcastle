/**
 * `dashboardServer.ts` — embedded SSE dashboard for the coordinator.
 *
 * Two routes:
 *   GET /          → dashboard.html
 *   GET /stream    → text/event-stream with full backlog + live tail
 *
 * Replay strategy: on connect, the server reads the JSONL file from the
 * client's `Last-Event-ID` byte-offset (or 0) up to the bus's current
 * offset, then attaches a live listener. Events fired during the replay
 * window are queued and drained before going live so nothing is missed
 * and nothing duplicated.
 */

import { createReadStream, readFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { EventBus } from "./eventBus.js";
import type { EventSink } from "./events.js";
import type { TmuxBridge } from "./tmuxBridge.js";

export interface DashboardServerOptions {
  readonly bus: EventBus;
  readonly port: number;
  readonly host?: string;
  readonly pollIntervalSec?: number;
  /** Heartbeat comment interval, ms. Default 15000. */
  readonly heartbeatMs?: number;
  /** Optional tmux bridge — when present, /act/* routes are enabled. */
  readonly tmuxBridge?: TmuxBridge;
  /** Sink used to emit action.ack events. Required when tmuxBridge is set. */
  readonly events?: EventSink;
}

/** Verbs accepted by POST /act/:verb. Server-side allowlist (defense-in-depth). */
const ACTION_VERBS = new Set(["prompt"]);

const readBody = (req: IncomingMessage, max = 64 * 1024): Promise<string> =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const json = (res: ServerResponse, status: number, payload: unknown): void => {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
};

const handleAction = async (
  opts: DashboardServerOptions,
  verb: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  if (!ACTION_VERBS.has(verb)) {
    json(res, 404, { ok: false, error: `unknown verb: ${verb}` });
    return;
  }
  if (!opts.tmuxBridge || !opts.events) {
    json(res, 503, {
      ok: false,
      error:
        "tmux bridge not configured (set --tmux-target-pane or SANDCASTLE_TMUX_TARGET)",
    });
    return;
  }
  let body: { text?: string } = {};
  try {
    const raw = await readBody(req);
    body = raw ? (JSON.parse(raw) as { text?: string }) : {};
  } catch (err) {
    json(res, 400, {
      ok: false,
      error: `invalid body: ${(err as Error).message}`,
    });
    return;
  }
  const actionId = randomUUID();
  if (verb === "prompt") {
    const text = String(body.text ?? "");
    if (!text) {
      json(res, 400, { ok: false, error: "text required" });
      return;
    }
    try {
      await opts.tmuxBridge.sendKeys(text, { enter: true });
      await opts.events.emit({ type: "action.ack", actionId, verb, ok: true });
      json(res, 200, { ok: true, actionId });
    } catch (err) {
      const msg = (err as Error).message;
      await opts.events.emit({
        type: "action.ack",
        actionId,
        verb,
        ok: false,
        error: msg,
      });
      json(res, 500, { ok: false, actionId, error: msg });
    }
  }
};

export interface DashboardServerHandle {
  readonly url: string;
  readonly close: () => Promise<void>;
}

/** Root of the static dashboard bundle (index.html + css/ + js/). */
const DASHBOARD_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "dashboard",
);
const INDEX_PATH = join(DASHBOARD_DIR, "index.html");

/** Minimal extension → MIME table for the dashboard's static assets. */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

const writeFrame = (res: ServerResponse, id: number, data: string): void => {
  res.write(`id: ${id}\ndata: ${data}\n\n`);
};

const writeRetry = (res: ServerResponse, ms: number): void => {
  res.write(`retry: ${ms}\n\n`);
};

const writeComment = (res: ServerResponse, msg: string): void => {
  res.write(`: ${msg}\n\n`);
};

const replayFromOffset = (
  eventsFile: string,
  since: number,
  endExclusive: number,
  onLine: (id: number, line: string) => void,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (endExclusive <= since) return resolve();
    const stream = createReadStream(eventsFile, {
      start: since,
      end: endExclusive - 1,
      encoding: "utf8",
    });
    let buf = "";
    let pos = since;
    stream.on("data", (chunk: string | Buffer) => {
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const lineBytes = Buffer.byteLength(line + "\n", "utf8");
        pos += lineBytes;
        if (line) onLine(pos, line);
      }
    });
    stream.on("end", () => resolve());
    stream.on("error", (err) => reject(err));
  });

const handleStream = async (
  opts: DashboardServerOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  res.writeHead(200, SSE_HEADERS);
  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);
  writeRetry(res, 3000);

  // Snapshot the cursor BEFORE subscribing so we know the boundary between
  // "replay from file" and "live from emitter". Events emitted during replay
  // are queued and drained after the file replay finishes, then we go live.
  const lastEventIdHeader = req.headers["last-event-id"];
  const since = Number(
    Array.isArray(lastEventIdHeader) ? lastEventIdHeader[0] : lastEventIdHeader,
  );
  const fromOffset = Number.isFinite(since) && since >= 0 ? since : 0;
  const replayEnd = opts.bus.currentOffset();

  const queue: { id: number; line: string }[] = [];
  let draining = true;
  let closed = false;

  const unsubscribe = opts.bus.subscribe((ev) => {
    if (closed) return;
    if (draining) {
      queue.push({ id: ev.id, line: ev.line });
    } else {
      writeFrame(res, ev.id, ev.line);
    }
  });

  const heartbeat = setInterval(() => {
    if (closed) return;
    writeComment(res, "hb");
  }, opts.heartbeatMs ?? 15000);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    try {
      res.end();
    } catch {
      /* ignore */
    }
  };
  req.on("close", cleanup);
  res.on("error", cleanup);

  try {
    if (replayEnd > fromOffset) {
      await replayFromOffset(
        opts.bus.eventsFile,
        fromOffset,
        replayEnd,
        (id, line) => {
          if (!closed) writeFrame(res, id, line);
        },
      );
    }
    // Drain anything that arrived during replay, then flip to live.
    for (const q of queue) {
      if (q.id > replayEnd && !closed) writeFrame(res, q.id, q.line);
    }
    queue.length = 0;
    draining = false;
  } catch (err) {
    if (!closed) writeComment(res, `replay error: ${(err as Error).message}`);
    cleanup();
  }
};

const handleIndex = (res: ServerResponse): void => {
  try {
    const html = readFileSync(INDEX_PATH, "utf8");
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(`dashboard index missing: ${(err as Error).message}`);
  }
};

/** Serve a single file under DASHBOARD_DIR. Path-traversal is blocked by
 *  resolving and confirming the result still sits inside the directory. */
const handleStatic = (url: string, res: ServerResponse): void => {
  // url shape: "/static/<rel-path>"
  const rel = url.slice("/static/".length);
  if (!rel || rel.includes("\0")) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("bad request");
    return;
  }
  const abs = join(DASHBOARD_DIR, rel);
  if (!abs.startsWith(DASHBOARD_DIR + "/") && abs !== DASHBOARD_DIR) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden");
    return;
  }
  try {
    const buf = readFileSync(abs);
    const ext = abs.slice(abs.lastIndexOf(".")).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
};

const handleInfo = (
  opts: DashboardServerOptions,
  res: ServerResponse,
): void => {
  res.writeHead(200, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(
    JSON.stringify({
      pollIntervalSec: opts.pollIntervalSec ?? null,
      tmuxEnabled: Boolean(opts.tmuxBridge && opts.events),
      tmuxTarget: opts.tmuxBridge?.targetPane ?? null,
    }),
  );
};

export const runDashboardServer = async (
  opts: DashboardServerOptions,
): Promise<DashboardServerHandle> => {
  const server: Server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/" || url === "/index.html") return handleIndex(res);
    if (url.startsWith("/static/")) return handleStatic(url, res);
    if (url === "/info") return handleInfo(opts, res);
    if (req.method === "POST" && url.startsWith("/act/")) {
      const verb = url.slice("/act/".length);
      handleAction(opts, verb, req, res).catch((err) => {
        try {
          json(res, 500, { ok: false, error: (err as Error).message });
        } catch {
          /* ignore */
        }
      });
      return;
    }
    if (url === "/stream") {
      handleStream(opts, req, res).catch((err) => {
        try {
          res.end(`stream error: ${(err as Error).message}`);
        } catch {
          /* ignore */
        }
      });
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  // Long-lived SSE responses must not be killed by HTTP keep-alive timeouts.
  server.keepAliveTimeout = 0;
  server.headersTimeout = 0;
  await new Promise<void>((resolve) => {
    server.listen(opts.port, opts.host ?? "127.0.0.1", () => resolve());
  });
  const url = `http://${opts.host ?? "127.0.0.1"}:${opts.port}`;
  console.log(`[dashboard] ${url} — streaming ${opts.bus.eventsFile}`);
  return {
    url,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
};
