import { createGuardedStream as runGuardedLoop } from "research-orchestrator";
import { type LanguageModel, type UIMessage, type UIMessageChunk } from "ai";
import { SafePathSegmentSchema } from "@/lib/app-file-storage";
import { isSubAgentOutputTextPart } from "@/lib/sub-agent-stream";
import { evaluateAssistantStep } from "@/lib/agent-guards";
import { createTools, type SearchToolKeys } from "./tool-registry";
import type { EmbeddingConfig, RerankerConfig } from "@/lib/research-search";
import { skillsStore } from "@/lib/skills-store";
import systemPrompt from "../system-prompt.md?raw";

export function createGuardedStream({
  model,
  researchFolder,
  embeddingConfig,
  rerankerConfig,
  messages,
  abortSignal,
  onResearchFolderChange,
  searchKeys,
  controller,
}: {
  model: LanguageModel;
  researchFolder: string | null;
  embeddingConfig: EmbeddingConfig;
  rerankerConfig: RerankerConfig;
  messages: UIMessage[];
  abortSignal: AbortSignal | undefined;
  onResearchFolderChange?: (folderName: string) => void | Promise<void>;
  searchKeys?: SearchToolKeys;
  controller: ReadableStreamDefaultController<UIMessageChunk>;
}): Promise<void> {
  return (async () => {
    let activeResearchFolder = researchFolder;

    try {
      const tools = await createTools({
        model,
        getResearchFolder: async () => {
          if (activeResearchFolder) return activeResearchFolder;
          throw new Error("Research folder is not initialized.");
        },
        switchResearchFolder: async (folderName) => {
          activeResearchFolder = SafePathSegmentSchema.parse(folderName);
          await onResearchFolderChange?.(activeResearchFolder);
        },
        embeddingConfig,
        rerankerConfig,
        searchKeys,
      });

      const skillsData = await skillsStore.get();
      const effectiveSystemPrompt = buildSystemPrompt(skillsData.skills);

      await runGuardedLoop({
        model,
        messages,
        abortSignal,
        tools,
        systemPrompt: effectiveSystemPrompt,
        isHiddenText: isSubAgentOutputTextPart,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        evaluateStep: (({
          messages: stepMessages,
          responseMessage,
        }: {
          messages: UIMessage[];
          responseMessage: UIMessage;
        }) =>
          evaluateAssistantStep({
            messages: stepMessages,
            responseMessage,
            targetCurrency: searchKeys?.currency,
          })) as any,
        maxGuardRetries: {
          currency_conversion: 1,
        },
        controller,
      });
    } catch (error) {
      if (abortSignal?.aborted) {
        return;
      }
      throw error;
    }
  })();
}

function buildSystemPrompt(
  skills?: { slug: string; whenToUse: string }[],
): string {
  let prompt = systemPrompt;

  if (skills && skills.length > 0) {
    const skillList = skills
      .map((s) => `- ${s.slug}: ${s.whenToUse}`)
      .join("\n");
    prompt += `\n\n## Available skills\n\nLoad a skill with the \`load_skill\` tool when the user's request matches its description.\n\n${skillList}`;
  }

  return prompt;
}
