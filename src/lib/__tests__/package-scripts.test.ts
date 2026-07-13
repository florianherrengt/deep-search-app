import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let testDirectory: string | undefined;

afterEach(() => {
  if (testDirectory) {
    rmSync(testDirectory, { force: true, recursive: true });
    testDirectory = undefined;
  }
});

describe("package scripts", () => {
  it("uses a portable runner that propagates the Vitest exit code", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const script = packageJson.scripts?.["test:unit:quiet"];
    expect(script).toBe("node scripts/run-vitest-quiet.mjs");

    testDirectory = mkdtempSync(join(tmpdir(), "deep-search-quiet-test-"));
    const vitestDirectory = join(testDirectory, "node_modules", "vitest");
    mkdirSync(vitestDirectory, { recursive: true });

    const fakeVitest = join(vitestDirectory, "vitest.mjs");
    writeFileSync(fakeVitest, "process.exitCode = 23;\n");

    const helper = resolve(process.cwd(), "scripts/run-vitest-quiet.mjs");
    const result = spawnSync(process.execPath, [helper], {
      cwd: testDirectory,
      stdio: "pipe",
    });

    expect(result.status).toBe(23);
  });
});
