import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs as nodeParseArgs } from "node:util";
import { chromium } from "playwright";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Keep locale-aware timestamps stable without changing production formatting.
const snapshotTimezone = "Europe/London";
const snapshotLocale = "en-US";

const defaultOptions = {
  staticDir: path.resolve(rootDir, "storybook-static"),
  baselineDir: path.resolve(rootDir, "visual-snapshots"),
  diffDir: path.resolve(rootDir, "visual-snapshots/__diff_output__"),
  url: null,
  match: null,
  limit: Infinity,
  viewport: { width: 1440, height: 1000 },
  colorScheme: "light",
  threshold: 0.1,
  update: false,
  delay: 300,
  list: false,
};

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const storyIndex = await readStoryIndex(options);
  const stories = selectStories(storyIndex, options);

  if (options.list) {
    for (const story of stories) {
      console.log(`${story.id}  ${story.title} / ${story.name}`);
    }
    return;
  }

  if (stories.length === 0) {
    throw new Error("No matching Storybook stories found.");
  }

  const server = options.url ? null : await serveStatic(options.staticDir);
  const baseUrl = options.url ?? server.baseUrl;

  try {
    if (options.update) {
      await updateBaselines(stories, baseUrl, options);
    } else {
      await compareSnapshots(stories, baseUrl, options);
    }
  } finally {
    await server?.close();
  }
}

function parseArgs(args) {
  // npm forwards flags after a bare "--" (e.g. `npm run test:visual:update -- --update`).
  // util.parseArgs treats "--" as a positional separator, so strip bare "--" tokens
  // first to keep parsing the trailing flags as options (matches the prior behavior).
  const filtered = args.filter((a) => a !== "--");
  const { values } = nodeParseArgs({
    args: filtered,
    strict: true,
    options: {
      help: { type: "boolean", short: "h" },
      url: { type: "string" },
      "static-dir": { type: "string" },
      "baseline-dir": { type: "string" },
      "diff-dir": { type: "string" },
      match: { type: "string" },
      limit: { type: "string" },
      viewport: { type: "string" },
      "color-scheme": { type: "string" },
      threshold: { type: "string" },
      delay: { type: "string" },
      update: { type: "boolean" },
      list: { type: "boolean" },
    },
  });

  const options = {
    ...defaultOptions,
    help: values.help === true,
    update: values.update === true,
    list: values.list === true,
  };

  if (values.url != null) options.url = normalizeBaseUrl(values.url);
  if (values["static-dir"] != null) {
    options.staticDir = path.resolve(rootDir, values["static-dir"]);
  }
  if (values["baseline-dir"] != null) {
    options.baselineDir = path.resolve(rootDir, values["baseline-dir"]);
  }
  if (values["diff-dir"] != null) {
    options.diffDir = path.resolve(rootDir, values["diff-dir"]);
  }
  if (values.match != null) options.match = values.match;
  if (values.limit != null) {
    options.limit = parsePositiveInteger(values.limit, "--limit");
  }
  if (values.viewport != null) options.viewport = parseViewport(values.viewport);
  if (values["color-scheme"] != null) {
    options.colorScheme = parseColorScheme(values["color-scheme"]);
  }
  if (values.threshold != null) options.threshold = Number(values.threshold);
  if (values.delay != null) {
    options.delay = parseNonNegativeInteger(values.delay, "--delay");
  }

  return options;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/$/, "");
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return parsed;
}

function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/i.exec(value);
  if (!match) {
    throw new Error('--viewport must use the format "1440x1000".');
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

function parseColorScheme(value) {
  if (value !== "light" && value !== "dark" && value !== "no-preference") {
    throw new Error('--color-scheme must be "light", "dark", or "no-preference".');
  }
  return value;
}

async function readStoryIndex(options) {
  if (options.url) {
    const response = await fetch(`${options.url}/index.json`);
    if (!response.ok) {
      throw new Error(`Could not read Storybook index from ${options.url}/index.json.`);
    }
    return response.json();
  }

  const indexPath = path.join(options.staticDir, "index.json");
  try {
    return JSON.parse(await fs.readFile(indexPath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(
        `Storybook index not found at ${indexPath}. Run npm run build-storybook first.`,
      );
    }
    throw error;
  }
}

function selectStories(storyIndex, options) {
  const entries = Object.values(storyIndex.entries ?? {});
  return entries
    .filter((entry) => entry.type === "story")
    .filter((entry) => !entry.tags?.includes("skip-screenshot"))
    .filter((entry) => storyMatches(entry, options.match))
    .sort((a, b) => `${a.title}/${a.name}`.localeCompare(`${b.title}/${a.name}`))
    .slice(0, options.limit);
}

function storyMatches(story, matcher) {
  if (!matcher) return true;
  const haystack = `${story.id} ${story.title} ${story.name}`;
  if (matcher.startsWith("/") && matcher.lastIndexOf("/") > 0) {
    const lastSlash = matcher.lastIndexOf("/");
    const pattern = matcher.slice(1, lastSlash);
    const flags = matcher.slice(lastSlash + 1);
    return new RegExp(pattern, flags).test(haystack);
  }
  return haystack.toLowerCase().includes(matcher.toLowerCase());
}

function storyFilename(storyId) {
  return `${sanitizeFilename(storyId)}.png`;
}

async function capturePage(page, story, baseUrl, options) {
  const storyUrl = new URL("/iframe.html", baseUrl);
  storyUrl.searchParams.set("id", story.id);
  storyUrl.searchParams.set("viewMode", "story");

  await page.goto(storyUrl.href, { waitUntil: "networkidle" });
  await page.waitForSelector("#storybook-root", { state: "attached" });
  await page.evaluate(async () => {
    await document.fonts?.ready;
  });
  await page.addStyleTag({
    content: [
      "*, *::before, *::after { caret-color: transparent !important; }",
      "#storybook-root { padding: 0 !important; margin: 0 !important; }",
    ].join(" "),
  });
  if (options.delay > 0) {
    await page.waitForTimeout(options.delay);
  }

  return page.screenshot({ type: "png", fullPage: false, animations: "disabled" });
}

async function updateBaselines(stories, baseUrl, options) {
  await fs.mkdir(options.baselineDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  let updated = 0;
  let failed = 0;

  try {
    for (const story of stories) {
      const context = await browser.newContext({
        colorScheme: options.colorScheme,
        deviceScaleFactor: 1,
        locale: snapshotLocale,
        timezoneId: snapshotTimezone,
        viewport: options.viewport,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);

      try {
        const buffer = await capturePage(page, story, baseUrl, options);
        const outputPath = path.join(options.baselineDir, storyFilename(story.id));
        await fs.writeFile(outputPath, buffer);
        console.log(`  updated  ${storyFilename(story.id)}`);
        updated += 1;
      } catch (error) {
        console.error(`  failed   ${story.id}: ${error instanceof Error ? error.message : error}`);
        failed += 1;
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\nUpdated ${updated} baseline${updated === 1 ? "" : "s"} in ${displayPath(options.baselineDir)}`);
  if (failed > 0) {
    throw new Error(`Failed to update ${failed} visual baseline${failed === 1 ? "" : "s"}.`);
  }
}

async function compareSnapshots(stories, baseUrl, options) {
  const diffDir = options.diffDir;
  await fs.mkdir(diffDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  const results = [];

  try {
    for (const story of stories) {
      const filename = storyFilename(story.id);
      const baselinePath = path.join(options.baselineDir, filename);
      const context = await browser.newContext({
        colorScheme: options.colorScheme,
        deviceScaleFactor: 1,
        locale: snapshotLocale,
        timezoneId: snapshotTimezone,
        viewport: options.viewport,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);

      try {
        const actualBuffer = await capturePage(page, story, baseUrl, options);

        let baselineBuffer;
        try {
          baselineBuffer = await fs.readFile(baselinePath);
        } catch (error) {
          if (error && error.code === "ENOENT") {
            results.push({ id: story.id, status: "missing", filename });
            console.log(`  FAIL     ${filename} (baseline is missing)`);
            continue;
          }
          throw error;
        }

        const diff = comparePng(baselineBuffer, actualBuffer, options.threshold);

        if (diff.match) {
          results.push({ id: story.id, status: "pass", filename });
          console.log(`  pass     ${filename}`);
        } else {
          const diffPath = path.join(diffDir, filename);
          await fs.writeFile(diffPath, diff.diffBuffer);
          results.push({
            id: story.id,
            status: "fail",
            filename,
            diffPixels: diff.diffPixels,
            totalPixels: diff.totalPixels,
            diffPath: displayPath(diffPath),
          });
          console.log(
            `  FAIL     ${filename}  (${diff.diffPixels} / ${diff.totalPixels} pixels differ, ${diff.ratio})`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ id: story.id, status: "error", filename, error: message });
        console.error(`  error    ${filename}: ${message}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const missing = results.filter((r) => r.status === "missing").length;
  const errors = results.filter((r) => r.status === "error").length;

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed, ${missing} missing, ${errors} errors`);

  const problems = failed + missing + errors;
  if (problems > 0) {
    console.log(`\nDiff images written to ${displayPath(diffDir)}`);
    console.log("\nTo update baselines, run:");
    console.log("  npm run test:visual:update\n");
    throw new Error(`${problems} visual snapshot${problems === 1 ? "" : "s"} failed.`);
  }
}

function comparePng(bufferA, bufferB, threshold) {
  const imgA = PNG.sync.read(bufferA);
  const imgB = PNG.sync.read(bufferB);

  if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
    return {
      match: false,
      diffPixels: -1,
      totalPixels: imgA.width * imgA.height,
      ratio: `size mismatch: ${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height}`,
      diffBuffer: bufferB,
    };
  }

  const { width, height } = imgA;
  const totalPixels = width * height;
  const diff = new PNG({ width, height });

  const diffPixels = pixelmatch(imgA.data, imgB.data, diff.data, width, height, {
    threshold,
  });

  const ratio = ((diffPixels / totalPixels) * 100).toFixed(2) + "%";
  return {
    match: diffPixels === 0,
    diffPixels,
    totalPixels,
    ratio,
    diffBuffer: PNG.sync.write(diff),
  };
}

async function serveStatic(staticDir) {
  const root = path.resolve(staticDir);
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(requestUrl.pathname);
      const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
      let filePath = path.resolve(root, relativePath);

      if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      const stat = await fs.stat(filePath).catch(() => null);
      if (stat?.isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }

      const file = await fs.readFile(filePath);
      response.writeHead(200, {
        "content-type": contentTypes.get(path.extname(filePath)) ?? "application/octet-stream",
      });
      response.end(file);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not start static file server.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function sanitizeFilename(value) {
  return value
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function displayPath(filePath) {
  const relative = path.relative(rootDir, filePath);
  return relative.startsWith("..") ? filePath : relative;
}

function printHelp() {
  console.log(`Visual snapshot testing for Storybook stories.

Usage:
  npm run test:visual                   Compare against baselines
  npm run test:visual -- --update       Update baselines
  npm run test:visual -- --match Foo    Filter stories

Options:
  --url <url>                 Use a running Storybook server.
  --static-dir <dir>          Built Storybook directory. Default: storybook-static.
  --baseline-dir <dir>        Baseline snapshot directory. Default: visual-snapshots.
  --diff-dir <dir>            Diff output directory. Default: visual-snapshots/__diff_output__.
  --match <text|/regex/flags> Filter by story id, title, or name.
  --limit <number>            Max stories to process.
  --viewport <WxH>            Viewport size. Default: 1440x1000.
  --color-scheme <value>      light, dark, or no-preference. Default: light.
  --threshold <0-1>           Pixelmatch threshold. Default: 0.1.
  --delay <ms>                Wait after render. Default: 300.
  --update                    Update baselines instead of comparing.
  --list                      List matching stories and exit.
  --help                      Show this help.

Stories tagged with "skip-screenshot" are excluded.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
