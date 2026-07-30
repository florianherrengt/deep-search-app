import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("release workflow", () => {
  it("keeps SemVer prereleases eligible for the single-channel updater feed", () => {
    const workflow = readFileSync(
      resolve(process.cwd(), ".github/workflows/release.yml"),
      "utf8",
    );

    expect(workflow).toContain(
      "releases/latest/download/latest.json",
    );
    expect(workflow).not.toContain('args+=("--prerelease")');
    expect(workflow).toContain("-F prerelease=false");
  });

  it("builds both Mac architectures and Windows with a Rust cache", () => {
    const workflow = readFileSync(
      resolve(process.cwd(), ".github/workflows/release.yml"),
      "utf8",
    );

    expect(workflow).toContain("platform: macos-15-intel");
    expect(workflow).toContain("target: x86_64-apple-darwin");
    expect(workflow).toContain("platform: macos-latest");
    expect(workflow).toContain("target: aarch64-apple-darwin");
    expect(workflow).toContain("platform: windows-latest");
    expect(workflow).toContain("target: x86_64-pc-windows-msvc");
    expect(workflow).toContain("uses: Swatinem/rust-cache@v2");
    expect(workflow).toContain("shared-key: release-${{ matrix.target }}");
    expect(workflow).toContain("'_x64-setup\\.exe$'");
    expect(workflow).toContain("Configure Windows NSIS bundle");
    expect(workflow).toContain("includeUpdaterJson: false");
    expect(workflow).toContain('"windows-x86_64": windows');
    expect(workflow).toContain('"darwin-x86_64": macIntel');
    expect(workflow).toContain('repos/$GITHUB_REPOSITORY/releases" --paginate');
    expect(workflow).toContain("find_release_id()");
    expect(workflow).toContain("for delay in 1 2 4 8 16");
  });
});
