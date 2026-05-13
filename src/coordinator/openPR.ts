/**
 * `openPR` — shells out to `gh pr create` after a successful dispatch.
 * Returns the new PR URL (or the existing one if `gh` reports the branch
 * already has a PR open).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { OpenPRFn } from "./Dispatcher.js";

const execFileP = promisify(execFile);

export const createGhOpenPR = (): OpenPRFn => async (args) => {
  const body = `Resolves https://github.com/${args.repo}/issues/${args.issueNumber}\n\n(opened by @ai-hero/sandcastle coordinator)`;
  try {
    const { stdout } = await execFileP("gh", [
      "pr",
      "create",
      "--repo",
      args.repo,
      "--head",
      args.head,
      "--title",
      args.title,
      "--body",
      body,
    ]);
    return stdout.trim();
  } catch (err: any) {
    const stderr = err.stderr ?? "";
    const existingUrlMatch = stderr.match(
      /https:\/\/github\.com\/[^\s]+\/pull\/\d+/,
    );
    if (existingUrlMatch) {
      return existingUrlMatch[0];
    }
    throw new Error(`gh pr create failed: ${stderr || err.message}`);
  }
};
