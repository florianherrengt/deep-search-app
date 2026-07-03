// @vitest-environment jsdom

import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import {
  AutoCollapsingReasoningRoot,
  ReasoningContent,
  ReasoningRoot,
  ReasoningTrigger,
} from "@/components/assistant-ui/reasoning";

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
});

afterEach(cleanup);

describe("Reasoning", () => {
  it("does not render thinking content while collapsed", () => {
    const html = renderToStaticMarkup(
      createElement(
        MantineProvider,
        null,
        createElement(ReasoningRoot, {
          defaultOpen: false,
          children: ({ open }) =>
            createElement(
              Fragment,
              null,
              createElement(ReasoningTrigger, { open }),
              createElement(
                ReasoningContent,
                { open },
                "Hidden reasoning text",
              ),
            ),
        }),
      ),
    );

    expect(html).toContain("Thinking");
    expect(html).not.toContain("Hidden reasoning text");
  });

  it("renders thinking content while open", () => {
    const html = renderToStaticMarkup(
      createElement(
        MantineProvider,
        null,
        createElement(ReasoningRoot, {
          defaultOpen: true,
          children: ({ open }) =>
            createElement(
              Fragment,
              null,
              createElement(ReasoningTrigger, { open }),
              createElement(
                ReasoningContent,
                { open },
                "Visible reasoning text",
              ),
            ),
        }),
      ),
    );

    expect(html).toContain("Thinking");
    expect(html).toContain("Visible reasoning text");
  });

  it("keeps active thinking open and collapses when thinking completes", () => {
    const view = renderAutoCollapsingReasoning(true);

    expect(screen.queryByText("Auto-collapsing reasoning text")).not.toBeNull();

    fireEvent.click(screen.getByLabelText("Thinking process"));
    expect(screen.queryByText("Auto-collapsing reasoning text")).not.toBeNull();

    view.rerender(autoCollapsingReasoningElement(false));
    expect(screen.queryByText("Auto-collapsing reasoning text")).toBeNull();

    fireEvent.click(screen.getByLabelText("Thinking process"));
    expect(screen.queryByText("Auto-collapsing reasoning text")).not.toBeNull();
  });
});

function renderAutoCollapsingReasoning(active: boolean) {
  return render(autoCollapsingReasoningElement(active));
}

function autoCollapsingReasoningElement(active: boolean) {
  return createElement(
    MantineProvider,
    null,
    createElement(AutoCollapsingReasoningRoot, {
      active,
      children: ({ open, onToggle }) =>
        createElement(
          Fragment,
          null,
          createElement(ReasoningTrigger, {
            active,
            open,
            onClick: onToggle,
          }),
          createElement(
            ReasoningContent,
            { open },
            "Auto-collapsing reasoning text",
          ),
        ),
    }),
  );
}
