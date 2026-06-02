import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepoCache } from "./RepoCache.js";
import type { GitRunner } from "./RepoCache.js";

describe("createRepoCache.ensureFresh", () => {
  it("clones into <cacheDir>/<name> (flat, working tree) on first call", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "repocache-"));
    const calls: Array<readonly string[]> = [];
    const git: GitRunner = vi.fn(async (args) => {
      calls.push(args);
      if (args[0] === "clone") {
        const target = args[args.length - 1];
        if (target) await mkdir(target, { recursive: true });
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const cache = createRepoCache({ cacheDir, git });
    const path = await cache.ensureFresh("mktvirtual/muki-bot");

    expect(path).toBe(join(cacheDir, "muki-bot"));
    expect(existsSync(path)).toBe(true);
    expect(calls[0]).toEqual([
      "clone",
      "https://github.com/mktvirtual/muki-bot.git",
      join(cacheDir, "muki-bot"),
    ]);
  });

  it("runs `git fetch --prune` when the clone already exists", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "repocache-"));
    const target = join(cacheDir, "r");
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
