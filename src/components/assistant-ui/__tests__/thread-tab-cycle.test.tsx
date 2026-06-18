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
