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
import { SOCIAL_SOURCE_EXECUTION_GUIDANCE } from "@/lib/research-source-guidance";
import type { SubAgentEmitter } from "@/lib/sub-agent-emitter";

const INTERNAL_GUARDRAIL_RETRY_GUIDANCE = [
  "## Internal guardrail retries",
  "",
  "Messages beginning with `Internal guardrail retry` are app-generated repair instructions, not user requests.",
  "Follow the repair instruction while continuing the latest real user request.",
  "For `research_checkpoint`, set `originalQuestion` to the latest real user request, not to the retry instruction. If the real request itself contains the same words, preserve them.",
].join("\n");

export function createGuardedStream({
  model,
  researchFolder,
  researchChatId,
  messages,
  abortSignal,
  onResearchFolderChange,
  searchKeys,
  emitEvent,
  controller,
}: {
  model: LanguageModel;
  researchFolder: string | null;
  researchChatId?: string | null;
  messages: UIMessage[];
  abortSignal: AbortSignal | undefined;
  onResearchFolderChange?: (folderName: string) => void | Promise<void>;
  searchKeys?: SearchToolKeys;
  emitEvent?: SubAgentEmitter;
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
        getResearchChatId: async () => researchChatId ?? null,
        switchResearchFolder: async (folderName) => {
          activeResearchFolder = SafePathSegmentSchema.parse(folderName);
          await onResearchFolderChange?.(activeResearchFolder);
        },
        searchKeys,
        emitEvent,
      });

      const repair = repairInterruptedToolCallMessages(messages);
      const effectiveMessages = repair.repaired ? repair.messages : messages;
      const skillsData = await skillsStore.get();
      const effectiveSystemPrompt = buildSystemPrompt(
        skillsData.skills,
        buildCurrentRequestSourceGuidance(effectiveMessages, searchKeys),
      );
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

export function buildSystemPrompt(
  skills?: { slug: string; whenToUse: string }[],
  currentRequestSourceGuidance?: string,
): string {
  let prompt = `${DEFAULT_SYSTEM_PROMPT}\n\n${INTERNAL_GUARDRAIL_RETRY_GUIDANCE}\n\n${SOCIAL_SOURCE_EXECUTION_GUIDANCE}`;

  if (currentRequestSourceGuidance) {
    prompt += `\n\n${currentRequestSourceGuidance}`;
  }

  if (skills && skills.length > 0) {
    const skillList = skills
      .map((s) => `- ${s.slug}: ${s.whenToUse}`)
      .join("\n");
    prompt += `\n\n## Available skills\n\nLoad a skill with the \`load_skill\` tool when the user's request matches its description.\n\n${skillList}`;
  }

  return prompt;
}

export function buildCurrentRequestSourceGuidance(
  messages: UIMessage[],
  searchKeys?: SearchToolKeys,
): string {
  const latestUserText = [...messages]
    .reverse()
    .find((message) => message.role === "user")
    ?.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n")
    .toLowerCase();

  if (!latestUserText) return "";

  const requirements: string[] = [];
  if (/\b(reddit|subreddit|subreddits|r\/[a-z0-9_]+)\b/i.test(latestUserText)) {
    requirements.push(
      "The latest user request explicitly asks for Reddit/community evidence. Run at least one web search containing site:reddit.com or site:old.reddit.com before relying on sources.",
    );
  }

  if (/\b(youtube|youtube\.com|youtu\.be|\byt\b)\b/i.test(latestUserText)) {
    requirements.push(
      searchKeys?.youtubeApiKey
        ? "The latest user request explicitly asks for YouTube/video evidence. Call youtube_search, then call extract_page_content on selected YouTube video URLs to read transcripts before relying on them."
        : "The latest user request explicitly asks for YouTube/video evidence, but youtube_search is not configured. Use a regular web search with site:youtube.com/watch or site:youtu.be, then call extract_page_content on selected YouTube video URLs to read transcripts before relying on them.",
    );
  }

  if (requirements.length === 0) return "";

  return [
    "## Current request source requirements",
    "",
    ...requirements.map((requirement) => `- ${requirement}`),
  ].join("\n");
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
