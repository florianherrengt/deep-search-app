import type { ComponentProps } from "react";
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
    expect(html).toContain('data-slot="context-menu-trigger"');
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

  it("keeps existing folders visible while refreshes are loading", () => {
    const html = renderSidebar({
      folders: [{ name: "pricing-review" }],
      activeFolderName: "pricing-review",
      status: "loading",
    });

    expect(html).toContain("pricing-review");
    expect(html).not.toContain("Loading...");
  });

  it("keeps existing folders visible after background refresh errors", () => {
    const html = renderSidebar({
      folders: [{ name: "pricing-review" }],
      activeFolderName: "pricing-review",
      status: "error",
    });

    expect(html).toContain("pricing-review");
    expect(html).not.toContain("Could not load searches.");
  });

  it("renders empty loading, error, and ready states", () => {
    expect(renderSidebar({ status: "loading" })).toContain("Loading...");
    expect(renderSidebar({ status: "error" })).toContain(
      "Could not load searches.",
    );
    expect(renderSidebar({ status: "ready" })).toContain("No searches yet");
  });

  it("renders running indicators and disables folder actions for active runs", () => {
    const html = renderToStaticMarkup(
      <ResearchSidebar
        folders={[{ name: "pricing-review" }]}
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
        runningFolderNames={["pricing-review"]}
        runningChatIds={["2026-05-22T10-00-00.000Z"]}
        onNewChat={vi.fn()}
        onSelectFolder={vi.fn()}
        onNewResearchChat={vi.fn()}
        onSelectChat={vi.fn()}
        onRenameFolder={vi.fn()}
        onDeleteFolder={vi.fn()}
      />,
    );

    expect(html).toContain("Research running in pricing-review");
    expect(html).toContain("Research running in Pricing options");
    expect(html).toContain('data-slot="context-menu-trigger"');
  });
});

type ResearchSidebarProps = ComponentProps<typeof ResearchSidebar>;

function renderSidebar(props: Partial<ResearchSidebarProps> = {}) {
  return renderToStaticMarkup(
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
      {...props}
    />,
  );
}
