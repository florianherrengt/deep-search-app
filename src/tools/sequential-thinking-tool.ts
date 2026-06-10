import { tool, zodSchema } from "ai";
import { z } from "zod";

export const sequentialThinkingInputSchema = z.object({
  thought: z.string().describe("Your current thinking step"),
});

export function createSequentialThinkingTool() {
  return tool({
    description:
      "A detailed tool for dynamic and reflective problem-solving through thoughts. " +
      "This tool helps analyze problems through a flexible thinking process that can adapt and evolve. " +
      "Each thought can build on, question, or revise previous insights as understanding deepens. " +
      "Use for: breaking down complex problems into steps, planning with room for revision, " +
      "analysis that might need course correction, problems where the full scope might not be clear initially.",
    strict: true,
    inputSchema: zodSchema(sequentialThinkingInputSchema),
    execute: async () => ({ status: "ok" }),
  });
}
