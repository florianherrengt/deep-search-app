import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ResearchSidebar } from "@/components/research-sidebar";

describe("ResearchSidebar", () => {
  it("renders new chat and previous search folders", () => {
    const html = renderToStaticMarkup(
      <ResearchSidebar
        folders={[{ name: "acme-market-map" }, { name: "pricing-review" }]}
        activeFolderName="pricing-review"
        chats={[
          {
            id: "2026-05-22T10-00-00.000Z",
            title: "Pricing options",
            createdAt: "2026-05-22T10:00:00.000Z",
            updatedAt: "2026-05-22T10:30:00.000Z",
            messageCount: 4,
          },
        ]}
        activeChatId="2026-05-22T10-00-00.000Z"
        apiKey="test-key"
        status="ready"
        chatsStatus="ready"
        onNewChat={vi.fn()}
        onSelectFolder={vi.fn()}
        onNewResearchChat={vi.fn()}
        onSelectChat={vi.fn()}
        onRenameFolder={vi.fn()}
        onDeleteFolder={vi.fn()}
      />,
    );

    expect(html).toContain("New Chat");
    expect(html).toContain("Previous Searches");
    expect(html).toContain("acme-market-map");
    expect(html).toContain("pricing-review");
    expect(html).toContain("Previous Chats");
    expect(html).toContain("Pricing options");
    expect(html).toContain('aria-label="Rename acme-market-map"');
    expect(html).toContain('aria-label="Delete pricing-review"');
    expect(html).toContain('aria-current="page"');
  });

  it("renders an empty state", () => {
    const html = renderToStaticMarkup(
      <ResearchSidebar
        folders={[]}
        activeFolderName={null}
        chats={[]}
        activeChatId={null}
        apiKey="test-key"
        status="ready"
        chatsStatus="idle"
        onNewChat={vi.fn()}
        onSelectFolder={vi.fn()}
        onNewResearchChat={vi.fn()}
        onSelectChat={vi.fn()}
        onRenameFolder={vi.fn()}
        onDeleteFolder={vi.fn()}
      />,
    );

    expect(html).toContain("No searches yet");
  });
});
