// @vitest-environment jsdom
import { useEffect, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, afterEach, beforeAll } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { ResearchSidebar } from "@/components/research-sidebar";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  if (typeof ResizeObserver === "undefined") {
    (globalThis as Record<string, unknown>).ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  Object.defineProperty(Element.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
});

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

  it("includes aria-keyshortcuts on the sidebar element", () => {
    const html = renderSidebar({
      folders: [{ name: "acme-market-map" }, { name: "pricing-review" }],
    });

    expect(html).toContain('aria-keyshortcuts="Ctrl+Tab Ctrl+Shift+Tab"');
  });
});

// ── Ctrl+Tab keyboard cycling ──────────────────────────────────────────────

describe("Ctrl+Tab folder cycling", () => {
  const FOLDERS = [
    { name: "acme-market-map" },
    { name: "pricing-review" },
    { name: "supplier-audit" },
  ];

  it("does nothing when there are fewer than 2 folders", () => {
    const onSelect = vi.fn();
    renderCyclingWrapper({
      folders: [{ name: "only-folder" }],
      activeFolderName: null,
      onSelectFolder: onSelect,
    });

    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("selects the first folder on Ctrl+Tab when none is active", async () => {
    const onSelect = vi.fn();
    renderCyclingWrapper({
      folders: FOLDERS,
      activeFolderName: null,
      onSelectFolder: onSelect,
    });

    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith("acme-market-map");
    });
  });

  it("selects the last folder on Ctrl+Shift+Tab when none is active", async () => {
    const onSelect = vi.fn();
    renderCyclingWrapper({
      folders: FOLDERS,
      activeFolderName: null,
      onSelectFolder: onSelect,
    });

    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith("supplier-audit");
    });
  });

  it("cycles forward through folders with Ctrl+Tab", async () => {
    const onSelect = vi.fn();
    renderCyclingWrapper({
      folders: FOLDERS,
      activeFolderName: "pricing-review",
      onSelectFolder: onSelect,
    });

    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith("supplier-audit");
    });
  });

  it("cycles backward through folders with Ctrl+Shift+Tab", async () => {
    const onSelect = vi.fn();
    renderCyclingWrapper({
      folders: FOLDERS,
      activeFolderName: "pricing-review",
      onSelectFolder: onSelect,
    });

    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith("acme-market-map");
    });
  });

  it("wraps from last to first folder with Ctrl+Tab", async () => {
    const onSelect = vi.fn();
    renderCyclingWrapper({
      folders: FOLDERS,
      activeFolderName: "supplier-audit",
      onSelectFolder: onSelect,
    });

    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith("acme-market-map");
    });
  });

  it("wraps from first to last folder with Ctrl+Shift+Tab", async () => {
    const onSelect = vi.fn();
    renderCyclingWrapper({
      folders: FOLDERS,
      activeFolderName: "acme-market-map",
      onSelectFolder: onSelect,
    });

    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith("supplier-audit");
    });
  });

  it("does not intercept plain Tab (without Ctrl)", () => {
    const onSelect = vi.fn();
    renderCyclingWrapper({
      folders: FOLDERS,
      activeFolderName: "acme-market-map",
      onSelectFolder: onSelect,
    });

    fireEvent.keyDown(window, { key: "Tab" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does intercept Ctrl+Tab when focus is in a text input", () => {
    const onSelect = vi.fn();
    const { container } = renderCyclingWrapper({
      folders: FOLDERS,
      activeFolderName: "acme-market-map",
      onSelectFolder: onSelect,
    });

    const input = document.createElement("input");
    container.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: "Tab", ctrlKey: true });
    expect(onSelect).toHaveBeenCalledWith("pricing-review");
  });

  it("does intercept Ctrl+Tab when focus is in a textarea", () => {
    const onSelect = vi.fn();
    const { container } = renderCyclingWrapper({
      folders: FOLDERS,
      activeFolderName: "acme-market-map",
      onSelectFolder: onSelect,
    });

    const textarea = document.createElement("textarea");
    container.appendChild(textarea);
    textarea.focus();

    fireEvent.keyDown(textarea, { key: "Tab", ctrlKey: true });
    expect(onSelect).toHaveBeenCalledWith("pricing-review");
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

type ResearchSidebarProps = ComponentProps<typeof ResearchSidebar>;

function renderSidebar(props: Partial<ResearchSidebarProps> = {}) {
  return renderToStaticMarkup(
    <MantineProvider>
      <ResearchSidebar
        folders={[]}
        activeFolderName={null}
        chats={[]}
        activeChatId={null}
        searchFolders={vi.fn().mockResolvedValue([])}
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

interface CyclingWrapperProps {
  folders: { name: string }[];
  activeFolderName: string | null;
  onSelectFolder: (name: string) => void;
}

/**
 * Minimal wrapper that mounts ResearchSidebar together with the same
 * Ctrl+Tab window keydown listener that AppInner uses.
 */
function CyclingWrapper({ folders, activeFolderName, onSelectFolder }: CyclingWrapperProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !e.ctrlKey) return;

      if (folders.length < 2) return;

      e.preventDefault();

      const currentIndex = folders.findIndex(f => f.name === activeFolderName);
      let nextIndex: number;

      if (currentIndex === -1) {
        nextIndex = e.shiftKey ? folders.length - 1 : 0;
      } else if (e.shiftKey) {
        nextIndex = currentIndex === 0 ? folders.length - 1 : currentIndex - 1;
      } else {
        nextIndex = currentIndex === folders.length - 1 ? 0 : currentIndex + 1;
      }

      const nextFolder = folders[nextIndex];
      if (nextFolder) {
        onSelectFolder(nextFolder.name);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [folders, activeFolderName, onSelectFolder]);

  return (
    <MantineProvider>
      <ResearchSidebar
        folders={folders}
        activeFolderName={activeFolderName}
        chats={[]}
        activeChatId={null}
        searchFolders={vi.fn().mockResolvedValue([])}
        status="ready"
        chatsStatus="idle"
        onNewChat={vi.fn()}
        onSelectFolder={onSelectFolder}
        onNewResearchChat={vi.fn()}
        onSelectChat={vi.fn()}
        onRenameFolder={vi.fn()}
        onDeleteFolder={vi.fn()}
      />
    </MantineProvider>
  );
}

function renderCyclingWrapper(props: CyclingWrapperProps) {
  return render(<CyclingWrapper {...props} />);
}
