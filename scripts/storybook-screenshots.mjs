import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const defaultOptions = {
  staticDir: path.resolve(rootDir, "storybook-static"),
  outDir: path.resolve(rootDir, "storybook-screenshots"),
  url: null,
  match: null,
  limit: Infinity,
  format: "png",
  quality: undefined,
  viewport: { width: 1440, height: 1000 },
  delay: 300,
  fullPage: false,
  colorScheme: "light",
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

  await fs.mkdir(options.outDir, { recursive: true });

  const server = options.url ? null : await serveStatic(options.staticDir);
  const baseUrl = options.url ?? server.baseUrl;

  try {
    await captureStories(stories, baseUrl, options);
  } finally {
    await server?.close();
  }
}

function parseArgs(args) {
  const options = { ...defaultOptions };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--url":
        options.url = normalizeBaseUrl(readValue(args, ++i, arg));
        break;
      case "--static-dir":
        options.staticDir = path.resolve(rootDir, readValue(args, ++i, arg));
        break;
      case "--out":
        options.outDir = path.resolve(rootDir, readValue(args, ++i, arg));
        break;
      case "--match":
      case "--stories":
        options.match = readValue(args, ++i, arg);
        break;
      case "--limit":
        options.limit = parsePositiveInteger(readValue(args, ++i, arg), arg);
        break;
      case "--format":
        options.format = parseFormat(readValue(args, ++i, arg));
        break;
      case "--quality":
        options.quality = parseQuality(readValue(args, ++i, arg));
        break;
      case "--viewport":
        options.viewport = parseViewport(readValue(args, ++i, arg));
        break;
      case "--delay":
        options.delay = parseNonNegativeInteger(readValue(args, ++i, arg), arg);
        break;
      case "--full-page":
        options.fullPage = true;
        break;
      case "--color-scheme":
        options.colorScheme = parseColorScheme(readValue(args, ++i, arg));
        break;
      case "--list":
        options.list = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function readValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
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

function parseQuality(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new Error("--quality must be an integer from 0 to 100.");
  }
  return parsed;
}

function parseFormat(value) {
  if (value !== "png" && value !== "jpeg") {
    throw new Error('--format must be "png" or "jpeg".');
  }
  return value;
}

function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/i.exec(value);
  if (!match) {
    throw new Error('--viewport must use the format "1440x1000".');
  }

  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
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
        `Storybook index not found at ${indexPath}. Run npm run build-storybook first, or use npm run storybook:screenshots.`,
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
    .sort((a, b) => `${a.title}/${a.name}`.localeCompare(`${b.title}/${b.name}`))
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

async function captureStories(stories, baseUrl, options) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    colorScheme: options.colorScheme,
    deviceScaleFactor: 1,
    viewport: options.viewport,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  const screenshots = [];
  const failures = [];

  console.log(`Capturing ${stories.length} stor${stories.length === 1 ? "y" : "ies"} from ${baseUrl}`);

  try {
    for (const story of stories) {
      const storyUrl = new URL("/iframe.html", baseUrl);
      storyUrl.searchParams.set("id", story.id);
      storyUrl.searchParams.set("viewMode", "story");

      const filename = `${sanitizeFilename(story.id)}.${options.format}`;
      const outputPath = path.join(options.outDir, filename);

      try {
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

        await page.screenshot({
          path: outputPath,
          type: options.format,
          fullPage: options.fullPage,
          animations: "disabled",
          ...(options.format === "jpeg" && options.quality !== undefined
            ? { quality: options.quality }
            : {}),
        });

        screenshots.push({
          id: story.id,
          title: story.title,
          name: story.name,
          url: storyUrl.href,
          file: displayPath(outputPath),
        });
        console.log(`saved ${displayPath(outputPath)}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ id: story.id, title: story.title, name: story.name, error: message });
        console.error(`failed ${story.id}: ${message}`);
      }
    }
  } finally {
    await browser.close();
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    viewport: options.viewport,
    colorScheme: options.colorScheme,
    fullPage: options.fullPage,
    format: options.format,
    screenshots,
    failures,
  };

  await fs.writeFile(
    path.join(options.outDir, "index.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  if (failures.length > 0) {
    throw new Error(`Failed to capture ${failures.length} stor${failures.length === 1 ? "y" : "ies"}.`);
  }

  console.log(`Wrote manifest to ${displayPath(path.join(options.outDir, "index.json"))}`);
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
    throw new Error("Could not start Storybook static server.");
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
  console.log(`Generate screenshots from Storybook stories.

Usage:
  npm run storybook:screenshots
  npm run storybook:screenshots -- --match ToolFallback --full-page
  npm run storybook:screenshots:dev -- --out tmp/screenshots

Options:
  --url <url>                 Capture from a running Storybook server instead of storybook-static.
  --static-dir <dir>          Static Storybook build directory. Default: storybook-static.
  --out <dir>                 Screenshot output directory. Default: storybook-screenshots.
  --match <text|/regex/flags> Capture matching story id, title, or name only.
  --stories <text|regex>      Alias for --match.
  --limit <number>            Capture only the first N matching stories.
  --format <png|jpeg>         Image format. Default: png.
  --quality <0-100>           JPEG quality.
  --viewport <width>x<height> Viewport size. Default: 1440x1000.
  --full-page                 Capture full scrollable page instead of viewport.
  --color-scheme <value>      light, dark, or no-preference. Default: light.
  --delay <ms>                Wait after render before capturing. Default: 300.
  --list                      List matching stories without capturing.
  --help                      Show this help.

Stories tagged with "skip-screenshot" are ignored.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
