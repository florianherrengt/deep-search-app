import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MantineProvider } from "@mantine/core";
import {
  canRenderQuestionsTool,
  QuestionsToolView,
  type QuestionResult,
} from "@/components/assistant-ui/questions-tool";

function wrap(node: ReactNode) {
  return createElement(MantineProvider, null, node);
}

const args = {
  questions: [
    {
      question: "Continue previous research?",
      candidates: [
        { label: "Continue", value: "continue:market-map" },
        { label: "Start fresh", value: "new" },
      ],
    },
  ],
};

describe("QuestionsToolView", () => {
  it("renders completed restored question results without a submit handler", () => {
    const result: QuestionResult = {
      answers: [
        {
          question: "Continue previous research?",
          answer: "continue:market-map",
        },
      ],
    };

    const html = renderToStaticMarkup(
      wrap(createElement(QuestionsToolView, { args, result })),
    );

    expect(html).toContain("Answers submitted");
    expect(html).toContain("Continue previous research?");
    expect(html).toContain("continue:market-map");
    expect(html).toContain("md-question-tool");
    expect(html).toContain('data-state="completed"');
    expect(html).not.toContain("mantine-color-teal-0");
  });

  it("detects pending question args only when answers can be submitted", () => {
    expect(
      canRenderQuestionsTool({ args, result: undefined, canSubmit: true }),
    ).toBe(true);
    expect(
      canRenderQuestionsTool({ args, result: undefined, canSubmit: false }),
    ).toBe(false);
  });

  it("keeps submit disabled until a non-empty answer is selected or typed", () => {
    const html = renderToStaticMarkup(
      wrap(
        createElement(QuestionsToolView, {
          args,
          result: undefined,
          onSubmit: () => undefined,
        }),
      ),
    );

    expect(html).toContain("disabled");
    expect(html).toContain("md-question-tool");
    expect(html).toContain('data-state="pending"');
    expect(html).toContain("--button-color:var(--md-question-choice-fg)");
    expect(html).toContain("--button-bg:var(--md-question-action-bg)");
  });
});
