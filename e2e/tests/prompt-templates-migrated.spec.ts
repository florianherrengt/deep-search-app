import { test, expect } from "../fixtures";
import {
  clickAppTab,
  clickButtonWithText,
  clickComposerSend,
  getComposerInput,
  getVisibleBodyText,
  installOpenRouterMock,
  textResponse,
  waitForText,
} from "../helpers/chat";

async function addTemplate(page: import("@playwright/test").Page, name: string, text: string) {
  await clickButtonWithText(page, "Add template");

  await page.getByPlaceholder("Template name").fill(name);
  await page.getByPlaceholder("Enter prompt text...").fill(text);

  await clickButtonWithText(page, "Save");
  await waitForText(page, name, 5000);
}

async function selectPromptTemplate(
  page: import("@playwright/test").Page,
  name: string,
) {
  await page.locator('button[aria-label="Prompt templates"]').click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

test.describe("Migrated prompt templates", () => {
  test("shows the Prompts tab", async ({ chatPage }) => {
    const tabs = await chatPage.locator('[data-testid="app-tab"]').allTextContents();
    expect(tabs).toContain("Prompts");
  });

  test("adds a template and shows it in the list", async ({ chatPage }) => {
    await clickAppTab(chatPage, "prompts");

    await addTemplate(chatPage, "Test Prompt", "This is a test prompt");

    const bodyText = await getVisibleBodyText(chatPage);
    expect(bodyText).toContain("Test Prompt");
    expect(bodyText).toContain("This is a test prompt");
  });

  test("adds a template and shows it in the chat template dropdown", async ({
    chatPage,
  }) => {
    await clickAppTab(chatPage, "prompts");
    await addTemplate(chatPage, "Quick Search", "Search for information about");

    await clickAppTab(chatPage, "main");
    await selectPromptTemplate(chatPage, "Quick Search");

    await expect(getComposerInput(chatPage)).toHaveValue(
      "Search for information about",
    );
  });

  test("populates composer when selecting a template from the dropdown", async ({
    chatPage,
  }) => {
    await clickAppTab(chatPage, "prompts");
    await addTemplate(chatPage, "Summarize", "Summarize the following text");

    await clickAppTab(chatPage, "main");
    await selectPromptTemplate(chatPage, "Summarize");

    await expect(getComposerInput(chatPage)).toHaveValue(
      "Summarize the following text",
    );
  });

  test("sends template via main button click", async ({ configuredChatPage }) => {
    await clickAppTab(configuredChatPage, "prompts");
    await addTemplate(configuredChatPage, "Hello", "Say hello world");

    await clickAppTab(configuredChatPage, "main");
    await installOpenRouterMock(configuredChatPage, [
      textResponse("Hello world response"),
    ]);

    await selectPromptTemplate(configuredChatPage, "Hello");
    await expect(getComposerInput(configuredChatPage)).toHaveValue("Say hello world");

    await clickComposerSend(configuredChatPage);
    await waitForText(configuredChatPage, "Hello world response", 10000);
  });

  test("deletes a template", async ({ chatPage }) => {
    await clickAppTab(chatPage, "prompts");
    await addTemplate(chatPage, "ToDelete", "This will be deleted");

    await chatPage.getByRole("button", { name: "Delete ToDelete" }).click();

    await expect(chatPage.locator("body")).not.toContainText("ToDelete");
  });

  test("edits a template", async ({ chatPage }) => {
    await clickAppTab(chatPage, "prompts");
    await addTemplate(chatPage, "Original", "Original text");

    await chatPage.getByRole("button", { name: "Edit Original" }).click();

    await pageFill(chatPage, "Template name", "Renamed");
    await pageFill(chatPage, "Enter prompt text...", "Updated text");

    await clickButtonWithText(chatPage, "Save");

    await waitForText(chatPage, "Renamed", 5000);
    const bodyText = await getVisibleBodyText(chatPage);
    expect(bodyText).toContain("Updated text");
    expect(bodyText).not.toContain("Original");
  });

  test("shows empty state when no templates exist", async ({ chatPage }) => {
    await clickAppTab(chatPage, "prompts");

    await waitForText(chatPage, "No prompt templates yet", 10000);
  });
});

async function pageFill(
  page: import("@playwright/test").Page,
  placeholder: string,
  value: string,
) {
  const field = page.getByPlaceholder(placeholder);
  await field.fill("");
  await field.fill(value);
}
