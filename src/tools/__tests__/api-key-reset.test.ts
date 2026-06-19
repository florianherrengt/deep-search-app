import { describe, expect, it } from "vitest";
import { getAvailableTools, type ToolExecuteConfig } from "@/lib/execute-tool";

const SEARCH_TOOLS = [
  "brave_search",
  "exa_search",
  "serper_search",
  "tavily_search",
  "searxng_search",
] as const;

const TEST_CHAT_MODEL = {
  provider: "openrouter",
  apiKey: "chat-key",
  model: "openrouter/test-model",
} as const;

describe("search tool availability from config", () => {
  it("all search tools unavailable when no keys provided", () => {
    const tools = getAvailableTools({ researchFolder: null });
    for (const name of SEARCH_TOOLS) {
      const t = tools.find((t) => t.name === name);
      expect(t?.available ?? false).toBe(false);
    }
  });

  it("brave_search available when brave key provided", () => {
    const tools = getAvailableTools({
      researchFolder: null,
      braveApiKey: "brave-key-123",
    });
    const brave = tools.find((t) => t.name === "brave_search");
    expect(brave?.available).toBe(true);
  });

  it("exa_search available when exa key provided", () => {
    const tools = getAvailableTools({
      researchFolder: null,
      exaApiKey: "exa-key-123",
    });
    const exa = tools.find((t) => t.name === "exa_search");
    expect(exa?.available).toBe(true);
  });

  it("serper_search available when serper key provided", () => {
    const tools = getAvailableTools({
      researchFolder: null,
      serperApiKey: "serper-key-123",
    });
    const serper = tools.find((t) => t.name === "serper_search");
    expect(serper?.available).toBe(true);
  });

  it("tavily_search available when tavily key provided", () => {
    const tools = getAvailableTools({
      researchFolder: null,
      tavilyApiKey: "tavily-key-123",
    });
    const tavily = tools.find((t) => t.name === "tavily_search");
    expect(tavily?.available).toBe(true);
  });

  it("searxng_search available when non-default url provided", () => {
    const tools = getAvailableTools({
      researchFolder: null,
      searxngBaseUrl: "https://search.example.com",
    });
    const searxng = tools.find((t) => t.name === "searxng_search");
    expect(searxng?.available).toBe(true);
  });

  it("searxng_search available with a configured local service url", () => {
    const tools = getAvailableTools({
      researchFolder: null,
      searxngBaseUrl: "http://localhost:8080",
    });
    const searxng = tools.find((t) => t.name === "searxng_search");
    expect(searxng?.available).toBe(true);
  });

  it("searxng_search unavailable with a non-network service url", () => {
    const tools = getAvailableTools({
      researchFolder: null,
      searxngBaseUrl: "file:///tmp/search",
    });
    const searxng = tools.find((t) => t.name === "searxng_search");
    expect(searxng?.available).toBe(false);
  });

  it("simulated reset-all flow: all keys become unavailable", () => {
    const configWithKeys: ToolExecuteConfig = {
      researchFolder: null,
      braveApiKey: "brave-key",
      exaApiKey: "exa-key",
      serperApiKey: "serper-key",
      tavilyApiKey: "tavily-key",
      searxngBaseUrl: "https://search.example.com",
    };

    const toolsBefore = getAvailableTools(configWithKeys);
    for (const name of SEARCH_TOOLS) {
      const t = toolsBefore.find((t) => t.name === name);
      expect(t?.available).toBe(true);
    }

    const configCleared: ToolExecuteConfig = {
      researchFolder: null,
      braveApiKey: "",
      exaApiKey: "",
      serperApiKey: "",
      tavilyApiKey: "",
      searxngBaseUrl: "",
    };

    const toolsAfter = getAvailableTools(configCleared);
    for (const name of SEARCH_TOOLS) {
      const t = toolsAfter.find((t) => t.name === name);
      expect(t?.available).toBe(false);
    }
  });

  it("search_research available when model is provided", () => {
    const tools = getAvailableTools({
      researchFolder: null,
      getChatModel: () => TEST_CHAT_MODEL,
    });
    const sr = tools.find((t) => t.name === "search_research");
    expect(sr?.available).toBe(true);
  });

  it("search_research unavailable when no model is provided", () => {
    const tools = getAvailableTools({
      researchFolder: null,
    });
    const sr = tools.find((t) => t.name === "search_research");
    expect(sr?.available).toBe(false);
  });

  it("model and research-folder dependent tools become available from direct-tool config", () => {
    const tools = getAvailableTools({
      researchFolder: "manual-folder",
      getChatModel: () => TEST_CHAT_MODEL,
    });

    expect(tools.find((t) => t.name === "extract_page_content")?.available).toBe(
      true,
    );
    expect(tools.find((t) => t.name === "create_file")?.available).toBe(
      true,
    );
    expect(tools.find((t) => t.name === "research_checkpoint")?.available).toBe(
      true,
    );
    expect(tools.find((t) => t.name === "create_research_plan")?.available).toBe(
      true,
    );
    expect(
      tools.find((t) => t.name === "facts_check")?.available,
    ).toBe(true);
  });
});
