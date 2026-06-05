import { generateText, tool, zodSchema, type LanguageModel } from "ai";
import { z } from "zod";
import RESEARCH_PLANNER_SYSTEM from "./research-planner-prompt.md?raw";

export const researchPlanInputSchema = z.object({
  query: z.string().min(1).describe("The user's research question or request"),
});

export type ResearchPlanInput = z.infer<typeof researchPlanInputSchema>;

export { RESEARCH_PLANNER_SYSTEM };

export function createResearchPlanTool(model: LanguageModel) {
  return tool({
    description:
      "Call this after asking clarifying questions to create a research plan.",
    strict: true,
    inputSchema: zodSchema(researchPlanInputSchema),
    execute: async ({ query }, options) => {
      const { text } = await generateText({
        model,
        system: RESEARCH_PLANNER_SYSTEM,
        prompt: query,
        abortSignal: options?.abortSignal,
      });

      return text;
    },
  });
}
