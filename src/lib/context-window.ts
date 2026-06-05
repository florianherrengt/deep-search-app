export function formatTokenCount(tokens: number | undefined): string | undefined {
  if (!tokens || !Number.isFinite(tokens) || tokens <= 0) return undefined;

  if (tokens >= 1_000_000) {
    return `${formatCompactNumber(tokens / 1_000_000)}M`;
  }

  if (tokens >= 1_000) {
    return `${formatCompactNumber(tokens / 1_000)}K`;
  }

  return String(Math.round(tokens));
}

export function formatContextWindowTokens(
  tokens: number | undefined,
): string | undefined {
  const count = formatTokenCount(tokens);
  return count ? `${count} context` : undefined;
}

function formatCompactNumber(value: number) {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(1).replace(/\.0$/, "");
}
