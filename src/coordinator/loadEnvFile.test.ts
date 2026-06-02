import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "./loadEnvFile.js";

const tmp = async () => mkdtemp(join(tmpdir(), "envfile-"));

describe("loadEnvFile", () => {
  it("parses KEY=value lines into a record", async () => {
    const dir = await tmp();
    const path = join(dir, ".env");
    await writeFile(path, "FOO=bar\nBAZ=qux\n", "utf8");
    expect(await loadEnvFile(path)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("skips comment and blank lines", async () => {
    const dir = await tmp();
    const path = join(dir, ".env");
    await writeFile(path, "# header\n\nFOO=bar\n  \n# another\nBAZ=qux\n");
    expect(await loadEnvFile(path)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("trims surrounding whitespace around key and value", async () => {
    const dir = await tmp();
    const path = join(dir, ".env");
    await writeFile(path, "  FOO = bar  \nBAZ=  qux\n");
    expect(await loadEnvFile(path)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("preserves `=` inside the value", async () => {
    const dir = await tmp();
    const path = join(dir, ".env");
    await writeFile(path, "TOKEN=abc=def=ghi\n");
    expect(await loadEnvFile(path)).toEqual({ TOKEN: "abc=def=ghi" });
  });

  it("throws when a non-blank, non-comment line lacks `=`", async () => {
    const dir = await tmp();
    const path = join(dir, ".env");
    await writeFile(path, "FOO=bar\nMALFORMED LINE\n");
    await expect(loadEnvFile(path)).rejects.toThrow(/MALFORMED LINE/);
  });
});
