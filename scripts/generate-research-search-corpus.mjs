#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_SOURCE =
  process.env.RESEARCH_SEARCH_SOURCE_DIR ?? "~/projects/researches/data";
const DEFAULT_OUT = "benchmarks/research-search/fixtures/real-corpus.json";

const DEFAULTS = {
  maxFolders: 40,
  maxFilesPerFolder: 4,
  maxFileChars: 16_000,
  maxQueries: 60,
  maxRelatedQueries: 12,
};

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "from",
  "with",
  "what",
  "how",
  "why",
  "when",
  "where",
  "which",
  "who",
  "into",
  "onto",
  "under",
  "over",
  "best",
  "near",
  "plus",
  "vs",
  "or",
  "but",
  "your",
  "you",
  "this",
  "that",
]);

const NO_MATCH_QUERIES = [
  "medieval coin mint mark identification for 14th century florins",
  "how to repair a pipe organ wind chest leak",
  "best soil chemistry workflow for growing saffron commercially",
  "radiology protocol for equine fetlock ultrasound",
  "ancient greek pottery kiln temperature reconstruction",
];

function parseArgs(argv) {
  const parsed = {
    source: DEFAULT_SOURCE,
    out: DEFAULT_OUT,
    maxFolders: DEFAULTS.maxFolders,
    maxFilesPerFolder: DEFAULTS.maxFilesPerFolder,
    maxFileChars: DEFAULTS.maxFileChars,
    maxQueries: DEFAULTS.maxQueries,
    maxRelatedQueries: DEFAULTS.maxRelatedQueries,
    force: false,
    folders: null,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--source":
        parsed.source = requiredArg(argv, ++i, arg);
        break;
      case "--out":
        parsed.out = requiredArg(argv, ++i, arg);
        break;
      case "--max-folders":
        parsed.maxFolders = positiveInt(requiredArg(argv, ++i, arg), arg);
        break;
      case "--max-files-per-folder":
        parsed.maxFilesPerFolder = positiveInt(requiredArg(argv, ++i, arg), arg);
        break;
      case "--max-file-chars":
        parsed.maxFileChars = positiveInt(requiredArg(argv, ++i, arg), arg);
        break;
      case "--max-queries":
        parsed.maxQueries = positiveInt(requiredArg(argv, ++i, arg), arg);
        break;
      case "--max-related-queries":
        parsed.maxRelatedQueries = positiveInt(requiredArg(argv, ++i, arg), arg);
        break;
      case "--folders":
        parsed.folders = requiredArg(argv, ++i, arg)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        break;
      case "--force":
        parsed.force = true;
        break;
      case "--help":
      case "-h":
        usage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function requiredArg(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function positiveInt(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function usage() {
  console.error(`Usage:
  node scripts/generate-research-search-corpus.mjs [options]

Options:
  --source PATH                 Research data directory (default: ${DEFAULT_SOURCE})
  --out PATH                    Output corpus JSON (default: ${DEFAULT_OUT})
  --max-folders N               Max folders to include (default: ${DEFAULTS.maxFolders})
  --max-files-per-folder N      Max content files per folder (default: ${DEFAULTS.maxFilesPerFolder})
  --max-file-chars N            Max chars copied from each source file (default: ${DEFAULTS.maxFileChars})
  --max-queries N               Max generated queries including no-match queries (default: ${DEFAULTS.maxQueries})
  --max-related-queries N       Max generated multi-folder related queries (default: ${DEFAULTS.maxRelatedQueries})
  --folders a,b,c               Explicit comma-separated folder names to include
  --force                       Overwrite an existing output corpus
`);
}

function main() {
  const args = parseArgs(process.argv);
  if (!existsSync(args.source)) {
    throw new Error(`Source directory does not exist: ${args.source}`);
  }

  const discovered = discoverFolders(args.source);
  const selected = selectFolders(discovered, args);
  if (selected.length === 0) {
    throw new Error("No folders with metadata descriptions and content files were found");
  }

  const corpus = buildCorpus(selected, args);
  if (existsSync(args.out) && !args.force) {
    throw new Error(
      `Output already exists: ${args.out}. The real-history corpus is meant to be stable; use --force only when intentionally creating a new snapshot.`,
    );
  }
  mkdirSync(path.dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(corpus, null, 2)}\n`);

  const fileCount = corpus.folders.reduce(
    (sum, folder) => sum + Object.keys(folder.files).length,
    0,
  );
  console.error(
    `Wrote ${args.out}: ${corpus.folders.length} folders, ${fileCount} files, ${corpus.queries.length} queries`,
  );
}

function discoverFolders(source) {
  const entries = readdirSync(source, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const folders = [];
  for (const name of entries) {
    const dir = path.join(source, name);
    const metadataPath = path.join(dir, "metadata.json");
    if (!existsSync(metadataPath)) {
      continue;
    }

    let metadata;
    try {
      metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    } catch {
      continue;
    }

    const description = String(metadata.description ?? "").trim();
    if (!description) {
      continue;
    }

    const contentFiles = listContentFiles(dir);
    if (contentFiles.length === 0) {
      continue;
    }

    folders.push({
      name,
      normalizedName: normalizeName(name),
      dir,
      description,
      related: Array.isArray(metadata.related) ? metadata.related.map(String) : [],
      files: contentFiles,
    });
  }

  return folders;
}

function listContentFiles(dir) {
  const files = [];
  walk(dir, dir, files);
  files.sort((a, b) => fileRank(b) - fileRank(a) || a.localeCompare(b));
  return files;
}

function walk(root, current, files) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    const rel = path.relative(root, fullPath);

    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) {
        continue;
      }
      walk(root, fullPath, files);
      continue;
    }

    if (!entry.isFile() || shouldSkipFile(entry.name)) {
      continue;
    }

    files.push(rel);
  }
}

function shouldSkipDir(name) {
  return ["raw", ".git", "node_modules", "dist", "target"].includes(name);
}

function shouldSkipFile(name) {
  if (name === "metadata.json" || name === "AGENTS.md") {
    return true;
  }
  return !/\.(md|txt)$/i.test(name);
}

function fileRank(rel) {
  const base = path.basename(rel).toLowerCase();
  if (base === "summary.md") return 100;
  if (base === "readme.md") return 90;
  if (base === "memories.md") return 80;
  if (base.includes("comparison")) return 70;
  if (base.includes("recommendation")) return 65;
  if (base.includes("research")) return 60;
  if (base.includes("findings")) return 55;
  return 10;
}

function selectFolders(discovered, args) {
  if (args.folders) {
    const byName = new Map(discovered.map((folder) => [folder.name, folder]));
    const missing = args.folders.filter((name) => !byName.has(name));
    if (missing.length > 0) {
      throw new Error(`Requested folders not found or not benchmarkable: ${missing.join(", ")}`);
    }
    return args.folders.map((name) => byName.get(name));
  }

  return discovered
    .slice()
    .sort((a, b) => folderRank(b) - folderRank(a) || a.name.localeCompare(b.name))
    .slice(0, args.maxFolders);
}

function folderRank(folder) {
  const hasSummary = folder.files.some((file) => path.basename(file).toLowerCase() === "summary.md");
  return Math.min(folder.files.length, 12) + folder.related.length * 2 + (hasSummary ? 4 : 0);
}

function buildCorpus(selected, args) {
  const relationIndex = buildRelationIndex(selected);

  const folders = selected.map((folder) => {
    const files = {
      "folder-metadata.md": folderMetadataMarkdown(folder, relationIndex),
    };
    for (const rel of folder.files.slice(0, args.maxFilesPerFolder)) {
      files[rel] = readBoundedFile(path.join(folder.dir, rel), args.maxFileChars);
    }
    return {
      name: folder.name,
      original_query: folder.description,
      files,
    };
  });

  const queries = [];
  for (const folder of selected) {
    if (queries.length >= args.maxQueries - NO_MATCH_QUERIES.length) {
      break;
    }
    const expectedRelevant = [folder.name];
    queries.push({
      id: `real-${shortHash(folder.name)}-${slugify(folder.name)}-description`,
      query: folder.description,
      expected_relevant: expectedRelevant,
      expected_irrelevant: hardNegatives(folder, expectedRelevant, selected, relationIndex),
      description: `Metadata description query for ${folder.name}`,
    });
  }

  let relatedQueries = 0;
  for (const folder of selected) {
    if (
      queries.length >= args.maxQueries - NO_MATCH_QUERIES.length ||
      relatedQueries >= args.maxRelatedQueries
    ) {
      break;
    }
    const related = relatedFolders(folder, relationIndex).slice(0, 1);
    if (related.length === 0) {
      continue;
    }

    const expectedRelevant = [folder.name, ...related.map((item) => item.name)];
    queries.push({
      id: `real-${shortHash(`${folder.name}:related`)}-${slugify(folder.name)}-related`,
      query: `${folder.description}; related previous research on ${related
        .map((item) => item.description)
        .join(" and ")}`,
      expected_relevant: expectedRelevant,
      expected_irrelevant: hardNegatives(folder, expectedRelevant, selected, relationIndex),
      description: `Related-folder query for ${folder.name}`,
    });
    relatedQueries += 1;
  }

  for (let i = 0; i < NO_MATCH_QUERIES.length && queries.length < args.maxQueries; i += 1) {
    queries.push({
      id: `real-no-match-${String(i + 1).padStart(2, "0")}`,
      query: NO_MATCH_QUERIES[i],
      expected_relevant: [],
      expected_irrelevant: [],
      description: "Generated no-match query outside the saved research domains",
    });
  }

  const snapshot = {
    generator: "scripts/generate-research-search-corpus.mjs",
    generator_version: 1,
    source: args.source,
    max_folders: args.maxFolders,
    max_files_per_folder: args.maxFilesPerFolder,
    max_file_chars: args.maxFileChars,
    max_queries: args.maxQueries,
    max_related_queries: args.maxRelatedQueries,
    relation_mode: "undirected-1-hop",
    related_folders_per_query: 1,
    hard_negative_min_overlap_score: 2,
  };

  const corpus = {
    version: "real-1.0.0-pending",
    embedding_model: "qwen/qwen3-embedding-4b",
    embedding_dimensions: 1024,
    reranker_model: "cohere/rerank-4-pro",
    chunking_version: 1,
    indexing_version: 1,
    query_prefix: "Represent this sentence for searching relevant passages: ",
    snapshot,
    folders,
    queries,
  };
  corpus.version = `real-1.0.0-${shortHash(stableJson({ snapshot, folders, queries }))}`;
  return corpus;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function folderMetadataMarkdown(folder, relationIndex) {
  const related = relatedFolders(folder, relationIndex);
  const lines = [
    `# ${folder.name}`,
    "",
    "## Description",
    "",
    folder.description,
  ];
  if (related.length > 0) {
    lines.push(
      "",
      "## Related Research",
      "",
      ...related.map((item) => `- ${item.name}: ${item.description}`),
    );
  }
  return `${lines.join("\n")}\n`;
}

function readBoundedFile(filePath, maxChars) {
  const content = readFileSync(filePath, "utf8");
  if (content.length <= maxChars) {
    return content;
  }
  return `${content.slice(0, maxChars)}\n\n[Truncated by research-search benchmark fixture generator from ${content.length} chars]\n`;
}

function buildRelationIndex(folders) {
  const byNormalizedName = new Map(folders.map((folder) => [folder.normalizedName, folder]));
  const byName = new Map(folders.map((folder) => [folder.name, folder]));
  const relatedNamesByName = new Map(folders.map((folder) => [folder.name, new Set()]));

  for (const folder of folders) {
    for (const rawName of folder.related) {
      const related = byNormalizedName.get(normalizeName(rawName));
      if (!related || related.name === folder.name) {
        continue;
      }
      relatedNamesByName.get(folder.name)?.add(related.name);
      relatedNamesByName.get(related.name)?.add(folder.name);
    }
  }

  return { byName, byNormalizedName, relatedNamesByName };
}

function relatedFolders(folder, relationIndex) {
  return Array.from(relationIndex.relatedNamesByName.get(folder.name) ?? [])
    .map((name) => relationIndex.byName.get(name))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function hardNegatives(folder, expectedRelevant, selected, relationIndex) {
  const blocked = new Set(expectedRelevant);
  blocked.add(folder.name);
  for (const name of expectedRelevant) {
    for (const related of relationIndex.relatedNamesByName.get(name) ?? []) {
      blocked.add(related);
    }
  }

  const sourceTerms = termSet(`${folder.name} ${folder.description}`);
  return selected
    .filter((candidate) => !blocked.has(candidate.name))
    .map((candidate) => ({
      name: candidate.name,
      score: overlapScore(sourceTerms, termSet(`${candidate.name} ${candidate.description}`)),
    }))
    .filter((candidate) => candidate.score >= 2)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((candidate) => candidate.name);
}

function overlapScore(a, b) {
  let score = 0;
  for (const term of a) {
    if (b.has(term)) {
      score += term.length >= 8 ? 2 : 1;
    }
  }
  return score;
}

function termSet(text) {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((term) => term.length >= 3 || /\d/.test(term))
      .filter((term) => !STOPWORDS.has(term)),
  );
}

function normalizeName(name) {
  return slugify(String(name));
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    usage();
    process.exit(1);
  }
}

export {
  buildCorpus,
  buildRelationIndex,
  discoverFolders,
  hardNegatives,
  relatedFolders,
  selectFolders,
};
