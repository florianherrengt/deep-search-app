import { streamText, type LanguageModel } from "ai";
import {
  createFactsCheckTool as createCoreFactsCheckTool,
  createResearchPlanTool as createCoreResearchPlanTool,
  RESEARCH_PLANNER_PROMPT,
} from "deep-search-core/research-orchestrator";
import { z } from "zod";
import { isAbortError } from "@/lib/abort";
import { emitSubAgentEvent } from "@/lib/sub-agent-emitter";
import { createSubAgentId } from "@/lib/sub-agent-types";
import { fetch as bridgeFetch } from "@/lib/tauri-bridge";
import { SOCIAL_SOURCE_PLANNING_GUIDANCE } from "@/lib/research-source-guidance";
import { createExtractionPageLoader } from "@/tools/extract-page-content-tool";

export const researchPlanInputSchema = z.object({
  query: z.string().min(1).describe("The user's research question or request"),
});

export const factsCheckInputSchema = z.object({
  originalPrompt: z
    .string()
    .min(1)
    .describe(
      "The original research objective, including the user's questions and clarifications.",
    ),
  finalResearch: z
    .string()
    .min(1)
    .describe(
      "The final research answer/report to fact-check. Must include the source URLs cited in the text.",
    ),
});

export const RESEARCH_PLANNER_SYSTEM = `${RESEARCH_PLANNER_PROMPT}\n\n${SOCIAL_SOURCE_PLANNING_GUIDANCE}`;

type CoreResearchPlanTool = ReturnType<typeof createCoreResearchPlanTool>;

function getToolCallId(options: unknown): string | undefined {
  if (!options || typeof options !== "object") return undefined;
  const toolCallId = (options as { toolCallId?: unknown }).toolCallId;
  return typeof toolCallId === "string" ? toolCallId : undefined;
}

function isAbortSignalAborted(options: unknown): boolean {
  if (!options || typeof options !== "object") return false;
  const abortSignal = (options as { abortSignal?: unknown }).abortSignal;
  return abortSignal instanceof AbortSignal && abortSignal.aborted;
}

export function createResearchPlanTool(model: LanguageModel): CoreResearchPlanTool {
  const coreTool = createCoreResearchPlanTool(model);
  const execute = coreTool.execute;

  if (!execute) return coreTool;

  return {
    ...coreTool,
    execute: async (input, options): Promise<string> => {
      const saId = createSubAgentId();
      const toolCallId = getToolCallId(options);

      emitSubAgentEvent({
        type: "start",
        id: saId,
        source: "sub-agent",
        name: "Research Plan",
        toolName: "create_research_plan",
        parentMessageId: "tool",
        displayTarget: toolCallId
          ? { type: "toolCall", toolCallId }
          : { type: "sidebar" },
      });

      try {
        const result = streamText({
          model,
          system: RESEARCH_PLANNER_SYSTEM,
          prompt: input.query,
          abortSignal: options?.abortSignal,
        });

        for await (const textPart of result.textStream) {
          emitSubAgentEvent({ type: "text-delta", id: saId, delta: textPart });
        }

        const text = await result.text;

        if (!text || !text.trim()) {
          emitSubAgentEvent({
            type: "error",
            id: saId,
            error: "Research plan was empty. The model returned no content.",
          });
          return "Error: Research plan was empty. Please try again with a more specific query.";
        } else {
          emitSubAgentEvent({ type: "complete", id: saId });
        }

        return text;
      } catch (error) {
        if (isAbortError(error) || isAbortSignalAborted(options)) {
          emitSubAgentEvent({ type: "cancelled", id: saId });
        } else {
          emitSubAgentEvent({
            type: "error",
            id: saId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
    },
  };
}

export function createFactsCheckTool(
  model: LanguageModel,
  scrapeDoApiKey?: string | null,
) {
  return createCoreFactsCheckTool(model, {
    fetchFn: bridgeFetch,
    pageLoader: createExtractionPageLoader({ scrapeDoApiKey }),
  });
}
