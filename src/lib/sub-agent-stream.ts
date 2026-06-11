import type {
  ProviderMetadata,
  TextStreamPart,
  ToolSet,
  UIMessage,
  UIMessageStreamWriter,
} from "ai";
import type { SubAgentEvent } from "./sub-agent-types";

const SUB_AGENT_METADATA_PROVIDER = "deep-search";

export const SUB_AGENT_TEXT_PROVIDER_METADATA = {
  [SUB_AGENT_METADATA_PROVIDER]: { subAgentOutput: true },
} satisfies ProviderMetadata;

export interface SubAgentStreamContext {
  subAgentStream: {
    writer: UIMessageStreamWriter<UIMessage>;
  };
  emitSubAgentEvent?: (event: SubAgentEvent) => void;
}

let nextSubAgentTextId = 0;

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

export async function collectSubAgentTextStream<TOOLS extends ToolSet>({
  stream,
  context,
  subAgentId,
}: {
  stream: AsyncIterable<TextStreamPart<TOOLS>>;
  context?: unknown;
  subAgentId?: string;
}): Promise<string> {
  const writer = getSubAgentStreamWriter(context);
  const emitter = getSubAgentEventEmitter(context);
  const textId = `sub-agent-${Date.now()}-${nextSubAgentTextId++}`;
  let text = "";
  let textStarted = false;

  const startText = () => {
    if (!writer || textStarted) return;
    writer.write({
      type: "text-start",
      id: textId,
      providerMetadata: SUB_AGENT_TEXT_PROVIDER_METADATA,
    });
    textStarted = true;
  };

  try {
    for await (const part of stream) {
      if (part.type === "error") {
        throw normalizeStreamError(part.error);
      }

      if (part.type !== "text-delta" || !part.text) continue;

      text += part.text;

      if (subAgentId && emitter) {
        emitter({ type: "text-delta", id: subAgentId, delta: part.text });
      }

      if (!writer) continue;

      startText();
      writer.write({
        type: "text-delta",
        id: textId,
        delta: part.text,
        providerMetadata: SUB_AGENT_TEXT_PROVIDER_METADATA,
      });
    }
  } finally {
    if (writer && textStarted) {
      writer.write({
        type: "text-end",
        id: textId,
        providerMetadata: SUB_AGENT_TEXT_PROVIDER_METADATA,
      });
    }
  }

  return text;
}

function getSubAgentStreamWriter(
  context: unknown,
): UIMessageStreamWriter<UIMessage> | null {
  if (!context || typeof context !== "object") return null;

  const subAgentStream = (context as Partial<SubAgentStreamContext>)
    .subAgentStream;
  const writer = subAgentStream?.writer;
  return writer && typeof writer.write === "function" ? writer : null;
}

export function getSubAgentEventEmitter(
  context: unknown,
): ((event: SubAgentEvent) => void) | null {
  if (!context || typeof context !== "object") return null;
  const ctx = context as Partial<SubAgentStreamContext>;
  return typeof ctx.emitSubAgentEvent === "function"
    ? ctx.emitSubAgentEvent
    : null;
}

function normalizeStreamError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(
    typeof error === "string" ? error : "Sub-agent stream failed.",
  );
}
