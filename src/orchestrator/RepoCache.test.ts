import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepoCache } from "./RepoCache.js";
import type { GitRunner } from "./RepoCache.js";

describe("createRepoCache.ensureFresh", () => {
  it("clones the bare repo on first call into <cacheDir>/<owner>__<name>.git", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "repocache-"));
    const calls: Array<readonly string[]> = [];
    const git: GitRunner = vi.fn(async (args) => {
      calls.push(args);
      // Simulate the clone by creating the target dir (last `.git` arg).
      if (args[0] === "clone") {
        const target = args[args.length - 1];
        if (target) await mkdir(target, { recursive: true });
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const cache = createRepoCache({ cacheDir, git });
    const path = await cache.ensureFresh("mktvirtual/muki-bot");

    expect(path).toBe(join(cacheDir, "mktvirtual__muki-bot.git"));
    expect(existsSync(path)).toBe(true);
    expect(calls[0]).toEqual([
      "clone",
      "--bare",
      "https://github.com/mktvirtual/muki-bot.git",
      join(cacheDir, "mktvirtual__muki-bot.git"),
    ]);
  });

  it("runs `git fetch --prune` when the cache already exists", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "repocache-"));
    const target = join(cacheDir, "o__r.git");
    await mkdir(target, { recursive: true });

    const calls: Array<readonly string[]> = [];
    const git: GitRunner = vi.fn(async (args) => {
      calls.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const cache = createRepoCache({ cacheDir, git });
    await cache.ensureFresh("o/r");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(0, 3)).toEqual(["-C", target, "fetch"]);
    expect(calls[0]).toContain("--prune");
  });

  it("throws if the git runner reports non-zero exit", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "repocache-"));
    const git: GitRunner = vi.fn().mockResolvedValue({
      stdout: "",
      stderr: "fatal: bad repo",
      exitCode: 128,
    });
    const cache = createRepoCache({ cacheDir, git });
    await expect(cache.ensureFresh("o/r")).rejects.toThrow(/fatal: bad repo/);
  });
});
