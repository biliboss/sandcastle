/**
 * `ghFetchGraphQL` — implements the `FetchGraphQL` transport by shelling out
 * to the `gh` CLI. No new dependency; reuses the user's existing GitHub auth.
 *
 * When an `onRateLimit` callback is provided, the request runs with the `-i`
 * flag so `gh` prepends the HTTP response headers to stdout. The wrapper
 * parses the X-RateLimit-* triplet and invokes the callback with structured
 * data — the dashboard surfaces this as a header gauge that turns red below
 * a threshold. Without the callback, behavior is unchanged (no -i, no parse).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FetchGraphQL } from "./ProjectPoll.js";

const execFileP = promisify(execFile);

export interface SpawnResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type Spawn = (
  bin: string,
  args: readonly string[],
) => Promise<SpawnResult>;

export interface RateLimitInfo {
  /** Calls remaining before throttling. */
  readonly remaining: number;
  /** Total quota for the current window. */
  readonly limit: number;
  /** ISO timestamp when the quota resets. */
  readonly resetAt: string;
}

const defaultSpawn: Spawn = async (bin, args) => {
  try {
    const { stdout, stderr } = await execFileP(bin, [...args]);
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? String(err),
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
};

/** Split `gh -i` output into `{headers, body}`. Headers end at first blank line. */
const splitHeadersAndBody = (
  raw: string,
): { headers: Record<string, string>; body: string } => {
  // `gh -i` separates headers and body with a blank line. Tolerate both
  // CRLF and LF since the underlying transport varies.
  const sep = raw.indexOf("\r\n\r\n");
  const idx = sep >= 0 ? sep : raw.indexOf("\n\n");
  if (idx < 0) return { headers: {}, body: raw };
  const headerBlock = raw.slice(0, idx);
  const body = raw.slice(idx + (sep >= 0 ? 4 : 2));
  const headers: Record<string, string> = {};
  for (const line of headerBlock.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line
      .slice(colon + 1)
      .trim();
  }
  return { headers, body };
};

const parseRateLimit = (
  headers: Record<string, string>,
): RateLimitInfo | null => {
  const remaining = headers["x-ratelimit-remaining"];
  const limit = headers["x-ratelimit-limit"];
  const reset = headers["x-ratelimit-reset"];
  if (!remaining || !limit || !reset) return null;
  const r = Number(remaining);
  const l = Number(limit);
  const t = Number(reset);
  if (![r, l, t].every(Number.isFinite)) return null;
  return {
    remaining: r,
    limit: l,
    resetAt: new Date(t * 1000).toISOString(),
  };
};

export const createGhFetchGraphQL = (deps?: {
  spawn?: Spawn;
  onRateLimit?: (info: RateLimitInfo) => void;
}): FetchGraphQL => {
  const spawn = deps?.spawn ?? defaultSpawn;
  const onRateLimit = deps?.onRateLimit;
  return async (query, variables) => {
    const args: string[] = ["api"];
    if (onRateLimit) args.push("-i");
    args.push("graphql", "-f", `query=${query}`);
    for (const [k, v] of Object.entries(variables ?? {})) {
      // Pick `-F` (auto-typed) for JS numbers/booleans so GraphQL `Int!` /
      // `Boolean!` params parse correctly, `-f` (forced string) otherwise so
      // all-digit string IDs (e.g. ProjectV2 option IDs) don't get coerced
      // to Int by gh.
      const flag =
        typeof v === "number" || typeof v === "boolean" ? "-F" : "-f";
      args.push(flag, `${k}=${String(v)}`);
    }
    const { stdout, stderr, exitCode } = await spawn("gh", args);
    if (exitCode !== 0) {
      throw new Error(`gh api graphql failed (exit ${exitCode}): ${stderr}`);
    }
    const { headers, body } = onRateLimit
      ? splitHeadersAndBody(stdout)
      : { headers: {}, body: stdout };
    if (onRateLimit) {
      const info = parseRateLimit(headers);
      if (info) onRateLimit(info);
    }
    const parsed = JSON.parse(body);
    return parsed.data ?? parsed;
  };
};
