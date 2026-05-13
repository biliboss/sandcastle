/**
 * `ghFetchGraphQL` — implements the `FetchGraphQL` transport by shelling out
 * to the `gh` CLI. No new dependency; reuses the user's existing GitHub auth.
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

export const createGhFetchGraphQL = (deps?: {
  spawn?: Spawn;
}): FetchGraphQL => {
  const spawn = deps?.spawn ?? defaultSpawn;
  return async (query, variables) => {
    const args: string[] = ["api", "graphql", "-f", `query=${query}`];
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
    const parsed = JSON.parse(stdout);
    return parsed.data ?? parsed;
  };
};
