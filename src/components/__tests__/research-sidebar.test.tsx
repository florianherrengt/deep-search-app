import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { ResearchSidebar } from "@/components/research-sidebar";
import type { EmbeddingConfig, RerankerConfig } from "@/lib/research-search";

const mockEmbeddingConfig: EmbeddingConfig = { api_key: "test-key", base_url: "https://openrouter.ai/api/v1", model: "qwen/qwen3-embedding-4b", dimensions: 1024, query_prefix: "Represent this sentence for searching relevant passages: " };
const mockRerankerConfig: RerankerConfig = { api_key: "test-key", base_url: "https://openrouter.ai/api/v1", model: "cohere/rerank-4-pro" };

describe("ResearchSidebar", () => {
  it("renders new chat and previous search folders", () => {
    const html = renderSidebar({
      folders: [{ name: "acme-market-map" }, { name: "pricing-review" }],
      activeFolderName: "pricing-review",
      chats: [
        {
          id: "2026-05-22T10-00-00.000Z",
          title: "Pricing options",
          createdAt: "2026-05-22T10:00:00.000Z",
          updatedAt: "2026-05-22T10:30:00.000Z",
          messageCount: 4,
        },
      ],
      activeChatId: "2026-05-22T10-00-00.000Z",
      chatsStatus: "ready" as const,
    });

    expect(html).toContain("New Chat");
    expect(html).toContain("Previous Searches");
    expect(html).toContain("acme-market-map");
    expect(html).toContain("pricing-review");
    expect(html).toContain("Previous Chats");
    expect(html).toContain("Pricing options");
    expect(html).toContain('aria-current="page"');
  });

  it("renders an empty state", () => {
    const html = renderSidebar({
      status: "ready" as const,
      chatsStatus: "idle" as const,
    });

    expect(html).toContain("No searches yet");
  });

  it("keeps existing folders visible while refreshes are loading", () => {
    const html = renderSidebar({
      folders: [{ name: "pricing-review" }],
      activeFolderName: "pricing-review",
      status: "loading" as const,
    });

    expect(html).toContain("pricing-review");
    expect(html).not.toContain("Loading...");
  });

  it("keeps existing folders visible after background refresh errors", () => {
    const html = renderSidebar({
      folders: [{ name: "pricing-review" }],
      activeFolderName: "pricing-review",
      status: "error" as const,
    });

    expect(html).toContain("pricing-review");
    expect(html).not.toContain("Could not load searches.");
  });

  it("renders empty loading, error, and ready states", () => {
    expect(renderSidebar({ status: "loading" as const })).toContain("Loading...");
    expect(renderSidebar({ status: "error" as const })).toContain(
      "Could not load searches.",
    );
    expect(renderSidebar({ status: "ready" as const })).toContain("No searches yet");
  });

  it("renders running indicators and disables folder actions for active runs", () => {
    const html = renderSidebar({
      folders: [{ name: "pricing-review" }],
      activeFolderName: "pricing-review",
      chats: [
        {
          id: "2026-05-22T10-00-00.000Z",
          title: "Pricing options",
          createdAt: "2026-05-22T10:00:00.000Z",
          updatedAt: "2026-05-22T10:30:00.000Z",
          messageCount: 4,
        },
      ],
      activeChatId: "2026-05-22T10-00-00.000Z",
      chatsStatus: "ready" as const,
      runningFolderNames: ["pricing-review"],
      runningChatIds: ["2026-05-22T10-00-00.000Z"],
    });

    expect(html).toContain("Research running in pricing-review");
    expect(html).toContain("Research running in Pricing options");
  });

  it("renders attention indicators before running indicators", () => {
    const html = renderSidebar({
      folders: [{ name: "pricing-review" }],
      activeFolderName: "pricing-review",
      chats: [
        {
          id: "2026-05-22T10-00-00.000Z",
          title: "Pricing options",
          createdAt: "2026-05-22T10:00:00.000Z",
          updatedAt: "2026-05-22T10:30:00.000Z",
          messageCount: 4,
        },
      ],
      activeChatId: "2026-05-22T10-00-00.000Z",
      chatsStatus: "ready" as const,
      runningFolderNames: ["pricing-review"],
      runningChatIds: ["2026-05-22T10-00-00.000Z"],
      attentionFolderNames: ["pricing-review"],
      attentionChatIds: ["2026-05-22T10-00-00.000Z"],
    });

    expect(html).toContain("md-sidebar-attention");
    expect(html).toContain("Question waiting in pricing-review");
    expect(html).toContain("Question waiting in Pricing options");
    expect(html).not.toContain("Research running in pricing-review");
    expect(html).not.toContain("Research running in Pricing options");
  });
});

type ResearchSidebarProps = ComponentProps<typeof ResearchSidebar>;

function renderSidebar(props: Partial<ResearchSidebarProps> = {}) {
  return renderToStaticMarkup(
    <MantineProvider>
      <ResearchSidebar
        folders={[]}
        activeFolderName={null}
        chats={[]}
        activeChatId={null}
        embeddingConfig={mockEmbeddingConfig}
        rerankerConfig={mockRerankerConfig}
        status="ready"
        chatsStatus="idle"
        onNewChat={vi.fn()}
        onSelectFolder={vi.fn()}
        onNewResearchChat={vi.fn()}
        onSelectChat={vi.fn()}
        onRenameFolder={vi.fn()}
        onDeleteFolder={vi.fn()}
        {...props}
      />
    </MantineProvider>,
  );
}
