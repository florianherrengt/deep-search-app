import { constants, copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const projectRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const sidecarDir = join(projectRoot, "src-tauri", "binaries");
const sidecarModePath = join(projectRoot, "src", "lib", "mcp", "sidecar-mode.json");

const targetTriple =
  process.env.TAURI_TARGET_TRIPLE ||
  process.env.CARGO_BUILD_TARGET ||
  getDefaultTargetTriple(process.platform, process.arch);

const extension = process.platform === "win32" ? ".exe" : "";
const packagedNode = join(projectRoot, "node_modules", "node", "bin", `node${extension}`);
const sourceNode =
  process.env.NODE_SIDECAR_PATH ||
  ((await fileExists(packagedNode)) ? packagedNode : process.execPath);
const targetNode = join(sidecarDir, `node-${targetTriple}${extension}`);

await mkdir(sidecarDir, { recursive: true });

// Step 2: Try compilation (Option B)
if (process.env.SKIP_SIDECAR_COMPILE !== "1" && process.env.SKIP_SIDECAR_COMPILE !== "true") {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [join(projectRoot, "scripts", "build-sidecar-compiled.mjs")],
      { cwd: projectRoot },
    );
    if (stdout) console.log(stdout);
    await writeFile(sidecarModePath, JSON.stringify({ mode: "compiled" }, null, 2));
    console.log("Compiled sidecar binary created");
  } catch {
    console.warn("Sidecar compilation failed, falling back to node binary");
    await copyNodeBinaryFallback();
  }
} else {
  await copyNodeBinaryFallback();
}

console.log(`Prepared Node sidecar: ${targetNode}`);

// Helper functions

function getDefaultTargetTriple(platform, arch) {
  if (platform === "darwin" && arch === "arm64") return "aarch64-apple-darwin";
  if (platform === "darwin" && arch === "x64") return "x86_64-apple-darwin";
  if (platform === "linux" && arch === "arm64") return "aarch64-unknown-linux-gnu";
  if (platform === "linux" && arch === "x64") return "x86_64-unknown-linux-gnu";
  if (platform === "win32" && arch === "arm64") return "aarch64-pc-windows-msvc";
  if (platform === "win32" && arch === "x64") return "x86_64-pc-windows-msvc";
  if (platform === "win32" && arch === "ia32") return "i686-pc-windows-msvc";

  throw new Error(
    `Unsupported Node sidecar target for ${platform}/${arch}. Set TAURI_TARGET_TRIPLE and NODE_SIDECAR_PATH explicitly.`,
  );
}

async function copyNodeBinaryFallback() {
  await copyFileIfNeeded(sourceNode, targetNode);

  if (process.platform !== "win32") {
    await copyFileMode(targetNode);
  }

  // Strip and re-sign on macOS
  if (process.platform === "darwin") {
    try {
      await execFileAsync("codesign", ["--remove-signature", targetNode]);
      await execFileAsync("codesign", [
        "--sign", "-",
        "--entitlements", join(projectRoot, "scripts", "node-sidecar-entitlements.plist"),
        "--options", "runtime",
        targetNode,
      ]);
    } catch (error) {
      throw new Error(`codesign operations failed: ${error.message}`, { cause: error });
    }
  }

  await writeFile(sidecarModePath, JSON.stringify({ mode: "node" }, null, 2));
}

async function copyFileIfNeeded(source, target) {
  const [sourceStats, targetStats] = await Promise.all([
    stat(source),
    stat(target).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    }),
  ]);

  if (
    targetStats &&
    targetStats.size === sourceStats.size &&
    Math.trunc(targetStats.mtimeMs) >= Math.trunc(sourceStats.mtimeMs)
  ) {
    return;
  }

  await copyFile(source, target, constants.COPYFILE_FICLONE_FORCE).catch((error) => {
    if (!["ENOSYS", "ENOTSUP", "EXDEV"].includes(error?.code)) {
      throw error;
    }
    return copyFile(source, target);
  });
}

async function copyFileMode(target) {
  const { chmod } = await import("node:fs/promises");
  await chmod(target, 0o755);
}

async function fileExists(path) {
  return stat(path)
    .then(() => true)
    .catch((error) => {
      if (error?.code === "ENOENT") return false;
      throw error;
    });
}
