import { describe, expect, it, vi } from "vitest";
import { createGhFetchGraphQL } from "./ghFetchGraphQL.js";
import type { Spawn } from "./ghFetchGraphQL.js";

describe("createGhFetchGraphQL", () => {
  it("invokes `gh api graphql` with the query and parsed variables", async () => {
    const spawn: Spawn = vi.fn().mockResolvedValue({
      stdout: '{"data":{"viewer":{"login":"someone"}}}',
      stderr: "",
      exitCode: 0,
    });
    const fetchGraphQL = createGhFetchGraphQL({ spawn });

    const result = await fetchGraphQL("query { viewer { login } }", {
      foo: "bar",
      n: 42,
    });

    expect(result).toEqual({ viewer: { login: "someone" } });
    expect(spawn).toHaveBeenCalledOnce();
    const call = (spawn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const bin = call[0] as string;
    const args = call[1] as string[];
    expect(bin).toBe("gh");
    expect(args).toContain("api");
    expect(args).toContain("graphql");
    expect(args).toContain("-f");
    expect(args).toContain("query=query { viewer { login } }");
    expect(args).toContain("-F");
    expect(args).toContain("foo=bar");
    expect(args).toContain("-F");
    expect(args).toContain("n=42");
  });

  it("throws on non-zero exit", async () => {
    const spawn: Spawn = vi.fn().mockResolvedValue({
      stdout: "",
      stderr: "boom",
      exitCode: 1,
    });
    const fetchGraphQL = createGhFetchGraphQL({ spawn });
    await expect(fetchGraphQL("query")).rejects.toThrow(/boom/);
  });

  it("returns the `data` field stripped from the gh envelope", async () => {
    const spawn: Spawn = vi.fn().mockResolvedValue({
      stdout: '{"data":{"x":1}}',
      stderr: "",
      exitCode: 0,
    });
    const fetchGraphQL = createGhFetchGraphQL({ spawn });
    expect(await fetchGraphQL("q")).toEqual({ x: 1 });
  });
});
