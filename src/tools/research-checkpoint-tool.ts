import { generateObject, tool, zodSchema, type LanguageModel } from "ai";
import {
  researchCheckpointInputSchema,
  researchCheckpointResultSchema,
  reviewResearchCheckpoint,
  type ResearchCheckpointInput,
  type ResearchCheckpointResult,
} from "@/lib/agent-guards";

export function createResearchCheckpointTool(model: LanguageModel) {
  return tool({
    description:
      "Submit a research quality checkpoint before finalizing a researched answer. Include searches run, opened sources, verified claims, unresolved questions, confidence, and readiness.",
    strict: true,
    inputSchema: zodSchema(researchCheckpointInputSchema),
    outputSchema: zodSchema(researchCheckpointResultSchema),
    execute: async (input) => {
      return reviewResearchCheckpoint(input, (checkpoint) =>
        judgeResearchCheckpoint(model, checkpoint),
      );
    },
  });
}

async function judgeResearchCheckpoint(
  model: LanguageModel,
  checkpoint: ResearchCheckpointInput,
): Promise<ResearchCheckpointResult> {
  const { object } = await generateObject({
    model,
    schema: zodSchema(researchCheckpointResultSchema),
    system:
      "You review whether an agent has done enough research to answer. Be strict about direct relevance, source support, recency when relevant, and unresolved gaps. Return JSON only.",
    prompt: `Review this research checkpoint.\n\n${JSON.stringify(
      checkpoint,
      null,
      2,
    )}`,
  });

  return researchCheckpointResultSchema.parse(object);
}
