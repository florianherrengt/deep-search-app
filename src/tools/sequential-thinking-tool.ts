import { z } from "zod";
export { createSequentialThinkingTool } from "deep-search-core/research-orchestrator";

export const sequentialThinkingInputSchema = z.object({
  thought: z.string().describe("Your current thinking step"),
});
