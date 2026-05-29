import {
  createChatLanguageModel,
  type ChatModelConfig,
} from "@/lib/chat-providers";
import { describeTool, type ToolDescriptor } from "@/lib/tool-descriptor";
import { createBraveSearchTool, braveSearchInputSchema } from "@/tools/brave-search-tool";
import { createExaSearchTool, exaSearchInputSchema } from "@/tools/exa-search-tool";
import { createSerperSearchTool, serperSearchInputSchema } from "@/tools/serper-search-tool";
import { createTavilySearchTool, tavilySearchInputSchema } from "@/tools/tavily-search-tool";
import { createSearXNGSearchTool, searxngSearchInputSchema } from "@/tools/searxng-search-tool";
import { disambiguateTool, disambiguateInputSchema } from "@/tools/disambiguate-tool";
import { createExtractPageContentTool, extractPageContentInputSchema } from "@/tools/extract-page-content-tool";
import { createSearchResearchTool, searchResearchInputSchema } from "@/tools/search-research-tool";
import { createSaveResearchFileTool, saveResearchFileInputSchema } from "@/tools/research-file-tool";
import { createSwitchResearchFolderTool, switchResearchFolderInputSchema } from "@/tools/switch-research-folder-tool";
import { createResearchCheckpointTool } from "@/tools/research-checkpoint-tool";
import { createSequentialThinkingTool, sequentialThinkingInputSchema } from "@/tools/sequential-thinking-tool";
import { createResearchPlanTool, researchPlanInputSchema } from "@/tools/research-plan-tool";
import { researchCheckpointInputSchema } from "@/lib/agent-guards";
import { isValidServiceUrl } from "@/lib/url-validation";

export type { ToolDescriptor, ToolParameter } from "@/lib/tool-descriptor";

export interface ToolExecuteConfig {
  researchFolder: string | null;
  apiKey: string;
  getChatModel?: () => ChatModelConfig | null;
  braveApiKey?: string | null;
  exaApiKey?: string | null;
  serperApiKey?: string | null;
  tavilyApiKey?: string | null;
  searxngBaseUrl?: string | null;
}

export function getAvailableTools(
  config?: ToolExecuteConfig,
): ToolDescriptor[] {
  const researchFolder = config?.researchFolder;
  const apiKey = config?.apiKey;
  const getChatModel = config?.getChatModel;
  const braveApiKey = config?.braveApiKey;
  const exaApiKey = config?.exaApiKey;
  const serperApiKey = config?.serperApiKey;
  const tavilyApiKey = config?.tavilyApiKey;
  const searxngBaseUrl = config?.searxngBaseUrl;

  const chatModel = getChatModel?.();
  const model = chatModel ? createChatLanguageModel(chatModel) : undefined;
  const getResearchFolder = researchFolder
    ? async () => researchFolder
    : undefined;

  const braveTool = braveApiKey ? createBraveSearchTool(braveApiKey) : undefined;
  const exaTool = exaApiKey ? createExaSearchTool(exaApiKey) : undefined;
  const serperTool = serperApiKey ? createSerperSearchTool(serperApiKey) : undefined;
  const tavilyTool = tavilyApiKey ? createTavilySearchTool(tavilyApiKey) : undefined;
  const searxngAvailable = !!searxngBaseUrl && isValidServiceUrl(searxngBaseUrl);
  const searxngTool = searxngAvailable ? createSearXNGSearchTool(searxngBaseUrl!) : undefined;
  const extractTool = model && getResearchFolder
    ? createExtractPageContentTool(model, getResearchFolder)
    : undefined;
  const searchResearchTool = apiKey ? createSearchResearchTool(apiKey) : undefined;
  const saveTool = getResearchFolder
    ? createSaveResearchFileTool(getResearchFolder, apiKey)
    : undefined;
  const checkpointTool = model ? createResearchCheckpointTool(model) : undefined;
  const planTool = model ? createResearchPlanTool(model) : undefined;

  return [
    ...(braveTool
      ? [describeTool("brave_search", braveTool as any, braveSearchInputSchema, true)]
      : [describeTool("brave_search", {} as any, braveSearchInputSchema, false)]),
    ...(exaTool
      ? [describeTool("exa_search", exaTool as any, exaSearchInputSchema, true)]
      : [describeTool("exa_search", {} as any, exaSearchInputSchema, false)]),
    ...(serperTool
      ? [describeTool("serper_search", serperTool as any, serperSearchInputSchema, true)]
      : [describeTool("serper_search", {} as any, serperSearchInputSchema, false)]),
    ...(tavilyTool
      ? [describeTool("tavily_search", tavilyTool as any, tavilySearchInputSchema, true)]
      : [describeTool("tavily_search", {} as any, tavilySearchInputSchema, false)]),
    ...(searxngTool
      ? [describeTool("searxng_search", searxngTool as any, searxngSearchInputSchema, true)]
      : [describeTool("searxng_search", {} as any, searxngSearchInputSchema, false)]),

    describeTool(
      "disambiguate",
      disambiguateTool as any,
      disambiguateInputSchema,
      true,
    ),

    ...(extractTool
      ? [describeTool("extract_page_content", extractTool as any, extractPageContentInputSchema, true)]
      : [describeTool("extract_page_content", {} as any, extractPageContentInputSchema, false)]),

    describeTool(
      "sequential_thinking",
      createSequentialThinkingTool() as any,
      sequentialThinkingInputSchema,
      true,
    ),

    ...(searchResearchTool
      ? [describeTool("search_research", searchResearchTool as any, searchResearchInputSchema, true)]
      : [describeTool("search_research", {} as any, searchResearchInputSchema, false)]),

    ...(saveTool
      ? [describeTool("save_research_file", saveTool as any, saveResearchFileInputSchema, true)]
      : [describeTool("save_research_file", {} as any, saveResearchFileInputSchema, false)]),

    describeTool(
      "switch_research_folder",
      createSwitchResearchFolderTool(() => {}) as any,
      switchResearchFolderInputSchema,
      true,
    ),

    ...(checkpointTool
      ? [describeTool("research_checkpoint", checkpointTool as any, researchCheckpointInputSchema as any, true)]
      : [describeTool("research_checkpoint", {} as any, researchCheckpointInputSchema as any, false)]),

    ...(planTool
      ? [describeTool("create_research_plan", planTool as any, researchPlanInputSchema, true)]
      : [describeTool("create_research_plan", {} as any, researchPlanInputSchema, false)]),
  ];
}
