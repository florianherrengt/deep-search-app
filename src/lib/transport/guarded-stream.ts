import type {
  LanguageModel,
  ToolChoice,
  ToolSet,
  UIMessage,
  UIMessageChunk,
} from "ai";
import type { SharedV3ProviderOptions } from "@ai-sdk/provider";
import {
  createGuardedStream as createCoreGuardedStream,
  DEFAULT_SYSTEM_PROMPT,
  type EvaluateStepFn,
  type ProviderOptionsCallback,
} from "deep-search-core/research-orchestrator";
import { SafePathSegmentSchema } from "@/lib/app-file-storage";
import { isSubAgentOutputTextPart } from "@/lib/sub-agent-stream";
import { evaluateAssistantStep } from "@/lib/agent-guards";
import { createTools, type SearchToolKeys } from "./tool-registry";
import { skillsStore } from "@/lib/skills-store";
import type { AgentDiagnosticEvent } from "@/lib/agent-diagnostics";
import {
  createInterruptedToolRepairDiagnostic,
  logInterruptedToolCallRepair,
  repairInterruptedToolCallMessages,
} from "@/lib/tool-call-repair";

export function createGuardedStream({
  model,
  researchFolder,
  messages,
  abortSignal,
  onResearchFolderChange,
  searchKeys,
  controller,
}: {
  model: LanguageModel;
  researchFolder: string | null;
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
        searchKeys,
      });

      const skillsData = await skillsStore.get();
      const effectiveSystemPrompt = buildSystemPrompt(skillsData.skills);
      const repair = repairInterruptedToolCallMessages(messages);
      const effectiveMessages = repair.repaired ? repair.messages : messages;
      if (repair.repaired) {
        logInterruptedToolCallRepair("guarded-stream-before-convert", repair);
        writeAgentDiagnosticEvent(
          controller,
          createInterruptedToolRepairDiagnostic(repair),
        );
      }

      await createCoreGuardedStream({
        model,
        messages: effectiveMessages,
        abortSignal,
        tools,
        systemPrompt: effectiveSystemPrompt,
        isHiddenText: isSubAgentOutputTextPart,
        getProviderOptions,
        evaluateStep: createAppEvaluateStep(searchKeys),
        maxGuardRetries: {
          currency_conversion: 1,
        },
        onError: (error: unknown) =>
          error instanceof Error ? error.message : String(error),
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
  let prompt = DEFAULT_SYSTEM_PROMPT;

  if (skills && skills.length > 0) {
    const skillList = skills
      .map((s) => `- ${s.slug}: ${s.whenToUse}`)
      .join("\n");
    prompt += `\n\n## Available skills\n\nLoad a skill with the \`load_skill\` tool when the user's request matches its description.\n\n${skillList}`;
  }

  return prompt;
}

function createAppEvaluateStep(
  searchKeys: SearchToolKeys | undefined,
): EvaluateStepFn {
  return (({ messages, responseMessage }) =>
    evaluateAssistantStep({
      messages,
      responseMessage,
      targetCurrency: searchKeys?.currency,
    })) as EvaluateStepFn;
}

const getProviderOptions: ProviderOptionsCallback = ({
  model: streamModel,
  toolChoice,
}: {
  model: LanguageModel;
  toolChoice: ToolChoice<ToolSet> | undefined;
}) => {
  if (!toolChoice || toolChoice === "auto") return undefined;

  const info = streamModel as {
    provider?: string;
    modelId?: string;
  };
  const isDeepSeek =
    (typeof info.provider === "string" &&
      info.provider.startsWith("deepseek")) ||
    (typeof info.modelId === "string" &&
      info.modelId.toLowerCase().includes("deepseek"));

  if (isDeepSeek) {
    return {
      deepseek: { thinking: { type: "disabled" } },
    } as SharedV3ProviderOptions;
  }
  return undefined;
};

function writeAgentDiagnosticEvent(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  event: AgentDiagnosticEvent,
) {
  controller.enqueue({
    type: "data-agent_diagnostic",
    id: `agent-diagnostic-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    data: event,
  });
}
