import { describe, expect, it } from "vitest";
import { TOOL_NAMES } from "@/lib/tool-names";
import { TOOL_CALL_REQUIREMENTS } from "@/lib/tool-call-requirements";
import systemPrompt from "@/lib/system-prompt.md?raw";

const RESEARCH_TOOL_NAMES = new Set<string>([
  TOOL_NAMES.brave_search,
  TOOL_NAMES.exa_search,
  TOOL_NAMES.serper_search,
  TOOL_NAMES.tavily_search,
  TOOL_NAMES.searxng_search,
  TOOL_NAMES.extract_page_content,
  TOOL_NAMES.create_file,
]);

const ALL_TOOL_NAME_VALUES = new Set<string>(Object.values(TOOL_NAMES));

const BACKTICKED_IDENTIFIER = /`([a-z][a-z0-9_]*)`/g;

function extractBacktickedToolNames(text: string): string[] {
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = BACKTICKED_IDENTIFIER.exec(text)) !== null) {
    names.push(match[1]);
  }
  return [...new Set(names)];
}

const NOT_TOOL_NAMES = new Set([
  "acme",
  "acme_market_map",
  "how_llms_work",
  "notes",
  "findings",
  "queue",
  "sources",
  "brave_initial",
  "tavily_followup",
  "open_questions",
  "skills",
  "new",
  "folder_name",
  "query",
]);

describe("tool name consistency", () => {
  it("has no duplicate values in TOOL_NAMES", () => {
    const values = Object.values(TOOL_NAMES);
    expect(values.length).toBe(new Set(values).size);
  });

  it("system prompt only references tool names that exist in TOOL_NAMES", () => {
    const allBackticked = extractBacktickedToolNames(systemPrompt);
    const unknown = allBackticked.filter(
      (name) =>
        !NOT_TOOL_NAMES.has(name) &&
        name.length >= 3 &&
        !ALL_TOOL_NAME_VALUES.has(name) &&
        !name.startsWith("chrome_devtools_"),
    );
    expect(unknown, `Unknown tool names in system prompt: ${unknown.join(", ")}`).toEqual([]);
  });

  it("system prompt references all core file tool names", () => {
    const coreFileTools = [
      TOOL_NAMES.create_file,
      TOOL_NAMES.read_file,
      TOOL_NAMES.update_file,
      TOOL_NAMES.list_files,
    ];
    for (const toolName of coreFileTools) {
      expect(
        systemPrompt.includes(`\`${toolName}\``),
        `system prompt must reference \`${toolName}\``,
      ).toBe(true);
    }
  });

  it("TOOL_CALL_REQUIREMENTS keys exist in TOOL_NAMES", () => {
    for (const key of Object.keys(TOOL_CALL_REQUIREMENTS)) {
      expect(ALL_TOOL_NAME_VALUES.has(key), `TOOL_CALL_REQUIREMENTS key "${key}" not in TOOL_NAMES`).toBe(true);
    }
  });

  it("TOOL_CALL_REQUIREMENTS requiredPreviousTools values exist in TOOL_NAMES", () => {
    for (const [, req] of Object.entries(TOOL_CALL_REQUIREMENTS)) {
      for (const prev of req.requiredPreviousTools) {
        expect(ALL_TOOL_NAME_VALUES.has(prev), `requiredPreviousTools "${prev}" not in TOOL_NAMES`).toBe(true);
      }
    }
  });

  it("RESEARCH_TOOL_NAMES entries exist in TOOL_NAMES", () => {
    for (const name of RESEARCH_TOOL_NAMES) {
      expect(ALL_TOOL_NAME_VALUES.has(name), `RESEARCH_TOOL_NAMES entry "${name}" not in TOOL_NAMES`).toBe(true);
    }
  });

  it("system prompt references key tools from every category", () => {
    const essential = [
      TOOL_NAMES.ask_questions,
      TOOL_NAMES.create_research_plan,
      TOOL_NAMES.rename_research_folder,
      TOOL_NAMES.search_research,
      TOOL_NAMES.extract_page_content,
      TOOL_NAMES.research_checkpoint,
      TOOL_NAMES.verified_research_is_good,
    ];
    for (const toolName of essential) {
      expect(
        systemPrompt.includes(`\`${toolName}\``),
        `system prompt must reference \`${toolName}\``,
      ).toBe(true);
    }
  });
});
