import { z } from "zod";

export const agentDiagnosticEventSchema = z.object({
  kind: z.enum(["empty_response", "interrupted_tool_repair"]),
  status: z.enum(["info", "warning"]),
  title: z.string(),
  message: z.string(),
  reason: z.string().optional(),
  finishReason: z.string().optional(),
  toolCallCount: z.number().optional(),
  droppedMessageCount: z.number().optional(),
  toolCallIds: z.array(z.string()).optional(),
});

export type AgentDiagnosticEvent = z.infer<typeof agentDiagnosticEventSchema>;
