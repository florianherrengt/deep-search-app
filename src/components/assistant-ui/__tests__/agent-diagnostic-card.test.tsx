import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MantineProvider } from "@mantine/core";
import { AgentDiagnosticCard } from "@/components/assistant-ui/agent-diagnostic-card";

function wrap(node: React.ReactNode) {
  return <MantineProvider>{node}</MantineProvider>;
}

describe("AgentDiagnosticCard", () => {
  it("renders no-reply diagnostics with the finish reason", () => {
    const html = renderToStaticMarkup(
      wrap(
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
      ),
    );

    expect(html).toContain("No assistant reply");
    expect(html).toContain("without returning visible answer text");
    expect(html).toContain("Finish reason: stop");
  });

  it("renders info status diagnostics", () => {
    const html = renderToStaticMarkup(
      wrap(
        <AgentDiagnosticCard
          event={{
            kind: "empty_response",
            status: "info",
            title: "Context window full",
            message: "The context window was nearly exhausted, so the pause tool was called automatically.",
          }}
        />,
      ),
    );

    expect(html).toContain("Context window full");
    expect(html).toContain("context window was nearly exhausted");
  });

  it("does not render a reason div when reason is undefined", () => {
    const html = renderToStaticMarkup(
      wrap(
        <AgentDiagnosticCard
          event={{
            kind: "empty_response",
            status: "warning",
            title: "No assistant reply",
            message: "The provider ended the turn without returning visible answer text.",
            finishReason: "stop",
          }}
        />,
      ),
    );

    expect(html).toContain("No assistant reply");
    expect(html).not.toMatch(/<div[^>]*>.*reason.*<\/div>/i);
  });

  it("renders event with toolCallCount", () => {
    const html = renderToStaticMarkup(
      wrap(
        <AgentDiagnosticCard
          event={{
            kind: "empty_response",
            status: "warning",
            title: "No assistant reply after tool calls",
            message: "The provider ended the turn after 3 tool calls without returning visible answer text.",
            finishReason: "stop",
            toolCallCount: 3,
          }}
        />,
      ),
    );

    expect(html).toContain("No assistant reply after tool calls");
    expect(html).toContain("after 3 tool calls");
  });

  it("renders nothing for invalid diagnostics", () => {
    const html = renderToStaticMarkup(
      wrap(<AgentDiagnosticCard event={{ title: "No assistant reply" }} />),
    );

    expect(html).not.toContain("No assistant reply");
  });
});
