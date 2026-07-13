import {
  createChatLanguageModel,
  type ChatModelConfig,
} from "@/lib/chat-providers";
import { z } from "zod";
import { describeTool, type ToolDescriptor } from "@/lib/tool-descriptor";
import { TOOL_NAMES } from "@/lib/tool-names";
import { braveSearchInputSchema } from "@/tools/brave-search-tool";
import { exaSearchInputSchema } from "@/tools/exa-search-tool";
import { serperSearchInputSchema } from "@/tools/serper-search-tool";
import { tavilySearchInputSchema } from "@/tools/tavily-search-tool";
import { searxngSearchInputSchema } from "@/tools/searxng-search-tool";
import {
  createResearchCheckpointTool,
  createSearchTools,
} from "deep-search-core/research-orchestrator";
import {
  searchQueryInputSchema as youtubeSearchInputSchema,
} from "deep-search-core/search-extract/core";
import {
  aggregateSearchInputSchema,
  createAggregateSearchTool,
} from "@/tools/aggregate-search-tool";
import {
  disambiguateInputSchema,
  disambiguateTool,
} from "@/tools/disambiguate-tool";
import {
  createExtractPageContentTool,
  extractPageContentInputSchema,
} from "@/tools/extract-page-content-tool";
import {
  createSearchResearchTool,
  searchResearchInputSchema,
} from "@/tools/search-research-tool";
import {
  createCreateFileTool,
  createFileInputSchema,
  createReadFileTool,
  readFileInputSchema,
  createUpdateFileTool,
  updateFileInputSchema,
  createMoveFileTool,
  moveFileInputSchema,
  createDeleteFileTool,
  deleteFileInputSchema,
  createListFilesTool,
} from "@/tools/file-tools";
import {
  createSwitchResearchFolderTool,
  switchResearchFolderInputSchema,
} from "@/tools/switch-research-folder-tool";
import {
  createSequentialThinkingTool,
  sequentialThinkingInputSchema,
} from "@/tools/sequential-thinking-tool";
import {
  createFactsCheckTool,
  createResearchPlanTool,
  factsCheckInputSchema,
  researchPlanInputSchema,
} from "@/tools/core-research-tools";
import { researchCheckpointInputSchema } from "@/lib/agent-guards";
import { fetch as bridgeFetch } from "@/lib/tauri-bridge";
import type { ChromeMcpConnectionMode, WebExtractionBackend } from "@/lib/settings-store";

export type { ToolDescriptor, ToolParameter } from "@/lib/tool-descriptor";

type ToolInputSchema = z.ZodObject<Record<string, z.ZodTypeAny>>;

export interface ToolExecuteConfig {
  researchFolder: string | null;
  getChatModel?: () => ChatModelConfig | null;
  braveApiKey?: string | null;
  exaApiKey?: string | null;
  serperApiKey?: string | null;
  tavilyApiKey?: string | null;
  youtubeApiKey?: string | null;
  scrapeDoApiKey?: string | null;
  youtubeYtDlpPath?: string | null;
  searxngBaseUrl?: string | null;
  chromeDevToolsMcpEnabled?: boolean | null;
  chromeDevToolsMcpConnectionMode?: ChromeMcpConnectionMode | null;
  chromeDevToolsMcpBrowserUrl?: string | null;
  chromeDevToolsMcpNodePath?: string | null;
  webExtractionBackend?: WebExtractionBackend | null;
}

function describeOptionalTool(
  name: string,
  tool: unknown | undefined,
  schema: ToolInputSchema,
): ToolDescriptor {
  return describeTool(name, tool, schema, Boolean(tool));
}

export function getAvailableTools(
  config?: ToolExecuteConfig,
): ToolDescriptor[] {
  const researchFolder = config?.researchFolder;
  const getChatModel = config?.getChatModel;
  const braveApiKey = config?.braveApiKey;
  const exaApiKey = config?.exaApiKey;
  const serperApiKey = config?.serperApiKey;
  const tavilyApiKey = config?.tavilyApiKey;
  const youtubeApiKey = config?.youtubeApiKey;
  const scrapeDoApiKey = config?.scrapeDoApiKey;
  const youtubeSubtitleDownload = {
    ytDlpPath: config?.youtubeYtDlpPath ?? undefined,
  };
  const searxngBaseUrl = config?.searxngBaseUrl;

  const chatModel = getChatModel?.();
  const model = chatModel ? createChatLanguageModel(chatModel) : undefined;
  const getResearchFolder = researchFolder
    ? async () => researchFolder
    : undefined;

  const searchTools = createSearchTools(
    {
      braveApiKey: braveApiKey ?? undefined,
      exaApiKey: exaApiKey ?? undefined,
      serperApiKey: serperApiKey ?? undefined,
      tavilyApiKey: tavilyApiKey ?? undefined,
      youtubeApiKey: youtubeApiKey ?? undefined,
      searxngBaseUrl: searxngBaseUrl ?? undefined,
    },
    bridgeFetch,
  );
  const braveTool = searchTools[TOOL_NAMES.brave_search];
  const exaTool = searchTools[TOOL_NAMES.exa_search];
  const serperTool = searchTools[TOOL_NAMES.serper_search];
  const tavilyTool = searchTools[TOOL_NAMES.tavily_search];
  const youtubeTool = searchTools[TOOL_NAMES.youtube_search];
  const searxngTool = searchTools[TOOL_NAMES.searxng_search];
  const aggregateTool = createAggregateSearchTool({
    braveApiKey,
    exaApiKey,
    serperApiKey,
    tavilyApiKey,
    searxngBaseUrl,
  });
  const chromeMcpConfig = config?.chromeDevToolsMcpEnabled
    ? {
        enabled: true,
        connectionMode: config.chromeDevToolsMcpConnectionMode ?? undefined,
        browserUrl: config.chromeDevToolsMcpBrowserUrl ?? undefined,
        nodePath: config.chromeDevToolsMcpNodePath ?? undefined,
        backend: config.webExtractionBackend ?? "tauri-webview",
      }
    : undefined;
  const extractTool = model && getResearchFolder
    ? createExtractPageContentTool(
        model,
        getResearchFolder,
        chromeMcpConfig,
        scrapeDoApiKey,
        youtubeSubtitleDownload,
      )
    : undefined;
  const searchResearchTool = createSearchResearchTool(getResearchFolder);
  const createTool = getResearchFolder
    ? createCreateFileTool(getResearchFolder)
    : undefined;
  const readTool = getResearchFolder
    ? createReadFileTool(getResearchFolder)
    : undefined;
  const updateTool = getResearchFolder
    ? createUpdateFileTool(getResearchFolder)
    : undefined;
  const moveTool = getResearchFolder
    ? createMoveFileTool(getResearchFolder)
    : undefined;
  const deleteTool = getResearchFolder
    ? createDeleteFileTool(getResearchFolder)
    : undefined;
  const listTool = getResearchFolder
    ? createListFilesTool(getResearchFolder)
    : undefined;
  const checkpointTool = model ? createResearchCheckpointTool(model) : undefined;
  const planTool = model ? createResearchPlanTool(model) : undefined;
  const factsCheckTool = model
    ? createFactsCheckTool(model, scrapeDoApiKey)
    : undefined;

  return [
    describeOptionalTool(TOOL_NAMES.brave_search, braveTool, braveSearchInputSchema),
    describeOptionalTool(TOOL_NAMES.exa_search, exaTool, exaSearchInputSchema),
    describeOptionalTool(TOOL_NAMES.serper_search, serperTool, serperSearchInputSchema),
    describeOptionalTool(TOOL_NAMES.tavily_search, tavilyTool, tavilySearchInputSchema),
    describeOptionalTool(
      TOOL_NAMES.searxng_search,
      searxngTool,
      searxngSearchInputSchema,
    ),
    describeOptionalTool(
      TOOL_NAMES.youtube_search,
      youtubeTool,
      youtubeSearchInputSchema,
    ),
    describeOptionalTool(
      TOOL_NAMES.aggregate_search,
      aggregateTool,
      aggregateSearchInputSchema,
    ),

    describeTool(
      TOOL_NAMES.disambiguate,
      disambiguateTool,
      disambiguateInputSchema,
      true,
    ),

    describeOptionalTool(
      TOOL_NAMES.extract_page_content,
      extractTool,
      extractPageContentInputSchema,
    ),

    describeTool(
      TOOL_NAMES.sequential_thinking,
      createSequentialThinkingTool(),
      sequentialThinkingInputSchema,
      true,
    ),

    describeOptionalTool(
      TOOL_NAMES.search_research,
      searchResearchTool,
      searchResearchInputSchema,
    ),

    describeOptionalTool(
      TOOL_NAMES.create_file,
      createTool,
      createFileInputSchema,
    ),

    describeOptionalTool(
      TOOL_NAMES.read_file,
      readTool,
      readFileInputSchema,
    ),

    describeOptionalTool(
      TOOL_NAMES.update_file,
      updateTool,
      updateFileInputSchema,
    ),

    describeOptionalTool(
      TOOL_NAMES.move_file,
      moveTool,
      moveFileInputSchema,
    ),

    describeOptionalTool(
      TOOL_NAMES.delete_file,
      deleteTool,
      deleteFileInputSchema,
    ),

    describeOptionalTool(
      TOOL_NAMES.list_files,
      listTool,
      z.object({}),
    ),

    describeTool(
      TOOL_NAMES.switch_research_folder,
      // The Tools panel has no hook into the app's research-folder state, so
      // there is nothing to switch. Surface that explicitly instead of the
      // tool silently returning success via a no-op callback.
      createSwitchResearchFolderTool(() => {
        throw new Error(
          "switch_research_folder cannot change the active folder from the Tools panel. Use the research sidebar instead.",
        );
      }),
      switchResearchFolderInputSchema,
      true,
    ),

    describeOptionalTool(
      TOOL_NAMES.research_checkpoint,
      checkpointTool,
      researchCheckpointInputSchema,
    ),

    describeOptionalTool(
      TOOL_NAMES.create_research_plan,
      planTool,
      researchPlanInputSchema,
    ),

    describeOptionalTool(
      TOOL_NAMES.facts_check,
      factsCheckTool,
      factsCheckInputSchema,
    ),
  ];
}
