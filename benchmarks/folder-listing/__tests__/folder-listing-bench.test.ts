import { describe, expect, it, vi } from "vitest";

// Benchmark for listResearchFolders per-folder CPU work.
//
// listResearchFolders calls getResearchFolderUpdatedAt(folderName) for each
// folder. The current implementation goes through listResearchChats which:
//   - Zod-parses the entire chat index via ResearchChatIndexSchema
//   - runs normalizeResearchChatSummary (with SafePathSegmentSchema.safeParse)
//     over every entry
//   - sorts via compareResearchChats (which calls Date.parse in the comparator)
//
// Only [0].updatedAt is used. We simulate this path to measure per-folder CPU.

const FOLDER_COUNT = 20;
const CHATS_PER_FOLDER = 30;

function makeIndexJson(chatCount: number): string {
  const now = Date.now();
  const chats = Array.from({ length: chatCount }, (_, i) => ({
    id: `2026-06-${String((i % 28) + 1).padStart(2, "0")}T10-00-00-00Z-chat-${i}`,
    title: `Chat ${i}`,
    createdAt: new Date(now - i * 60_000).toISOString(),
    updatedAt: new Date(now - i * 60_000).toISOString(),
    messageCount: i * 2,
  }));
  return JSON.stringify({ version: 1, chats });
}

async function setupMocks(indexJson: string, folders: string[]) {
  vi.resetModules();
  const { z } = await import("zod");
  const baseStorage = await import("@/lib/app-file-storage");
  vi.doMock("@/lib/app-file-storage", () => ({
    ...(baseStorage as object),
    readAppFile: vi.fn(async () => indexJson),
    listAppSubfolders: vi.fn(async () => folders),
    SafePathSegmentSchema: z.string().min(1).max(128),
  }));
}

describe("listResearchFolders per-folder CPU cost", { concurrent: false }, () => {
  it("compares current path vs dedicated getResearchFolderUpdatedAt", async () => {
    if (process.env.BENCH_FOLDER_LISTING !== "1") return;

    const indexJson = makeIndexJson(CHATS_PER_FOLDER);
    const folders = Array.from(
      { length: FOLDER_COUNT },
      (_, i) => `folder-${i}`,
    );

    // === Current path: listResearchFolders (calls listResearchChats per folder)
    await setupMocks(indexJson, folders);
    const { listResearchFolders: currentListFolders } = await import(
      "@/lib/research-history"
    );

    const ITERATIONS = 30;
    const WARMUP = 3;

    for (let i = 0; i < WARMUP; i += 1) {
      await currentListFolders();
    }

    const currentLatency: number[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const t = performance.now();
      await currentListFolders();
      currentLatency.push(performance.now() - t);
    }

    // === Optimized path: dedicated getResearchFolderUpdatedAt (inline sim)
    //
    // Parses JSON, scans for max updatedAt without Zod validation,
    // normalization, or sort.
    await setupMocks(indexJson, folders);

    const optimizedListFolders = async () => {
      const { listAppSubfolders, readAppFile } = await import(
        "@/lib/app-file-storage"
      );
      const { tryParseJson } = await import("@/lib/json");
      const SEARCH_RESULTS_SUBFOLDER = "search-results";
      const folderNames = await listAppSubfolders({
        subfolder: SEARCH_RESULTS_SUBFOLDER,
      });
      const summaries = await Promise.all(
        folderNames.map(async (name) => {
          const content = await readAppFile({
            subfolder: `${SEARCH_RESULTS_SUBFOLDER}/${name}/chats`,
            filename: "index.json",
          });
          if (!content) return { name, updatedAt: null };
          const parsed = tryParseJson(content) as
            | {
                chats?: Array<{
                  updatedAt?: string | null;
                  createdAt?: string | null;
                }>;
              }
            | null;
          const chats = parsed?.chats ?? [];
          let best = 0;
          for (const c of chats) {
            const v = c.updatedAt ?? c.createdAt;
            if (!v) continue;
            const ts = Date.parse(v);
            if (!Number.isNaN(ts) && ts > best) best = ts;
          }
          return {
            name,
            updatedAt: best ? new Date(best).toISOString() : null,
          };
        }),
      );
      return summaries;
    };

    for (let i = 0; i < WARMUP; i += 1) {
      await optimizedListFolders();
    }
    const optimizedLatency: number[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const t = performance.now();
      await optimizedListFolders();
      optimizedLatency.push(performance.now() - t);
    }

    const mean = (xs: number[]) =>
      xs.reduce((a, b) => a + b, 0) / xs.length;
    const p99 = (xs: number[]) =>
      xs.slice().sort((a, b) => a - b)[Math.floor(xs.length * 0.99)];

    const result = {
      folders: FOLDER_COUNT,
      chatsPerFolder: CHATS_PER_FOLDER,
      iterations: ITERATIONS,
      current: {
        meanMs: Number(mean(currentLatency).toFixed(3)),
        p99Ms: Number(p99(currentLatency).toFixed(3)),
      },
      optimized: {
        meanMs: Number(mean(optimizedLatency).toFixed(3)),
        p99Ms: Number(p99(optimizedLatency).toFixed(3)),
      },
    };

    // eslint-disable-next-line no-console
    console.log("\nFOLDER_LISTING_BENCH_RESULT", JSON.stringify(result));

    expect(result.optimized.meanMs).toBeLessThan(result.current.meanMs);
  });
});
