/**
 * `postComment` — adds a comment to a GitHub issue via `gh issue comment`.
 * Used by the Dispatcher to leave an audit trail on the issue after every
 * dispatch, regardless of success or failure.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PostCommentFn } from "./Dispatcher.js";

const execFileP = promisify(execFile);

export const createGhPostComment = (): PostCommentFn => async (args) => {
  await execFileP("gh", [
    "issue",
    "comment",
    String(args.issueNumber),
    "--repo",
    args.repo,
    "--body",
    args.body,
  ]);
};
