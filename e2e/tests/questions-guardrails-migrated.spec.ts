import { test, expect } from "../fixtures";
import {
  clickButtonWithText,
  getOpenRouterLogs,
  installOpenRouterMock,
  sendMessage,
  textResponse,
  toolCallResponse,
  waitForText,
} from "../helpers/chat";

test.describe("Migrated questions tool UI", () => {
  test("renders questions with candidate buttons", async ({
    configuredChatPage,
  }) => {
    await installQuestionMock(configuredChatPage);

    await sendMessage(configuredChatPage, "What color?");
    await waitForText(configuredChatPage, "Which color do you prefer?");
    await waitForText(configuredChatPage, "Red");
    await waitForText(configuredChatPage, "Blue");
  });

  test("selects a candidate and submits the answer", async ({
    configuredChatPage,
  }) => {
    await installQuestionMock(configuredChatPage, [
      textResponse("Answer received"),
    ]);

    await sendMessage(configuredChatPage, "Pick a color");
    await waitForText(configuredChatPage, "Red");
    await clickButtonWithText(configuredChatPage, "Red");
    await clickButtonWithText(configuredChatPage, "Submit Answers");
    await waitForText(configuredChatPage, "Answers submitted");
    await waitForText(configuredChatPage, "red");
  });

  test("allows typing a custom answer", async ({ configuredChatPage }) => {
    await installQuestionMock(configuredChatPage, [
      textResponse("Answer received"),
    ]);

    await sendMessage(configuredChatPage, "Pick a color");

    const customInput = configuredChatPage.getByPlaceholder("Or type your own...");
    await customInput.fill("Green");

    await clickButtonWithText(configuredChatPage, "Submit Answers");
    await waitForText(configuredChatPage, "Answers submitted");
    await waitForText(configuredChatPage, "Green");
  });

  test("shows model reply after submitting answers", async ({
    configuredChatPage,
  }) => {
    await installQuestionMock(configuredChatPage, [textResponse("Great choice")]);

    await sendMessage(configuredChatPage, "Pick a color");
    await waitForText(configuredChatPage, "Red");
    await clickButtonWithText(configuredChatPage, "Red");
    await clickButtonWithText(configuredChatPage, "Submit Answers");
    await waitForText(configuredChatPage, "Answers submitted");
    await waitForText(configuredChatPage, "Great choice");
  });
});

test.describe("Migrated visible agent guardrails", () => {
  test("shows a visible card and reroutes plain-text questions into ask_questions", async ({
    configuredChatPage,
  }) => {
    await installOpenRouterMock(configuredChatPage, [
      textResponse("Which color do you prefer?"),
      toolCallResponse("ask_questions", {
        questions: [
          {
            question: "Which color do you prefer?",
            candidates: [
              { label: "Red", value: "red" },
              { label: "Blue", value: "blue" },
            ],
          },
        ],
      }),
    ]);

    await sendMessage(configuredChatPage, "Pick a color");

    await waitForText(configuredChatPage, "Question tool enforced");
    await waitForText(
      configuredChatPage,
      "Prompted the agent to ask this with the question tool.",
    );
    await waitForText(configuredChatPage, "Which color do you prefer?");
    await waitForText(configuredChatPage, "Red");
    await waitForText(configuredChatPage, "Blue");

    const logs = await getOpenRouterLogs(configuredChatPage);
    const userFacingCalls = logs.filter(
      (entry: any) =>
        entry.kind === "openrouter" &&
        !["folder-name", "memory-json"].includes(entry.responseType),
    );
    expect(userFacingCalls.map((entry: any) => entry.responseType)).toEqual([
      "text",
      "tool",
    ]);
  });

  test("shows a visible research-depth reminder and checkpoint guidance path", async ({
    configuredChatPage,
  }) => {
    await installOpenRouterMock(configuredChatPage, [
      textResponse("The current Acme Search price is about 10 pounds."),
      toolCallResponse("research_checkpoint", {
        originalQuestion: "Find the latest pricing for Acme Search",
        searchesRun: [],
        sourcesOpened: [],
        claimsVerified: [],
        unresolvedQuestions: ["No sources opened yet"],
        confidence: "low",
        readyToAnswer: false,
      }),
      textResponse("I need to continue researching before answering."),
    ]);

    await sendMessage(
      configuredChatPage,
      "Find the latest pricing for Acme Search",
    );

    await waitForText(configuredChatPage, "Research depth reminder");
    await waitForText(
      configuredChatPage,
      "Prompted the agent to consider whether more research is needed.",
    );
    await waitForText(configuredChatPage, "research_checkpoint");

    const logs = await getOpenRouterLogs(configuredChatPage);
    expect(logs.filter((entry: any) => entry.kind === "openrouter").length)
      .toBeGreaterThanOrEqual(3);
  });
});

async function installQuestionMock(
  page: import("@playwright/test").Page,
  afterToolResponses = [],
) {
  await installOpenRouterMock(page, [
    toolCallResponse("ask_questions", {
      questions: [
        {
          question: "Which color do you prefer?",
          candidates: [
            { label: "Red", value: "red" },
            { label: "Blue", value: "blue" },
          ],
        },
      ],
    }),
    ...afterToolResponses,
  ]);
}
