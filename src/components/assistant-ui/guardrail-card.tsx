import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
} from "lucide-react";
import {
  guardrailEventSchema,
  type GuardrailEvent,
} from "@/lib/agent-guards";
import { Box } from "@mantine/core";

export function GuardrailCard({ event }: { event: unknown }) {
  const parsed = guardrailEventSchema.safeParse(event);
  if (!parsed.success) return null;
  return <GuardrailCardContent event={parsed.data} />;
}

function GuardrailCardContent({ event }: { event: GuardrailEvent }) {
  const warning = event.status === "warning";
  const passed = event.status === "passed";
  const Icon = warning
    ? AlertTriangleIcon
    : passed
      ? CheckCircleIcon
      : ShieldCheckIcon;

  const colorStyles: React.CSSProperties = warning
    ? { borderColor: "var(--mantine-color-yellow-3)", backgroundColor: "var(--mantine-color-yellow-0)", color: "var(--mantine-color-yellow-text)" }
    : passed
      ? { borderColor: "var(--mantine-color-green-3)", backgroundColor: "var(--mantine-color-green-0)", color: "var(--mantine-color-green-text)" }
      : { borderColor: "var(--mantine-color-blue-3)", backgroundColor: "var(--mantine-color-blue-0)", color: "var(--mantine-color-blue-text)" };

  return (
    <Box
      my="sm"
      className="md-card-sm"
      style={{ maxWidth: 576, ...colorStyles }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <Icon style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500 }}>{event.title}</div>
          <div style={{ marginTop: 2, fontSize: 12, opacity: 0.8 }}>
            {event.message}
            {event.attempt ? ` Attempt ${event.attempt}.` : ""}
          </div>
        </div>
      </div>
    </Box>
  );
}
