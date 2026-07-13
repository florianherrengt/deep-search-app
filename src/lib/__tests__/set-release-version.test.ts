import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type ReleaseVersion = {
  tag: string;
  version: string;
  prerelease: boolean;
};

function resolveReleaseVersion(input: string): ReleaseVersion {
  const script = resolve(process.cwd(), "scripts/set-release-version.mjs");
  const output = execFileSync(
    process.execPath,
    [script, input, "--dry-run", "--json"],
    { encoding: "utf8" },
  );

  return JSON.parse(output.trim()) as ReleaseVersion;
}

describe("set-release-version", () => {
  it.each([
    ["v1.2.3", "1.2.3", false],
    ["v1.2.3-rc.4", "1.2.3-rc.4", true],
    ["alpha-1.2.3.4", "1.2.3-alpha.4", true],
  ])(
    "normalizes %s to %s with prerelease=%s",
    (input, expectedVersion, expectedPrerelease) => {
      expect(resolveReleaseVersion(input)).toMatchObject({
        version: expectedVersion,
        prerelease: expectedPrerelease,
      });
    },
  );
});
