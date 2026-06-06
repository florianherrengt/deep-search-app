import { readFile, writeFile } from "node:fs/promises";

const projectRoot = new URL("..", import.meta.url);
const input = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
const dryRun = process.argv.includes("--dry-run");
const printJson = process.argv.includes("--json");

if (!input) {
  console.error("Usage: node scripts/set-release-version.mjs <version> [--dry-run]");
  process.exit(1);
}

const release = parseReleaseVersion(input);

await updateJson("package.json", (json) => {
  json.version = release.version;
});

await updateJson("package-lock.json", (json) => {
  json.version = release.version;
  if (json.packages?.[""]) {
    json.packages[""].version = release.version;
  }
});

await updateJson("src-tauri/tauri.conf.json", (json) => {
  json.version = release.version;
});

await updateText("src-tauri/Cargo.toml", (content) =>
  replaceFirst(
    content,
    /(^\[package\][\s\S]*?^version\s*=\s*")([^"]+)(")/m,
    release.version,
  ),
);

await updateText("src-tauri/Cargo.lock", (content) =>
  replaceFirst(
    content,
    /(\[\[package\]\]\s+name\s*=\s*"deep-search-app"\s+version\s*=\s*")([^"]+)(")/,
    release.version,
  ),
);

if (printJson) {
  console.log(JSON.stringify(release));
} else {
  console.log(
    `${dryRun ? "Would set" : "Set"} release version to ${release.version} from ${input}`,
  );
}

function parseReleaseVersion(rawInput) {
  const tag = rawInput
    .trim()
    .replace(/^refs\/tags\//i, "")
    .replace(/^release\s+version\s+/i, "")
    .replace(/^release[-/]/i, "");

  const semverInput = tag.replace(/^v(?=\d)/i, "");
  if (isSemver(semverInput)) {
    return {
      tag,
      version: semverInput,
      prerelease: semverInput.includes("-"),
    };
  }

  const friendly = tag.match(
    /^(alpha|beta|rc|preview|canary|nightly)[-/]?v?(\d+\.\d+\.\d+)(?:[-.]([0-9A-Za-z-]+))?$/i,
  );

  if (friendly) {
    const [, channel, baseVersion, channelVersion] = friendly;
    const prerelease = [channel.toLowerCase(), channelVersion]
      .filter(Boolean)
      .join(".");
    const version = `${baseVersion}-${prerelease}`;

    if (isSemver(version)) {
      return {
        tag,
        version,
        prerelease: true,
      };
    }
  }

  throw new Error(
    `Invalid release version "${rawInput}". Use semver like "1.2.3" or a friendly prerelease tag like "alpha-0.0.1".`,
  );
}

function isSemver(value) {
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
      value,
    )
  ) {
    return false;
  }

  const prerelease = value.split("-")[1];
  if (!prerelease) return true;

  return prerelease.split(".").every((part) => {
    if (!part) return false;
    if (/^\d+$/.test(part)) return part === "0" || !part.startsWith("0");
    return true;
  });
}

async function updateJson(relativePath, update) {
  const file = new URL(relativePath, projectRoot);
  const json = JSON.parse(await readFile(file, "utf8"));
  update(json);
  await write(relativePath, `${JSON.stringify(json, null, 2)}\n`);
}

async function updateText(relativePath, update) {
  const file = new URL(relativePath, projectRoot);
  await write(relativePath, update(await readFile(file, "utf8")));
}

async function write(relativePath, content) {
  if (dryRun) return;
  await writeFile(new URL(relativePath, projectRoot), content);
}

function replaceFirst(content, pattern, version) {
  let replaced = false;
  const next = content.replace(pattern, (...match) => {
    replaced = true;
    return `${match[1]}${version}${match[3]}`;
  });

  if (!replaced) {
    throw new Error(`Could not find version field for pattern ${pattern}.`);
  }

  return next;
}
