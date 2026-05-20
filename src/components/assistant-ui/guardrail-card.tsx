import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
} from "lucide-react";
import {
  guardrailEventSchema,
  type GuardrailEvent,
} from "@/lib/agent-guards";
import { cn } from "@/lib/utils";

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

  return (
    <div
      className={cn(
        "my-2 max-w-xl rounded-lg border px-3 py-2 text-sm",
        warning
          ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
          : passed
            ? "border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950/30 dark:text-green-200"
            : "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200",
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <div className="font-medium">{event.title}</div>
          <div className="mt-0.5 text-xs opacity-80">
            {event.message}
            {event.attempt ? ` Attempt ${event.attempt}.` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}
