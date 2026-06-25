// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Box, MantineProvider } from "@mantine/core";
import { PromptTemplatesProvider } from "@/hooks/use-prompt-templates";
import { AssistantRuntimeStoryProvider } from "@/lib/storybook";
import { Thread } from "../thread";

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

  const storage = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    },
  });
});

const SEARCHES = ["first query", "second query", "third query"];

function renderThread(previousSearches: string[] = []) {
  return render(
    <MantineProvider>
      <AssistantRuntimeStoryProvider initialMessages={[]}>
        <PromptTemplatesProvider>
          <Box h="560px">
            <Thread
              models={[]}
              selectedModelId=""
              onSelectedModelIdChange={() => undefined}
              tokenCount={0}
              previousSearches={previousSearches}
            />
          </Box>
        </PromptTemplatesProvider>
      </AssistantRuntimeStoryProvider>
    </MantineProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.removeItem("deep-search:composer-draft");
});

function getTextarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText("Ask something...") as HTMLTextAreaElement;
}

describe("ComposerInput tab cycling", () => {
  it("does nothing when there are no previous searches", () => {
    renderThread([]);
    const textarea = getTextarea();
    fireEvent.keyDown(textarea, { key: "Tab" });
    expect(textarea.value).toBe("");
  });

  it("fills with the most recent search on first Tab", async () => {
    renderThread(SEARCHES);
    const textarea = getTextarea();

    fireEvent.keyDown(textarea, { key: "Tab" });

    await waitFor(() => {
      expect(textarea.value).toBe("third query");
    });
  });

  it("cycles forward wrapping to the first search after the last", async () => {
    renderThread(SEARCHES);
    const textarea = getTextarea();

    fireEvent.keyDown(textarea, { key: "Tab" });
    await waitFor(() => expect(textarea.value).toBe("third query"));

    fireEvent.keyDown(textarea, { key: "Tab" });
    await waitFor(() => expect(textarea.value).toBe("first query"));

    fireEvent.keyDown(textarea, { key: "Tab" });
    await waitFor(() => expect(textarea.value).toBe("second query"));

    fireEvent.keyDown(textarea, { key: "Tab" });
    await waitFor(() => expect(textarea.value).toBe("third query"));
  });

  it("Shift+Tab cycles backward through searches", async () => {
    renderThread(SEARCHES);
    const textarea = getTextarea();

    fireEvent.keyDown(textarea, { key: "Tab" });
    await waitFor(() => expect(textarea.value).toBe("third query"));

    fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
    await waitFor(() => expect(textarea.value).toBe("second query"));

    fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
    await waitFor(() => expect(textarea.value).toBe("first query"));

    fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
    await waitFor(() => expect(textarea.value).toBe("third query"));
  });

  it("starts from the most recent even when starting with Shift+Tab", async () => {
    renderThread(SEARCHES);
    const textarea = getTextarea();

    fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });

    await waitFor(() => {
      expect(textarea.value).toBe("third query");
    });
  });

  it("resets cycling when typing manually", async () => {
    renderThread(SEARCHES);
    const textarea = getTextarea();

    fireEvent.keyDown(textarea, { key: "Tab" });
    await waitFor(() => expect(textarea.value).toBe("third query"));

    fireEvent.change(textarea, { target: { value: "something else" } });

    fireEvent.keyDown(textarea, { key: "Tab" });
    await waitFor(() => expect(textarea.value).toBe("third query"));
  });

  it("does not intercept Ctrl+Tab (lets sidebar folder cycling handle it)", () => {
    renderThread(SEARCHES);
    const textarea = getTextarea();

    fireEvent.keyDown(textarea, { key: "Tab", ctrlKey: true });

    // The textarea value should NOT change — Ctrl+Tab is reserved for sidebar cycling
    expect(textarea.value).toBe("");
  });

  it("allows full rotation and back to start", async () => {
    renderThread(SEARCHES);
    const textarea = getTextarea();

    for (let i = 0; i < SEARCHES.length * 2; i++) {
      fireEvent.keyDown(textarea, { key: "Tab" });
      await waitFor(() => {
        const expected = SEARCHES[(SEARCHES.length - 1 + i) % SEARCHES.length];
        expect(textarea.value).toBe(expected);
      });
    }
  });
});

describe("ComposerInput draft persistence", () => {
  it("restores an unsent draft from localStorage after remounting", async () => {
    const { unmount } = renderThread([]);
    const textarea = getTextarea();

    fireEvent.change(textarea, { target: { value: "persist this draft" } });

    await waitFor(() => {
      expect(window.localStorage.getItem("deep-search:composer-draft")).toBe(
        "persist this draft",
      );
    });

    unmount();
    renderThread([]);

    await waitFor(() => {
      expect(getTextarea().value).toBe("persist this draft");
    });
  });

  it("removes the saved draft when the composer text is cleared", async () => {
    renderThread([]);
    const textarea = getTextarea();

    fireEvent.change(textarea, { target: { value: "temporary draft" } });
    await waitFor(() => {
      expect(window.localStorage.getItem("deep-search:composer-draft")).toBe(
        "temporary draft",
      );
    });

    fireEvent.change(textarea, { target: { value: "" } });

    await waitFor(() => {
      expect(window.localStorage.getItem("deep-search:composer-draft")).toBeNull();
    });
  });
});
