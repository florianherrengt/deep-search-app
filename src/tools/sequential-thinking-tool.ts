import { tool, zodSchema } from "ai";
import { z } from "zod";

interface ThoughtData {
  thought: string;
  thoughtNumber: number;
  totalThoughts: number;
  isRevision?: boolean;
  revisesThought?: number;
  branchFromThought?: number;
  branchId?: string;
  needsMoreThoughts?: boolean;
  nextThoughtNeeded: boolean;
}

export function createSequentialThinkingTool() {
  const thoughtHistory: ThoughtData[] = [];
  const branches: Record<string, ThoughtData[]> = {};

  return tool({
    description:
      "A detailed tool for dynamic and reflective problem-solving through thoughts. " +
      "This tool helps analyze problems through a flexible thinking process that can adapt and evolve. " +
      "Each thought can build on, question, or revise previous insights as understanding deepens. " +
      "Use for: breaking down complex problems into steps, planning with room for revision, " +
      "analysis that might need course correction, problems where the full scope might not be clear initially.",
    strict: true,
    inputSchema: zodSchema(
      z.object({
        thought: z.string().describe("Your current thinking step"),
        nextThoughtNeeded: z
          .boolean()
          .describe(
            "Whether another thought step is needed. True if you need more thinking, even if at what seemed like the end",
          ),
        thoughtNumber: z
          .number()
          .int()
          .min(1)
          .describe("Current thought number in sequence"),
        totalThoughts: z
          .number()
          .int()
          .min(1)
          .describe(
            "Estimated total thoughts needed. Can be adjusted up or down as you progress",
          ),
        isRevision: z
          .boolean()
          .optional()
          .describe("Whether this thought revises previous thinking"),
        revisesThought: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Which thought number is being reconsidered"),
        branchFromThought: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Thought number to branch from"),
        branchId: z
          .string()
          .optional()
          .describe("Identifier for the current branch"),
        needsMoreThoughts: z
          .boolean()
          .optional()
          .describe(
            "If reaching the end but realizing more thoughts are needed",
          ),
      }),
    ),
    outputSchema: zodSchema(
      z.object({
        thoughtNumber: z.number(),
        totalThoughts: z.number(),
        nextThoughtNeeded: z.boolean(),
        branches: z.array(z.string()),
        thoughtHistoryLength: z.number(),
      }),
    ),
    execute: async (input) => {
      const thoughtData: ThoughtData = {
        thought: input.thought,
        thoughtNumber: input.thoughtNumber,
        totalThoughts: input.totalThoughts,
        nextThoughtNeeded: input.nextThoughtNeeded,
        isRevision: input.isRevision,
        revisesThought: input.revisesThought,
        branchFromThought: input.branchFromThought,
        branchId: input.branchId,
        needsMoreThoughts: input.needsMoreThoughts,
      };

      if (thoughtData.thoughtNumber > thoughtData.totalThoughts) {
        thoughtData.totalThoughts = thoughtData.thoughtNumber;
      }

      thoughtHistory.push(thoughtData);

      if (thoughtData.branchFromThought && thoughtData.branchId) {
        if (!branches[thoughtData.branchId]) {
          branches[thoughtData.branchId] = [];
        }
        branches[thoughtData.branchId].push(thoughtData);
      }

      return {
        thoughtNumber: thoughtData.thoughtNumber,
        totalThoughts: thoughtData.totalThoughts,
        nextThoughtNeeded: thoughtData.nextThoughtNeeded,
        branches: Object.keys(branches),
        thoughtHistoryLength: thoughtHistory.length,
      };
    },
  });
}
