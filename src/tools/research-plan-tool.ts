import { streamText, tool, zodSchema, type LanguageModel } from "ai";
import { z } from "zod";
import { createSubAgentId } from "@/lib/sub-agent-types";
import { emitSubAgentEvent } from "@/lib/sub-agent-emitter";
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

      emitSubAgentEvent({
        type: "start",
        id: saId,
        source: "sub-agent",
        name: "Research Plan",
        toolName: "create_research_plan",
        parentMessageId: "tool",
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
        if (options?.abortSignal?.aborted) {
          emitSubAgentEvent({ type: "error", id: saId, error: "Cancelled" });
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
