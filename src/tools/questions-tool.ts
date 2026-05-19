import { tool, zodSchema } from "ai";
import { z } from "zod";

const candidateSchema = z.object({
  label: z.string().describe("Display text shown to the user"),
  value: z.string().describe("Machine-readable value returned when selected"),
});

const questionSchema = z.object({
  question: z.string().describe("Question to ask the user"),
  candidates: candidateSchema
    .array()
    .describe("List of candidate answers to the question"),
});

export const questionsTool = tool({
  description: `Present questions with candidate answers to the user.`,
  inputSchema: zodSchema(
    z.object({
      questions: questionSchema
        .array()
        .describe("Array of questions with their candidate answers"),
    }),
  ),
  execute: async () =>
    "Questions asked. Wait for the user to reply. Stop here and say nothing else.",
});
