import { InfoIcon } from "lucide-react";
import {
  agentDiagnosticEventSchema,
  type AgentDiagnosticEvent,
} from "@/lib/agent-diagnostics";
import { Box } from "@mantine/core";

export function AgentDiagnosticCard({ event }: { event: unknown }) {
  const parsed = agentDiagnosticEventSchema.safeParse(event);
  if (!parsed.success) return null;
  return <AgentDiagnosticCardContent event={parsed.data} />;
}

function AgentDiagnosticCardContent({
  event,
}: {
  event: AgentDiagnosticEvent;
}) {
  return (
    <Box
      my="sm"
      className="md-surface"
      style={{
        maxWidth: 576,
        borderRadius: 8,
        border: "1px solid",
        padding: "8px 12px",
        fontSize: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <InfoIcon style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500 }}>{event.title}</div>
          <div style={{ marginTop: 2, fontSize: 12, opacity: 0.8 }}>{event.message}</div>
          {event.reason && (
            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>{event.reason}</div>
          )}
        </div>
      </div>
    </Box>
  );
}
