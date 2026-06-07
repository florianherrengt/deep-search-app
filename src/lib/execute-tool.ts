import {
  createChatLanguageModel,
  type ChatModelConfig,
} from "@/lib/chat-providers";
import { z } from "zod";
import { describeTool, type ToolDescriptor } from "@/lib/tool-descriptor";
import {
  braveSearchInputSchema,
  createBraveSearchTool,
} from "@/tools/brave-search-tool";
import {
  createExaSearchTool,
  exaSearchInputSchema,
} from "@/tools/exa-search-tool";
import {
  createSerperSearchTool,
  serperSearchInputSchema,
} from "@/tools/serper-search-tool";
import {
  createTavilySearchTool,
  tavilySearchInputSchema,
} from "@/tools/tavily-search-tool";
import {
  createSearXNGSearchTool,
  searxngSearchInputSchema,
} from "@/tools/searxng-search-tool";
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
  createRenameResearchFolderTool,
  renameResearchFolderInputSchema,
} from "@/tools/rename-research-folder-tool";
import { createResearchCheckpointTool } from "@/tools/research-checkpoint-tool";
import {
  createSequentialThinkingTool,
  sequentialThinkingInputSchema,
} from "@/tools/sequential-thinking-tool";
import {
  createResearchPlanTool,
  researchPlanInputSchema,
} from "@/tools/research-plan-tool";
import {
  createVerifiedResearchIsGoodTool,
  verifiedResearchInputSchema,
} from "@/tools/verified-research-tool";
import { researchCheckpointInputSchema } from "@/lib/agent-guards";
import { isValidServiceUrl } from "@/lib/url-validation";

export type { ToolDescriptor, ToolParameter } from "@/lib/tool-descriptor";

type ToolInputSchema = z.ZodObject<Record<string, z.ZodTypeAny>>;

export interface ToolExecuteConfig {
  researchFolder: string | null;
  embeddingConfig?: import("@/lib/research-search").EmbeddingConfig;
  rerankerConfig?: import("@/lib/research-search").RerankerConfig;
  getChatModel?: () => ChatModelConfig | null;
  braveApiKey?: string | null;
  exaApiKey?: string | null;
  serperApiKey?: string | null;
  tavilyApiKey?: string | null;
  searxngBaseUrl?: string | null;
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
  const embeddingConfig = config?.embeddingConfig;
  const rerankerConfig = config?.rerankerConfig;
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
  const searxngTool =
    searxngBaseUrl && isValidServiceUrl(searxngBaseUrl)
      ? createSearXNGSearchTool(searxngBaseUrl)
      : undefined;
  const extractTool = model && getResearchFolder
    ? createExtractPageContentTool(model, getResearchFolder)
    : undefined;
  const searchResearchTool = embeddingConfig && rerankerConfig && model ? createSearchResearchTool(embeddingConfig, rerankerConfig, model) : undefined;
  const createTool = getResearchFolder
    ? createCreateFileTool(getResearchFolder, embeddingConfig)
    : undefined;
  const readTool = getResearchFolder
    ? createReadFileTool(getResearchFolder)
    : undefined;
  const updateTool = getResearchFolder
    ? createUpdateFileTool(getResearchFolder, embeddingConfig)
    : undefined;
  const moveTool = getResearchFolder
    ? createMoveFileTool(getResearchFolder, embeddingConfig)
    : undefined;
  const deleteTool = getResearchFolder
    ? createDeleteFileTool(getResearchFolder)
    : undefined;
  const listTool = getResearchFolder
    ? createListFilesTool(getResearchFolder)
    : undefined;
  const checkpointTool = model ? createResearchCheckpointTool(model) : undefined;
  const planTool = model ? createResearchPlanTool(model) : undefined;
  const verifiedResearchTool = model
    ? createVerifiedResearchIsGoodTool(model, {
        braveApiKey,
        exaApiKey,
        serperApiKey,
        tavilyApiKey,
        searxngBaseUrl,
      })
    : undefined;

  return [
    describeOptionalTool("brave_search", braveTool, braveSearchInputSchema),
    describeOptionalTool("exa_search", exaTool, exaSearchInputSchema),
    describeOptionalTool("serper_search", serperTool, serperSearchInputSchema),
    describeOptionalTool("tavily_search", tavilyTool, tavilySearchInputSchema),
    describeOptionalTool(
      "searxng_search",
      searxngTool,
      searxngSearchInputSchema,
    ),

    describeTool(
      "disambiguate",
      disambiguateTool,
      disambiguateInputSchema,
      true,
    ),

    describeOptionalTool(
      "extract_page_content",
      extractTool,
      extractPageContentInputSchema,
    ),

    describeTool(
      "sequential_thinking",
      createSequentialThinkingTool(),
      sequentialThinkingInputSchema,
      true,
    ),

    describeOptionalTool(
      "search_research",
      searchResearchTool,
      searchResearchInputSchema,
    ),

    describeOptionalTool(
      "create_file",
      createTool,
      createFileInputSchema,
    ),

    describeOptionalTool(
      "read_file",
      readTool,
      readFileInputSchema,
    ),

    describeOptionalTool(
      "update_file",
      updateTool,
      updateFileInputSchema,
    ),

    describeOptionalTool(
      "move_file",
      moveTool,
      moveFileInputSchema,
    ),

    describeOptionalTool(
      "delete_file",
      deleteTool,
      deleteFileInputSchema,
    ),

    describeOptionalTool(
      "list_files",
      listTool,
      z.object({}),
    ),

    describeTool(
      "switch_research_folder",
      createSwitchResearchFolderTool(() => {}),
      switchResearchFolderInputSchema,
      true,
    ),

    describeOptionalTool(
      "rename_research_folder",
      getResearchFolder && embeddingConfig
        ? createRenameResearchFolderTool({
            getResearchFolder,
            onFolderRenamed: async () => {},
            embeddingConfig,
          })
        : undefined,
      renameResearchFolderInputSchema,
    ),

    describeOptionalTool(
      "research_checkpoint",
      checkpointTool,
      researchCheckpointInputSchema,
    ),

    describeOptionalTool(
      "create_research_plan",
      planTool,
      researchPlanInputSchema,
    ),

    describeOptionalTool(
      "verified_research_is_good",
      verifiedResearchTool,
      verifiedResearchInputSchema,
    ),
  ];
}
