import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeSourceDir(): string {
  const root = mkdtempSync(path.join(tmpdir(), "research-search-generator-"));
  tempRoots.push(root);
  return root;
}

function writeFolder(
  root: string,
  name: string,
  metadata: { description: string; related?: string[] },
): void {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  writeFileSync(path.join(dir, "summary.md"), `# ${name}\n\n${metadata.description}\n`);
}

describe("real corpus generator", () => {
  it("treats reverse metadata.related links as related, not hard negatives", async () => {
    const generator = await import("../../../scripts/generate-research-search-corpus.mjs");
    const root = makeSourceDir();

    writeFolder(root, "alpha-local-llm", {
      description: "local llm coding hardware setup",
    });
    writeFolder(root, "beta-local-llm-workflows", {
      description: "local llm coding workflows and agent notes",
      related: ["alpha-local-llm"],
    });
    writeFolder(root, "gamma-local-llm-distractor", {
      description: "local llm coding unrelated distractor topic",
    });

    const args = {
      source: root,
      folders: [
        "alpha-local-llm",
        "beta-local-llm-workflows",
        "gamma-local-llm-distractor",
      ],
      maxFolders: 3,
      maxFilesPerFolder: 1,
      maxFileChars: 8_000,
      maxQueries: 10,
      maxRelatedQueries: 10,
    };

    const selected = generator.selectFolders(generator.discoverFolders(root), args);
    const corpus = generator.buildCorpus(selected, args);

    const alphaDescription = corpus.queries.find(
      (query) => query.id.endsWith("-alpha-local-llm-description"),
    );
    expect(alphaDescription?.expected_irrelevant).not.toContain("beta-local-llm-workflows");
    expect(alphaDescription?.expected_irrelevant).toContain("gamma-local-llm-distractor");

    const alphaRelated = corpus.queries.find(
      (query) => query.description === "Related-folder query for alpha-local-llm",
    );
    expect(alphaRelated?.expected_relevant).toEqual([
      "alpha-local-llm",
      "beta-local-llm-workflows",
    ]);
  });
});
