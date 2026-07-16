import { describe, expect, it, vi } from "vitest";
import {
  formatResearchMemoriesForRewrite,
  mergeResearchMemories,
  parseResearchMemories,
  withResearchMemoryLock,
} from "@/lib/research-memory";
import { loadResearchFolderContext } from "@/lib/research-folder-context";

describe("parseResearchMemories", () => {
  it("reads canonical bullets, legacy Memory fields, and ignores metadata", () => {
    expect(
      parseResearchMemories(`# Memories

- User prefers prices in EUR.
* Memory: User uses macOS.
- Category: preference
- Confidence: high
+ User has a dog.
`),
    ).toEqual([
      "User prefers prices in EUR.",
      "User uses macOS.",
      "User has a dog.",
    ]);
  });

  it("normalizes and deduplicates facts", () => {
    expect(
      parseResearchMemories("- User uses macOS.\n-  user uses macOS.  \n-\n"),
    ).toEqual(["User uses macOS."]);
  });

  it("does not truncate long facts or cap storage parsing", () => {
    const longFact = `Long preference: ${"x".repeat(1_500)}`;
    const content = [
      "# Memories",
      "",
      `- ${longFact}`,
      ...Array.from({ length: 205 }, (_, index) => `- Fact ${index}`),
      "",
    ].join("\n");

    const parsed = parseResearchMemories(content);
    expect(parsed).toHaveLength(206);
    expect(parsed[0]).toBe(longFact);
    expect(parsed[parsed.length - 1]).toBe("Fact 204");
  });
});

describe("mergeResearchMemories", () => {
  it("preserves provisional memories when a chat moves into an existing folder", async () => {
    const readAppFile = vi.fn(async ({ subfolder }: { subfolder: string }) =>
      subfolder.endsWith("/new-search")
        ? "# Memories\n\n- User has a dog.\n"
        : "# Memories\n\n- User prefers EUR.\n",
    );
    const writeAppFile = vi.fn(async () => undefined);

    await expect(
      mergeResearchMemories("new-search", "existing-search", {
        readAppFile,
        writeAppFile,
      }),
    ).resolves.toBe(1);

    expect(writeAppFile).toHaveBeenCalledWith({
      subfolder: "search-results/existing-search",
      filename: "memories.md",
      content:
        "# Memories\n\n- User prefers EUR.\n- User has a dog.\n",
    });
  });

  it("does not rewrite the destination when the source has no memories", async () => {
    const writeAppFile = vi.fn(async () => undefined);

    await expect(
      mergeResearchMemories("empty-search", "existing-search", {
        readAppFile: vi.fn(async () => null),
        writeAppFile,
      }),
    ).resolves.toBe(0);

    expect(writeAppFile).not.toHaveBeenCalled();
  });

  it("preserves every destination/source fact and long fact while merging", async () => {
    const longFact = `User provided ${"z".repeat(1_500)}`;
    const sourceFacts = [
      longFact,
      ...Array.from({ length: 205 }, (_, index) => `Source fact ${index}`),
    ];
    const destinationFacts = Array.from(
      { length: 205 },
      (_, index) => `Destination fact ${index}`,
    );
    let writtenContent = "";
    const writeAppFile = vi.fn(async (input: { content: string }) => {
      writtenContent = input.content;
    });

    await expect(
      mergeResearchMemories("source", "destination", {
        readAppFile: vi.fn(async ({ subfolder }) =>
          subfolder.endsWith("/source")
            ? `# Memories\n\n${sourceFacts.map((fact) => `- ${fact}`).join("\n")}\n`
            : `# Memories\n\n${destinationFacts.map((fact) => `- ${fact}`).join("\n")}\n`,
        ),
        writeAppFile,
      }),
    ).resolves.toBe(sourceFacts.length);

    const merged = parseResearchMemories(writtenContent);
    expect(merged).toHaveLength(destinationFacts.length + sourceFacts.length);
    expect(merged).toContain(longFact);
  });

  it("preserves legacy metadata and headings from both folders", async () => {
    const sourceContent = `# Memories

## Travel

- Memory: User prefers trains.
- Category: preference
- Source: onboarding
- Confidence: high
`;
    const destinationContent = `# Memories

- Memory: User prefers prices in EUR.
- Applies when: comparing products
- Evidence: repeated requests
`;
    let writtenContent = "";

    await expect(
      mergeResearchMemories("source", "destination", {
        readAppFile: vi.fn(async ({ subfolder }) =>
          subfolder.endsWith("/source") ? sourceContent : destinationContent,
        ),
        writeAppFile: vi.fn(async ({ content }) => {
          writtenContent = content;
        }),
      }),
    ).resolves.toBe(1);

    expect(writtenContent).toContain("## Travel");
    expect(writtenContent).toContain("- Category: preference");
    expect(writtenContent).toContain("- Source: onboarding");
    expect(writtenContent).toContain("- Applies when: comparing products");
    expect(writtenContent).toContain("- Evidence: repeated requests");
    expect(parseResearchMemories(writtenContent)).toEqual([
      "User prefers prices in EUR.",
      "User prefers trains.",
    ]);
  });

  it("preserves nonempty prose even when it has no recognized memory bullets", async () => {
    const sourceContent = `# Notes

User prefers rail travel. This file predates the canonical memory format.
`;
    let writtenContent = "";

    await expect(
      mergeResearchMemories("source", "destination", {
        readAppFile: vi.fn(async ({ subfolder }) =>
          subfolder.endsWith("/source")
            ? sourceContent
            : "# Memories\n\n- User prefers prices in EUR.\n",
        ),
        writeAppFile: vi.fn(async ({ content }) => {
          writtenContent = content;
        }),
      }),
    ).resolves.toBe(0);

    expect(writtenContent).toContain("# Notes");
    expect(writtenContent).toContain("User prefers rail travel");
  });

  it("serializes merge with another writer targeting the destination", async () => {
    let destinationContent = "# Memories\n\n- Original destination fact\n";
    const writerStarted = deferred<void>();
    const releaseWriter = deferred<void>();
    const readAppFile = vi.fn(async ({ subfolder }: { subfolder: string }) =>
      subfolder.endsWith("/source")
        ? "# Memories\n\n- Source fact\n"
        : destinationContent,
    );
    const writeAppFile = vi.fn(async ({ content }: { content: string }) => {
      destinationContent = content;
    });

    const concurrentWriter = withResearchMemoryLock("destination", async () => {
      writerStarted.resolve();
      await releaseWriter.promise;
      destinationContent =
        "# Memories\n\n- Original destination fact\n- Concurrent fact\n";
    });
    await writerStarted.promise;

    const merge = mergeResearchMemories("source", "destination", {
      readAppFile,
      writeAppFile,
    });
    await Promise.resolve();
    expect(readAppFile).not.toHaveBeenCalled();

    releaseWriter.resolve();
    await concurrentWriter;
    await merge;

    expect(parseResearchMemories(destinationContent)).toEqual([
      "Original destination fact",
      "Concurrent fact",
      "Source fact",
    ]);
  });
});

describe("formatResearchMemoriesForRewrite", () => {
  it("preserves legacy notes without duplicating its wrapper on later rewrites", () => {
    const legacy = `# Memories

- Memory: User prefers rail travel.
- Category: preference

Manual accessibility note.
`;
    const first = formatResearchMemoriesForRewrite(legacy, [
      "User prefers rail travel.",
      "User prefers EUR.",
    ]);
    const second = formatResearchMemoriesForRewrite(first, [
      "User prefers rail travel.",
      "User prefers EUR.",
      "User uses macOS.",
    ]);

    expect(second.match(/## Preserved legacy notes/g)).toHaveLength(1);
    expect(second).toContain("- Category: preference");
    expect(second).toContain("Manual accessibility note.");
    expect(parseResearchMemories(second)).toEqual([
      "User prefers rail travel.",
      "User prefers EUR.",
      "User uses macOS.",
    ]);
  });
});

describe("loadResearchFolderContext", () => {
  it("loads a bounded topic, files, and current-folder memories", async () => {
    const readAppFile = vi.fn(
      async ({ filename }: { subfolder: string; filename: string }) => {
        if (filename === "summary.md") {
          return "# Summary\n\nFrench EV market sizing and competitor analysis.";
        }
        if (filename === "README.md") return "# Older report";
        if (filename === "memories.md") {
          return "# Memories\n\n- User prefers France-focused results.\n";
        }
        return null;
      },
    );

    const context = await loadResearchFolderContext("european-ev-market", {
      listAppFiles: vi
        .fn()
        .mockResolvedValue(["README.md", "memories.md", "summary.md"]),
      listResearchChats: vi.fn().mockResolvedValue([
        {
          id: "chat-1",
          title: "European EV market",
          createdAt: null,
          updatedAt: null,
          messageCount: 3,
        },
      ]),
      readAppFile,
    });

    expect(context).toEqual({
      folderName: "european-ev-market",
      files: ["README.md", "memories.md", "summary.md"],
      topic: "# Summary\n\nFrench EV market sizing and competitor analysis.",
      topicSource: "summary.md",
      memories: ["User prefers France-focused results."],
    });
    expect(readAppFile).toHaveBeenCalledTimes(3);
    expect(readAppFile.mock.calls.every(
      ([input]) => input.subfolder === "search-results/european-ev-market",
    )).toBe(true);
  });

  it("falls back to the latest chat title and tolerates unreadable files", async () => {
    const context = await loadResearchFolderContext("coffee-research", {
      listAppFiles: vi.fn().mockRejectedValue(new Error("unreadable")),
      listResearchChats: vi.fn().mockResolvedValue([
        {
          id: "chat-1",
          title: "Specialty coffee demand in France",
          createdAt: null,
          updatedAt: null,
          messageCount: 2,
        },
      ]),
      readAppFile: vi.fn().mockRejectedValue(new Error("unreadable")),
    });

    expect(context).toEqual({
      folderName: "coffee-research",
      files: [],
      topic: "Specialty coffee demand in France",
      topicSource: "chat-title",
      memories: [],
    });
  });

  it("bounds aggregate topic, filename, and memory context", async () => {
    const memory = "m".repeat(1_500);
    const context = await loadResearchFolderContext("bounded-folder", {
      listAppFiles: vi.fn().mockResolvedValue(
        Array.from({ length: 100 }, (_, index) =>
          `${index}-${"f".repeat(250)}.md`,
        ),
      ),
      listResearchChats: vi.fn().mockResolvedValue([]),
      readAppFile: vi.fn(async ({ filename }) => {
        if (filename === "summary.md") return "t".repeat(10_000);
        if (filename === "memories.md") {
          return `# Memories\n\n${Array.from(
            { length: 100 },
            (_, index) => `- ${index}-${memory}`,
          ).join("\n")}\n`;
        }
        return null;
      }),
    });

    expect(context.topic).toHaveLength(4_000);
    expect(context.files.reduce((sum, value) => sum + value.length, 0)).toBeLessThanOrEqual(4_000);
    expect(context.memories.reduce((sum, value) => sum + value.length, 0)).toBeLessThanOrEqual(8_000);
    expect(context.memories.every((value) => value.length <= 1_000)).toBe(true);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
