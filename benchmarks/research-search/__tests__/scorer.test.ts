import { describe, it, expect } from "vitest";

interface SearchResult {
  chunk_id: number;
  content: string;
  filename: string;
  folder_name: string;
  header_path: string | null;
  score: number;
  adjacent_chunks: unknown[] | null;
}

interface FolderScore {
  recall_at_1: number;
  recall_at_3: number;
  recall_at_5: number;
  mrr: number;
  rank_of_first_expected: number | null;
  irrelevant_appeared: string[];
  no_match_correct: boolean;
  best_score_per_folder: Record<string, number>;
  chunks_per_folder: Record<string, number>;
}

function scoreFolderLevel(
  expectedRelevant: string[],
  expectedIrrelevant: string[],
  results: SearchResult[]
): FolderScore {
  const seenFolders: string[] = [];
  const bestScorePerFolder: Record<string, number> = {};
  const chunksPerFolder: Record<string, number> = {};

  for (const r of results) {
    chunksPerFolder[r.folder_name] = (chunksPerFolder[r.folder_name] || 0) + 1;
    const best = bestScorePerFolder[r.folder_name];
    if (best === undefined || r.score > best) {
      bestScorePerFolder[r.folder_name] = r.score;
    }
    if (!seenFolders.includes(r.folder_name)) {
      seenFolders.push(r.folder_name);
    }
  }

  const isNoMatch = expectedRelevant.length === 0;
  const noMatchCorrect = isNoMatch && seenFolders.length === 0;

  let rankOfFirstExpected: number | null = null;
  let reciprocalRank = 0;

  for (let rank = 0; rank < seenFolders.length; rank++) {
    if (expectedRelevant.includes(seenFolders[rank])) {
      if (rankOfFirstExpected === null) {
        rankOfFirstExpected = rank + 1;
        reciprocalRank = 1 / (rank + 1);
      }
    }
  }

  const relevantAtK = (k: number): number => {
    return seenFolders
      .slice(0, k)
      .filter((f) => expectedRelevant.includes(f)).length;
  };

  const totalRelevant = expectedRelevant.length;

  const recallAt1 =
    totalRelevant > 0
      ? relevantAtK(1) / totalRelevant
      : isNoMatch && noMatchCorrect
        ? 1
        : 0;
  const recallAt3 =
    totalRelevant > 0
      ? relevantAtK(3) / totalRelevant
      : isNoMatch && noMatchCorrect
        ? 1
        : 0;
  const recallAt5 =
    totalRelevant > 0
      ? relevantAtK(5) / totalRelevant
      : isNoMatch && noMatchCorrect
        ? 1
        : 0;
  const mrr = !isNoMatch ? reciprocalRank : noMatchCorrect ? 1 : 0;

  const irrelevantAppeared = seenFolders.filter((f) =>
    expectedIrrelevant.includes(f)
  );

  return {
    recall_at_1: recallAt1,
    recall_at_3: recallAt3,
    recall_at_5: recallAt5,
    mrr,
    rank_of_first_expected: rankOfFirstExpected,
    irrelevant_appeared: irrelevantAppeared,
    no_match_correct: noMatchCorrect,
    best_score_per_folder: bestScorePerFolder,
    chunks_per_folder: chunksPerFolder,
  };
}

function makeResult(folderName: string, score: number): SearchResult {
  return {
    chunk_id: Math.floor(Math.random() * 10000),
    content: "test chunk content",
    filename: "test.md",
    folder_name: folderName,
    header_path: null,
    score,
    adjacent_chunks: null,
  };
}

describe("Folder-level scoring", () => {
  it("perfect recall@1 when top result is the only expected folder", () => {
    const results = [
      makeResult("hammock-sleep-health", 0.95),
      makeResult("coffee-brewing-methods", 0.3),
    ];
    const score = scoreFolderLevel(
      ["hammock-sleep-health"],
      [],
      results
    );
    expect(score.recall_at_1).toBe(1.0);
    expect(score.recall_at_3).toBe(1.0);
    expect(score.recall_at_5).toBe(1.0);
    expect(score.mrr).toBe(1.0);
    expect(score.rank_of_first_expected).toBe(1);
  });

  it("recall@3 captures second-position match", () => {
    const results = [
      makeResult("distractor-folder", 0.9),
      makeResult("hammock-sleep-health", 0.85),
      makeResult("another-distractor", 0.3),
    ];
    const score = scoreFolderLevel(
      ["hammock-sleep-health"],
      [],
      results
    );
    expect(score.recall_at_1).toBe(0.0);
    expect(score.recall_at_3).toBe(1.0);
    expect(score.mrr).toBe(0.5);
    expect(score.rank_of_first_expected).toBe(2);
  });

  it("multiple relevant folders - partial recall@1", () => {
    const results = [
      makeResult("hammock-sleep-health", 0.95),
      makeResult("hammock-sizing-guide", 0.7),
      makeResult("distractor", 0.3),
    ];
    const score = scoreFolderLevel(
      ["hammock-sleep-health", "hammock-sizing-guide"],
      [],
      results
    );
    expect(score.recall_at_1).toBe(0.5);
    expect(score.recall_at_3).toBe(1.0);
    expect(score.recall_at_5).toBe(1.0);
  });

  it("multiple relevant - recall@3 partial when third is missing", () => {
    const results = [
      makeResult("folder-a", 0.9),
      makeResult("folder-b", 0.7),
    ];
    const score = scoreFolderLevel(
      ["folder-a", "folder-b", "folder-c"],
      [],
      results
    );
    expect(score.recall_at_1).toBe(1 / 3);
    expect(score.recall_at_3).toBe(2 / 3);
    expect(score.recall_at_5).toBe(2 / 3);
  });

  it("no-match: correct when no results returned", () => {
    const score = scoreFolderLevel([], [], []);
    expect(score.no_match_correct).toBe(true);
    expect(score.recall_at_1).toBe(1.0);
    expect(score.recall_at_3).toBe(1.0);
    expect(score.recall_at_5).toBe(1.0);
    expect(score.mrr).toBe(1.0);
  });

  it("no-match: incorrect when results returned", () => {
    const results = [makeResult("unrelated-folder", 0.5)];
    const score = scoreFolderLevel([], [], results);
    expect(score.no_match_correct).toBe(false);
    expect(score.recall_at_1).toBe(0.0);
  });

  it("detects irrelevant folders appearing in results", () => {
    const results = [
      makeResult("hammock-sleep-health", 0.95),
      makeResult("coffee-brewing-methods", 0.3),
    ];
    const score = scoreFolderLevel(
      ["hammock-sleep-health"],
      ["coffee-brewing-methods"],
      results
    );
    expect(score.irrelevant_appeared).toContain("coffee-brewing-methods");
  });

  it("no irrelevant flag when irrelevant folders not in results", () => {
    const results = [
      makeResult("hammock-sleep-health", 0.95),
    ];
    const score = scoreFolderLevel(
      ["hammock-sleep-health"],
      ["coffee-brewing-methods"],
      results
    );
    expect(score.irrelevant_appeared).toEqual([]);
  });

  it("counts chunks per folder correctly", () => {
    const results = [
      makeResult("folder-a", 0.9),
      makeResult("folder-a", 0.7),
      makeResult("folder-b", 0.5),
    ];
    const score = scoreFolderLevel(["folder-a"], [], results);
    expect(score.chunks_per_folder["folder-a"]).toBe(2);
    expect(score.chunks_per_folder["folder-b"]).toBe(1);
  });

  it("tracks best score per folder", () => {
    const results = [
      makeResult("folder-a", 0.5),
      makeResult("folder-a", 0.9),
      makeResult("folder-a", 0.3),
    ];
    const score = scoreFolderLevel(["folder-a"], [], results);
    expect(score.best_score_per_folder["folder-a"]).toBe(0.9);
  });

  it("MRR is reciprocal of first expected rank", () => {
    const results = [
      makeResult("d1", 0.9),
      makeResult("d2", 0.8),
      makeResult("target", 0.7),
    ];
    const score = scoreFolderLevel(["target"], [], results);
    expect(score.mrr).toBe(1 / 3);
  });

  it("MRR is 0 when no expected folder found", () => {
    const results = [
      makeResult("d1", 0.9),
      makeResult("d2", 0.8),
    ];
    const score = scoreFolderLevel(["target"], [], results);
    expect(score.mrr).toBe(0.0);
    expect(score.rank_of_first_expected).toBeNull();
  });

  it("deduplicates folders in scoring (first occurrence counts)", () => {
    const results = [
      makeResult("folder-a", 0.9),
      makeResult("folder-b", 0.8),
      makeResult("folder-a", 0.7),
    ];
    const score = scoreFolderLevel(["folder-a"], [], results);
    expect(score.rank_of_first_expected).toBe(1);
  });
});
