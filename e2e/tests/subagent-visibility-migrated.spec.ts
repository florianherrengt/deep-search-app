import { test, expect } from "../fixtures";
import {
  clickButtonWithText,
  installAppFileStorageMock,
  installOpenRouterMock,
  sendMessage,
  textResponse,
  toolCallResponse,
  waitForText,
} from "../helpers/chat";

test.describe("Migrated subagent visibility", () => {
  test("shows a subagent card in the chat when a tool is called", async ({
    configuredChatPage,
  }) => {
    await installOpenRouterMock(configuredChatPage, [
      toolCallResponse("sequential_thinking", {
        thoughts: ["step 1", "step 2"],
      }),
      textResponse("Here is my answer."),
    ]);

    await sendMessage(configuredChatPage, "Think about something");

    await waitForText(configuredChatPage, "sequential_thinking");
    await waitForText(configuredChatPage, "done");
    await waitForText(configuredChatPage, "Here is my answer.");
  });

  test("shows a subagent card with running spinner while tool executes", async ({
    configuredChatPage,
  }) => {
    await installOpenRouterMock(configuredChatPage, [
      toolCallResponse("list_files", {}),
      textResponse("I see the files."),
    ]);

    await sendMessage(configuredChatPage, "Show files");

    await waitForText(configuredChatPage, "list_files");
    await waitForText(configuredChatPage, "done");
    await waitForText(configuredChatPage, "I see the files.");
  });

  test("opens the subagent sidebar from the toolbar", async ({
    configuredChatPage,
  }) => {
    await installAppFileStorageMock(configuredChatPage);
    await installOpenRouterMock(configuredChatPage, [textResponse("Done.")]);

    await sendMessage(configuredChatPage, "Research my topic");

    await waitForText(configuredChatPage, "Done.");
    await openSubAgentSidebar(configuredChatPage);
    await waitForText(configuredChatPage, "Folder Naming");
    await waitForText(configuredChatPage, "Sub-agents");
  });

  test("expands the inline tool detail panel", async ({ configuredChatPage }) => {
    await installOpenRouterMock(configuredChatPage, [
      toolCallResponse("list_files", {}),
      textResponse("All done."),
    ]);

    await sendMessage(configuredChatPage, "List files please");

    await waitForText(configuredChatPage, "list_files");
    await waitForText(configuredChatPage, "done");
    await waitForTextStreamCompleted(configuredChatPage);

    await configuredChatPage
      .getByTestId("assistant-message")
      .getByRole("button", { name: "Expand list_files details" })
      .click();

    await expect(
      configuredChatPage
        .getByTestId("assistant-message")
        .getByRole("button", { name: "Collapse list_files details" }),
    ).toBeVisible();
  });

  test("shows multiple subagent cards for multiple tool calls", async ({
    configuredChatPage,
  }) => {
    await installOpenRouterMock(configuredChatPage, [
      toolCallResponse("sequential_thinking", { thoughts: ["step 1"] }),
      toolCallResponse("list_files", {}),
      textResponse("Done with everything."),
    ]);

    await sendMessage(configuredChatPage, "Do multiple things");

    await waitForText(configuredChatPage, "sequential_thinking");
    await waitForText(configuredChatPage, "list_files");
    await waitForText(configuredChatPage, "Done with everything.");

    const bodyText = await configuredChatPage.locator("body").innerText();
    expect((bodyText.match(/sequential_thinking/g) || []).length)
      .toBeGreaterThanOrEqual(1);
    expect((bodyText.match(/list_files/g) || []).length)
      .toBeGreaterThanOrEqual(1);
  });

  test("shows the close button in the subagent sidebar", async ({
    configuredChatPage,
  }) => {
    await installAppFileStorageMock(configuredChatPage);
    await installOpenRouterMock(configuredChatPage, [textResponse("Done.")]);

    await sendMessage(configuredChatPage, "Research my topic");
    await waitForText(configuredChatPage, "Done.");
    await openSubAgentSidebar(configuredChatPage);

    await expect(
      configuredChatPage.getByRole("button", { name: "Close subagent sidebar" }),
    ).toBeVisible();
  });

  test("shows Folder Naming subagent in sidebar for first message", async ({
    configuredChatPage,
  }) => {
    await installAppFileStorageMock(configuredChatPage);
    await installOpenRouterMock(configuredChatPage, [
      toolCallResponse("list_files", {}),
      textResponse("Here are the files."),
    ]);

    await sendMessage(configuredChatPage, "Research my topic");

    await waitForText(configuredChatPage, "list_files");
    await waitForText(configuredChatPage, "done");

    await openSubAgentSidebar(configuredChatPage);

    await waitForText(configuredChatPage, "Folder Naming");
  });

  test("shows Memory Extraction subagent in sidebar", async ({
    configuredChatPage,
  }) => {
    await installAppFileStorageMock(configuredChatPage);
    await installOpenRouterMock(configuredChatPage, [
      toolCallResponse("list_files", {}),
      textResponse("Done."),
    ]);

    await sendMessage(configuredChatPage, "Remember that I prefer dark mode");

    await waitForText(configuredChatPage, "list_files");
    await waitForText(configuredChatPage, "done");

    await openSubAgentSidebar(configuredChatPage);

    await waitForText(configuredChatPage, "Memory Extraction");
  });
});

async function openSubAgentSidebar(page: import("@playwright/test").Page) {
  await clickButtonWithText(page, "Open sub-agents");
  await waitForText(page, "Sub-agents");
}

async function waitForTextStreamCompleted(page: import("@playwright/test").Page) {
  await page.waitForFunction(
    () =>
      ((window as any).__logs || []).some(
        (entry: any) =>
          entry.kind === "openrouter-stream" &&
          entry.responseType === "text" &&
          entry.event === "completed",
      ),
    undefined,
    { timeout: 10000, polling: 100 },
  );
}
