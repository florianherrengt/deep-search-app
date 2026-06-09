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
  const tone = warning ? "warning" : passed ? "success" : "info";
  const Icon = warning
    ? AlertTriangleIcon
    : passed
      ? CheckCircleIcon
      : ShieldCheckIcon;

  return (
    <Box
      my="sm"
      className="md-card-sm md-guardrail-card"
      data-tone={tone}
      style={{ maxWidth: 576 }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <Icon
          className="md-guardrail-card__icon"
          style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0 }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500 }}>{event.title}</div>
          <div
            className="md-guardrail-card__message"
            style={{ marginTop: 2, fontSize: 12 }}
          >
            {event.message}
            {event.attempt ? ` Attempt ${event.attempt}.` : ""}
          </div>
        </div>
      </div>
    </Box>
  );
}
