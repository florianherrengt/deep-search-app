import { formatTokenCount } from "@/lib/context-window";
import type { ModelOption } from "@/components/assistant-ui/model-selector";

export function ContextWindowBadge({
  model,
  tokenCount,
}: {
  model: ModelOption | undefined;
  tokenCount: number;
}) {
  const contextWindowLabel = formatTokenCount(model?.contextWindowTokens);
  const usedLabel = formatTokenCount(tokenCount);

  const displayText =
    usedLabel && contextWindowLabel
      ? `${usedLabel} / ${contextWindowLabel}`
      : usedLabel
        ? usedLabel
        : contextWindowLabel
          ? contextWindowLabel
          : "unknown";

  return (
    <span
      data-testid="context-window-badge"
      style={{
        flexShrink: 0,
        borderRadius: 6,
        border: "1px solid var(--mantine-color-default-border)",
        padding: "4px 8px",
        fontSize: 12,
        color: "var(--mantine-color-dimmed)",
        whiteSpace: "nowrap",
      }}
      title={
        contextWindowLabel
          ? `${contextWindowLabel} token context window`
          : "Context window size unavailable"
      }
    >
      Context: {displayText}
    </span>
  );
}
