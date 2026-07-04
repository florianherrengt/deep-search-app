import { test, expect } from "../fixtures";
import {
  getComposerInput,
  installOpenRouterMock,
  sendMessage,
  textResponse,
  waitForText,
} from "../helpers/chat";

test.describe("Migrated chat flow", () => {
  test("displays the chat UI", async ({ chatPage }) => {
    await expect(chatPage.locator("h1")).toHaveText("Deep Search");
  });

  test("has a composer with input and send button", async ({ chatPage }) => {
    await expect(getComposerInput(chatPage)).toHaveAttribute(
      "placeholder",
      "Ask something...",
    );
    await expect(chatPage.getByRole("button", { name: "Send" })).toBeVisible();
  });

  test("lays out sidebar and chat area side by side", async ({ chatPage }) => {
    const sidebar = chatPage.getByTestId("research-sidebar");
    const textarea = getComposerInput(chatPage);

    const sidebarBox = await sidebar.boundingBox();
    const textareaBox = await textarea.boundingBox();

    expect(sidebarBox).not.toBeNull();
    expect(textareaBox).not.toBeNull();
    expect(sidebarBox!.x + sidebarBox!.width).toBeLessThan(textareaBox!.x);
    expect(sidebarBox!.y).toBeLessThanOrEqual(textareaBox!.y + 10);
  });

  test("sends a message and displays a mocked response", async ({
    configuredChatPage,
  }) => {
    await installOpenRouterMock(configuredChatPage, [
      textResponse("Hello from test"),
    ]);

    await sendMessage(configuredChatPage, "Hello");

    await waitForText(configuredChatPage, "Hello");
    await waitForText(configuredChatPage, "Hello from test");
  });

  test("displays the context window badge below the input", async ({
    chatPage,
  }) => {
    const badge = chatPage.getByTestId("context-window-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/^Context:/);
  });
});
