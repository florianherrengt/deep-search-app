import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentDiagnosticCard } from "@/components/assistant-ui/agent-diagnostic-card";

describe("AgentDiagnosticCard", () => {
  it("renders no-reply diagnostics with the finish reason", () => {
    const html = renderToStaticMarkup(
      <AgentDiagnosticCard
        event={{
          kind: "empty_response",
          status: "warning",
          title: "No assistant reply",
          message:
            "The provider ended the turn without returning visible answer text.",
          reason: "Finish reason: stop.",
          finishReason: "stop",
        }}
      />,
    );

    expect(html).toContain("No assistant reply");
    expect(html).toContain("without returning visible answer text");
    expect(html).toContain("Finish reason: stop");
  });

  it("renders nothing for invalid diagnostics", () => {
    const html = renderToStaticMarkup(
      <AgentDiagnosticCard event={{ title: "No assistant reply" }} />,
    );

    expect(html).toBe("");
  });
});
