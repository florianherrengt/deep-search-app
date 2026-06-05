import { z } from "zod";

export const agentDiagnosticEventSchema = z.object({
  kind: z.enum(["empty_response"]),
  status: z.enum(["info", "warning"]),
  title: z.string(),
  message: z.string(),
  reason: z.string().optional(),
  finishReason: z.string().optional(),
  toolCallCount: z.number().optional(),
});

export type AgentDiagnosticEvent = z.infer<typeof agentDiagnosticEventSchema>;
