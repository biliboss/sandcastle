/**
 * `fetchComments` — pulls the comment bodies on a GitHub issue, oldest first,
 * via `gh api`. Used by the Dispatcher to enrich the agent prompt with
 * follow-up directives the human typed after the issue was opened.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FetchCommentsFn } from "./Dispatcher.js";

const execFileP = promisify(execFile);

export const createGhFetchComments = (): FetchCommentsFn => async (args) => {
  try {
    const { stdout } = await execFileP(
      "gh",
      [
        "api",
        `repos/${args.repo}/issues/${args.issueNumber}/comments`,
        "--paginate",
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as Array<{ body?: string }>;
    return parsed.map((c) => c.body ?? "").filter((b) => b.trim() !== "");
  } catch {
    return [];
  }
};
