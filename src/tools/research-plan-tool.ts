import { streamText, tool, zodSchema, type LanguageModel } from "ai";
import { z } from "zod";
import { createSubAgentId } from "@/lib/sub-agent-types";
import { emitSubAgentEvent } from "@/lib/sub-agent-emitter";
import { isAbortError } from "@/lib/abort";
import RESEARCH_PLANNER_SYSTEM from "./research-planner-prompt.md?raw";

export const researchPlanInputSchema = z.object({
  query: z.string().min(1).describe("The user's research question or request"),
});

export { RESEARCH_PLANNER_SYSTEM };

export function createResearchPlanTool(model: LanguageModel) {
  return tool({
    description:
      "Call this after asking clarifying questions to create a research plan.",
    strict: true,
    inputSchema: zodSchema(researchPlanInputSchema),
    execute: async ({ query }, options) => {
      const saId = createSubAgentId();
      const toolCallId = options?.toolCallId;

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
          prompt: query,
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
            error: "Research plan was empty — the model returned no content.",
          });
          return "Error: Research plan was empty. Please try again with a more specific query.";
        }

        emitSubAgentEvent({ type: "complete", id: saId });

        return text;
      } catch (error) {
        // Emit a proper "cancelled" event on user abort so the sub-agent UI
        // shows a cancelled state instead of a red error.
        if (isAbortError(error) || options?.abortSignal?.aborted) {
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
  });
}
