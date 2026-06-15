import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const projectRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

const entryPoint = join(
  projectRoot,
  "node_modules",
  "chrome-devtools-mcp",
  "build",
  "src",
  "bin",
  "chrome-devtools-mcp.js",
);

const targetTriple =
  process.env.TAURI_TARGET_TRIPLE ||
  process.env.CARGO_BUILD_TARGET ||
  getDefaultTargetTriple(process.platform, process.arch);

const pkgTarget = getPkgTarget(targetTriple);
const extension = targetTriple.includes("windows") ? ".exe" : "";
const output = join(projectRoot, "src-tauri", "binaries", `node-${targetTriple}${extension}`);

const pkgBin = join(projectRoot, "node_modules", ".bin", "pkg");
if (!existsSync(pkgBin)) {
  console.log("SKIP: @yao-pkg/pkg not installed");
  process.exit(1);
}

if (!existsSync(entryPoint)) {
  console.log("SKIP: chrome-devtools-mcp entry point not found");
  process.exit(1);
}

try {
  const { stdout, stderr } = await execFileAsync(
    pkgBin,
    [entryPoint, "--target", pkgTarget, "--output", output],
    { cwd: projectRoot },
  );
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
} catch (error) {
  console.error("Compilation failed:", error.stderr || error.message);
  process.exit(1);
}

try {
  await execFileAsync(output, ["--help"], {
    cwd: projectRoot,
    timeout: 10_000,
  });
} catch {
  console.error("Smoke test failed: compiled binary does not run correctly");
  console.error("This is likely due to ESM dynamic imports in chrome-devtools-mcp");
  console.error("Falling back to node binary mode");
  await rm(output, { force: true });
  process.exit(1);
}

console.log(`Compiled sidecar binary: ${output}`);
process.exit(0);

function getDefaultTargetTriple(platform, arch) {
  if (platform === "darwin" && arch === "arm64") return "aarch64-apple-darwin";
  if (platform === "darwin" && arch === "x64") return "x86_64-apple-darwin";
  if (platform === "linux" && arch === "arm64") return "aarch64-unknown-linux-gnu";
  if (platform === "linux" && arch === "x64") return "x86_64-unknown-linux-gnu";
  if (platform === "win32" && arch === "arm64") return "aarch64-pc-windows-msvc";
  if (platform === "win32" && arch === "x64") return "x86_64-pc-windows-msvc";
  if (platform === "win32" && arch === "ia32") return "i686-pc-windows-msvc";

  throw new Error(
    `Unsupported Node sidecar target for ${platform}/${arch}. Set TAURI_TARGET_TRIPLE explicitly.`,
  );
}

function getPkgTarget(triple) {
  const map = {
    "aarch64-apple-darwin": "node22-macos-arm64",
    "x86_64-apple-darwin": "node22-macos-x64",
    "aarch64-unknown-linux-gnu": "node22-linux-arm64",
    "x86_64-unknown-linux-gnu": "node22-linux-x64",
    "aarch64-pc-windows-msvc": "node22-win-arm64",
    "x86_64-pc-windows-msvc": "node22-win-x64",
  };
  if (map[triple]) return map[triple];
  throw new Error(`Unsupported target triple for pkg: ${triple}`);
}
