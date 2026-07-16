import {
  readAppFile,
  SafePathSegmentSchema,
  writeAppFile,
} from "@/lib/app-file-storage";
import { SEARCH_RESULTS_SUBFOLDER } from "@/lib/research-history";

const MEMORY_FILENAME = "memories.md";
const MEMORY_METADATA_FIELDS = new Set([
  "applies when",
  "category",
  "confidence",
  "created",
  "do not use when",
  "evidence",
  "source",
]);

interface ResearchMemoryDependencies {
  readAppFile: typeof readAppFile;
  writeAppFile: typeof writeAppFile;
}

const DEFAULT_DEPENDENCIES: ResearchMemoryDependencies = {
  readAppFile,
  writeAppFile,
};

const researchMemoryQueues = new Map<string, Promise<unknown>>();

export function parseResearchMemories(content: string | null): string[] {
  if (!content) return [];

  const facts: string[] = [];
  const seen = new Set<string>();

  for (const line of content.split("\n")) {
    const fact = parseResearchMemoryBullet(line)?.fact;
    if (!fact) continue;

    const key = fact.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push(fact);
  }

  return facts;
}

export function formatResearchMemories(facts: readonly string[]): string {
  return ["# Memories", "", ...facts.map((fact) => `- ${fact}`), ""].join(
    "\n",
  );
}

export function formatResearchMemoriesForRewrite(
  existingContent: string | null,
  facts: readonly string[],
): string {
  const canonical = formatResearchMemories(facts);
  const existingFacts = parseResearchMemories(existingContent);
  if (
    !normalizeMemoryDocument(existingContent) ||
    normalizeMemoryDocument(existingContent) ===
      normalizeMemoryDocument(formatResearchMemories(existingFacts))
  ) {
    return canonical;
  }

  const preservedContent = (existingContent ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => {
      if (/^\s*#\s+Memories\s*$/i.test(line)) return false;
      if (/^\s*##\s+Preserved legacy notes\s*$/i.test(line)) return false;
      return parseResearchMemoryBullet(line)?.fact == null;
    })
    .join("\n")
    .trim();
  if (!preservedContent) return canonical;

  return [
    canonical.trimEnd(),
    "",
    "## Preserved legacy notes",
    "",
    preservedContent,
    "",
  ].join("\n");
}

export async function readResearchMemories(
  folderName: string,
  dependencies: Pick<ResearchMemoryDependencies, "readAppFile"> =
    DEFAULT_DEPENDENCIES,
): Promise<string[]> {
  const parsedFolderName = SafePathSegmentSchema.parse(folderName);
  const content = await dependencies.readAppFile({
    subfolder: researchMemorySubfolder(parsedFolderName),
    filename: MEMORY_FILENAME,
  });
  return parseResearchMemories(content);
}

export async function mergeResearchMemories(
  sourceFolderName: string,
  destinationFolderName: string,
  dependencies: ResearchMemoryDependencies = DEFAULT_DEPENDENCIES,
): Promise<number> {
  const source = SafePathSegmentSchema.parse(sourceFolderName);
  const destination = SafePathSegmentSchema.parse(destinationFolderName);
  if (source === destination) return 0;

  return withResearchMemoryLocks([source, destination], () =>
    mergeResearchMemoriesUnlocked(source, destination, dependencies),
  );
}

export async function mergeResearchMemoriesWithLockedCleanup<T>(
  sourceFolderName: string,
  destinationFolderName: string,
  cleanup: () => Promise<T>,
  dependencies: ResearchMemoryDependencies = DEFAULT_DEPENDENCIES,
): Promise<{ memoriesMerged: number; cleanupResult: T }> {
  const source = SafePathSegmentSchema.parse(sourceFolderName);
  const destination = SafePathSegmentSchema.parse(destinationFolderName);
  if (source === destination) {
    throw new Error("Memory merge cleanup requires two distinct folders.");
  }

  return withResearchMemoryLocks([source, destination], async () => {
    const memoriesMerged = await mergeResearchMemoriesUnlocked(
      source,
      destination,
      dependencies,
    );
    const cleanupResult = await cleanup();
    return { memoriesMerged, cleanupResult };
  });
}

async function mergeResearchMemoriesUnlocked(
  source: string,
  destination: string,
  dependencies: ResearchMemoryDependencies,
) {
  const [sourceContent, destinationContent] = await Promise.all([
      dependencies.readAppFile({
        subfolder: researchMemorySubfolder(source),
        filename: MEMORY_FILENAME,
      }),
      dependencies.readAppFile({
        subfolder: researchMemorySubfolder(destination),
        filename: MEMORY_FILENAME,
      }),
  ]);
  const sourceFacts = parseResearchMemories(sourceContent);
  const normalizedSource = normalizeMemoryDocument(sourceContent);
  if (!normalizedSource || normalizedSource === "# Memories") return 0;

  const destinationFacts = parseResearchMemories(destinationContent);
  const seen = new Set(destinationFacts.map((fact) => fact.toLowerCase()));
  const added = sourceFacts.filter((fact) => {
    const key = fact.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const sourceIsCanonical =
    normalizedSource ===
    normalizeMemoryDocument(formatResearchMemories(sourceFacts));
  if (added.length === 0 && sourceIsCanonical) return 0;
  if (
    !sourceIsCanonical &&
    normalizeMemoryDocument(destinationContent).includes(normalizedSource)
  ) {
    return 0;
  }

  await dependencies.writeAppFile({
    subfolder: researchMemorySubfolder(destination),
    filename: MEMORY_FILENAME,
    content: mergeMemoryDocuments({
      sourceFolder: source,
      sourceContent: sourceContent ?? "",
      destinationContent,
      addedFacts: added,
      sourceIsCanonical,
    }),
  });
  return added.length;
}

function parseResearchMemoryBullet(line: string): {
  fact: string | null;
} | null {
  const bullet = line.match(/^\s*[-*+]\s+(.+?)\s*$/);
  if (!bullet) return null;

  let fact = bullet[1].replace(/\s+/g, " ").trim();
  const field = fact.match(/^([^:]+):\s*(.*)$/);
  if (field) {
    const fieldName = field[1].trim().toLowerCase();
    if (fieldName === "memory") {
      fact = field[2].trim();
    } else if (MEMORY_METADATA_FIELDS.has(fieldName)) {
      return { fact: null };
    }
  }

  return { fact: fact || null };
}

function mergeMemoryDocuments({
  sourceFolder,
  sourceContent,
  destinationContent,
  addedFacts,
  sourceIsCanonical,
}: {
  sourceFolder: string;
  sourceContent: string;
  destinationContent: string | null;
  addedFacts: readonly string[];
  sourceIsCanonical: boolean;
}) {
  const destination = destinationContent?.trimEnd() ?? "";
  if (!destination) return `${sourceContent.trimEnd()}\n`;

  if (sourceIsCanonical) {
    return [
      destination,
      ...addedFacts.map((fact) => `- ${fact}`),
      "",
    ].join("\n");
  }

  return [
    destination,
    "",
    `## Imported memories from ${JSON.stringify(sourceFolder)}`,
    "",
    sourceContent.trim(),
    "",
  ].join("\n");
}

function normalizeMemoryDocument(content: string | null) {
  return content?.replace(/\r\n/g, "\n").trim() ?? "";
}

/**
 * Serializes every memories.md read/modify/write operation for a folder.
 * Keep the lock around the read and write; locking only the final write still
 * permits two concurrent transports to overwrite each other's facts.
 */
export function withResearchMemoryLock<T>(
  folderName: string,
  operation: () => Promise<T>,
): Promise<T> {
  return withResearchMemoryLocks([folderName], operation);
}

function withResearchMemoryLocks<T>(
  folderNames: readonly string[],
  operation: () => Promise<T>,
): Promise<T> {
  const folders = [
    ...new Set(folderNames.map((folder) => SafePathSegmentSchema.parse(folder))),
  ].sort();

  const acquire = (index: number): Promise<T> => {
    if (index >= folders.length) return operation();
    return enqueueResearchMemoryOperation(folders[index], () => acquire(index + 1));
  };

  return acquire(0);
}

function enqueueResearchMemoryOperation<T>(
  folderName: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = researchMemoryQueues.get(folderName) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  researchMemoryQueues.set(folderName, next);
  void next
    .finally(() => {
      if (researchMemoryQueues.get(folderName) === next) {
        researchMemoryQueues.delete(folderName);
      }
    })
    .catch(() => {});
  return next;
}

export function researchMemorySubfolder(folderName: string) {
  const parsedFolderName = SafePathSegmentSchema.parse(folderName);
  return `${SEARCH_RESULTS_SUBFOLDER}/${parsedFolderName}`;
}
