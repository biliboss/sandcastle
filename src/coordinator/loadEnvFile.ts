/**
 * `loadEnvFile` — parse a `KEY=value` env file into a record.
 *
 * Used by agent profiles to inject the credential set (long-lived Claude
 * Code token, see ADR 0020) into the dispatched container's environment.
 *
 * Intentionally tiny: no quoting, no interpolation, no escape sequences.
 * The token files this reads contain exactly one or two `KEY=value` lines
 * produced by `claude setup-token`.
 */

import { readFile } from "node:fs/promises";

export const loadEnvFile = async (
  path: string,
): Promise<Record<string, string>> => {
  const content = await readFile(path, "utf8");
  const env: Record<string, string> = {};
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) {
      throw new Error(`Malformed env line in ${path}: ${trimmed}`);
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    env[key] = value;
  }
  return env;
};
