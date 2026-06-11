import { test, expect } from "../fixtures";

test.describe("App startup", () => {
  test("shows the app title", async ({ chatPage }) => {
    await expect(chatPage.locator("h1")).toHaveText("Deep Search");
  });

  test("shows the chat composer textarea", async ({ chatPage }) => {
    const textarea = chatPage.getByPlaceholder("Ask something...");
    await expect(textarea).toBeVisible();
  });

  test("shows the Send button", async ({ chatPage }) => {
    await expect(
      chatPage.getByRole("button", { name: "Send" }),
    ).toBeVisible();
  });

  test("can type in the textarea", async ({ chatPage }) => {
    const textarea = chatPage.getByPlaceholder("Ask something...");
    await textarea.fill("Hello world");
    await expect(textarea).toHaveValue("Hello world");
  });

  test("Send button becomes enabled after typing", async ({ chatPage }) => {
    const textarea = chatPage.getByPlaceholder("Ask something...");
    const sendButton = chatPage.getByRole("button", { name: "Send" });

    await expect(sendButton).toBeDisabled();
    await textarea.fill("Hello");
    await expect(sendButton).toBeEnabled();
  });
});
