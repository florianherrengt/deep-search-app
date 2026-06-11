import type {
  ProviderMetadata,
} from "ai";
import type { UIMessage } from "ai";

const SUB_AGENT_METADATA_PROVIDER = "deep-search";

export const SUB_AGENT_TEXT_PROVIDER_METADATA = {
  [SUB_AGENT_METADATA_PROVIDER]: { subAgentOutput: true },
} satisfies ProviderMetadata;

export function isSubAgentOutputTextPart(
  part: UIMessage["parts"][number],
): boolean {
  if (part.type !== "text" || !("providerMetadata" in part)) return false;

  const providerMetadata = part.providerMetadata;
  if (!providerMetadata || typeof providerMetadata !== "object") return false;

  const metadata = providerMetadata[SUB_AGENT_METADATA_PROVIDER];
  return (
    metadata !== null &&
    typeof metadata === "object" &&
    "subAgentOutput" in metadata &&
    metadata.subAgentOutput === true
  );
}
