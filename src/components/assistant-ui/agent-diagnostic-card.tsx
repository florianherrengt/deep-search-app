import { InfoIcon } from "lucide-react";
import {
  agentDiagnosticEventSchema,
  type AgentDiagnosticEvent,
} from "@/lib/agent-diagnostics";
import { cn } from "@/lib/utils";

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
    <div
      className={cn(
        "my-2 max-w-xl rounded-lg border px-3 py-2 text-sm",
        "border-zinc-200 bg-zinc-50 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200",
      )}
    >
      <div className="flex items-start gap-2">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <div className="font-medium">{event.title}</div>
          <div className="mt-0.5 text-xs opacity-80">{event.message}</div>
          {event.reason && (
            <div className="mt-1 text-xs opacity-70">{event.reason}</div>
          )}
        </div>
      </div>
    </div>
  );
}
