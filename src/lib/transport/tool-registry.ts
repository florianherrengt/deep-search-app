import { type LanguageModel, type ToolSet } from "ai";
import {
  questionsTool,
  createDisambiguateTool,
  createSearchTools,
  createSequentialThinkingTool,
  createResearchPlanTool,
  createResearchCheckpointTool,
  type SearchKeys as PkgSearchKeys,
} from "research-orchestrator";
import { fetch as bridgeFetch } from "@/lib/tauri-bridge";
import { createExtractPageContentTool } from "@/tools/extract-page-content-tool";
import { createCreateFileTool, createReadFileTool, createUpdateFileTool, createMoveFileTool, createDeleteFileTool, createListFilesTool } from "@/tools/file-tools";
import { createLoadSkillTool } from "@/tools/load-skill-tool";
import { createSearchResearchTool } from "@/tools/search-research-tool";
import { createSwitchResearchFolderTool } from "@/tools/switch-research-folder-tool";
import { createCurrencyConversionTool } from "@/tools/currency-conversion-tool";
import { createFactsCheckTool } from "@/tools/facts-check-tool";
import { applyToolCallRequirementSafeguards } from "@/lib/tool-call-requirements";
import type { Currency, ChromeMcpConnectionMode } from "@/lib/settings-store";
import type { EmbeddingConfig, RerankerConfig } from "@/lib/research-search";
import { createChromeDevToolsMcpTools } from "@/lib/mcp/chrome-devtools-tools";

export interface SearchToolKeys {
  braveApiKey?: string | null;
  exaApiKey?: string | null;
  serperApiKey?: string | null;
  tavilyApiKey?: string | null;
  searxngBaseUrl?: string | null;
  currency?: Currency;
  chromeDevToolsMcpEnabled?: boolean;
  chromeDevToolsMcpConnectionMode?: ChromeMcpConnectionMode;
  chromeDevToolsMcpBrowserUrl?: string | null;
}

export async function createTools({
  model,
  getResearchFolder,
  switchResearchFolder,
  embeddingConfig,
  rerankerConfig,
  searchKeys,
}: {
  model: LanguageModel;
  getResearchFolder: () => Promise<string>;
  switchResearchFolder: (folderName: string) => void | Promise<void>;
  embeddingConfig: EmbeddingConfig;
  rerankerConfig: RerankerConfig;
  searchKeys?: SearchToolKeys;
}) {
  const chromeDevToolsToolsRaw = await createChromeDevToolsMcpTools({
    enabled: Boolean(searchKeys?.chromeDevToolsMcpEnabled),
    connectionMode: searchKeys?.chromeDevToolsMcpConnectionMode,
    browserUrl: searchKeys?.chromeDevToolsMcpBrowserUrl ?? undefined,
  });
  const chromeDevToolsTools: ToolSet = {};
  for (const [name, t] of Object.entries(chromeDevToolsToolsRaw)) {
    chromeDevToolsTools[name] = t as any;
  }

  const pkgSearchKeys: PkgSearchKeys | undefined = searchKeys
    ? {
        braveApiKey: searchKeys.braveApiKey ?? undefined,
        exaApiKey: searchKeys.exaApiKey ?? undefined,
        serperApiKey: searchKeys.serperApiKey ?? undefined,
        tavilyApiKey: searchKeys.tavilyApiKey ?? undefined,
        searxngBaseUrl: searchKeys.searxngBaseUrl ?? undefined,
      }
    : undefined;

  const searchTools = createSearchTools(pkgSearchKeys, bridgeFetch);

  const tools = {
    ask_questions: questionsTool,
    disambiguate: createDisambiguateTool(bridgeFetch),
    ...searchTools,
    sequential_thinking: createSequentialThinkingTool(),
    create_research_plan: createResearchPlanTool(model),
    research_checkpoint: createResearchCheckpointTool(model),

    extract_page_content: createExtractPageContentTool(model, getResearchFolder),
    facts_check: createFactsCheckTool(model),
    create_file: createCreateFileTool(getResearchFolder, embeddingConfig),
    read_file: createReadFileTool(getResearchFolder),
    update_file: createUpdateFileTool(getResearchFolder, embeddingConfig),
    move_file: createMoveFileTool(getResearchFolder, embeddingConfig),
    delete_file: createDeleteFileTool(getResearchFolder),
    list_files: createListFilesTool(getResearchFolder),
    load_skill: createLoadSkillTool(),
    search_research: createSearchResearchTool(embeddingConfig, rerankerConfig, model),
    switch_research_folder: createSwitchResearchFolderTool(switchResearchFolder),
    currency_conversion: createCurrencyConversionTool(searchKeys?.currency ?? "USD"),
    ...chromeDevToolsTools,
  } as const satisfies ToolSet;

  return applyToolCallRequirementSafeguards(tools);
}

export type AppToolSet = Awaited<ReturnType<typeof createTools>>;
