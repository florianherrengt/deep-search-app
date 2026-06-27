import { test, expect } from "../fixtures";

test.describe("Settings panel", () => {
  test("shows provider configuration section", async ({ chatPage }) => {
    await chatPage.getByRole("button", { name: "Settings" }).click();

    await expect(chatPage.getByText("Provider", { exact: true })).toBeVisible();
    await expect(chatPage.getByRole("textbox", { name: "Model", exact: true })).toBeVisible();
    await expect(chatPage.getByRole("textbox", { name: "API Key", exact: true })).toBeVisible();
    await expect(chatPage.getByRole("button", { name: "Save" })).toBeVisible();
  });

  test("Save button is disabled when no changes", async ({ chatPage }) => {
    await chatPage.getByRole("button", { name: "Settings" }).click();

    await expect(chatPage.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("typing in a field does not auto-save on blur", async ({ chatPage }) => {
    await chatPage.getByRole("button", { name: "Settings" }).click();

    const modelInput = chatPage.getByRole("textbox", { name: "Model", exact: true });
    await modelInput.fill("gpt-4o");

    await expect(chatPage.getByRole("button", { name: "Save" })).toBeEnabled();

    await chatPage.getByRole("textbox", { name: "API Key", exact: true }).click();

    const stored = await chatPage.evaluate(() =>
      JSON.parse(window.localStorage.getItem("deep-search-test-settings") || "{}"),
    );
    expect(stored.default_model).toBe("openrouter/auto");
  });

  test("Save persists provider field changes", async ({ chatPage }) => {
    await chatPage.getByRole("button", { name: "Settings" }).click();

    const modelInput = chatPage.getByRole("textbox", { name: "Model", exact: true });
    await modelInput.fill("my-test-model");

    const saveButton = chatPage.getByRole("button", { name: "Save" });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    await chatPage.waitForFunction(
      (expected) =>
        JSON.parse(
          window.localStorage.getItem("deep-search-test-settings") || "{}",
        ).default_model === expected,
      "my-test-model",
    );
    await expect(saveButton).toBeDisabled();
  });

  test("switching tabs and back preserves unsaved drafts", async ({ chatPage }) => {
    await chatPage.getByRole("button", { name: "Settings" }).click();

    const modelInput = chatPage.getByRole("textbox", { name: "Model", exact: true });
    await modelInput.fill("unsaved-model");

    await chatPage.getByRole("button", { name: "Chat" }).click();
    await chatPage.getByRole("button", { name: "Settings" }).click();

    await expect(modelInput).toHaveValue("unsaved-model");
    await expect(chatPage.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  test("browser back/forward does not crash the app", async ({ chatPage }) => {
    await chatPage.getByRole("button", { name: "Settings" }).click();

    const modelInput = chatPage.getByRole("textbox", { name: "Model", exact: true });
    await modelInput.fill("back-test-model");

    await chatPage.goBack();
    await chatPage.goBack();
    await chatPage.goForward();

    await expect(chatPage.getByPlaceholder("Ask something...")).toBeVisible({
      timeout: 10000,
    });
  });

  test("switching providers resets drafts to saved values", async ({ chatPage }) => {
    await chatPage.getByRole("button", { name: "Settings" }).click();

    const modelInput = chatPage.getByRole("textbox", { name: "Model", exact: true });
    await modelInput.fill("will-be-discarded");

    const providerSelect = chatPage.getByRole("textbox", { name: "Provider" });
    await providerSelect.click();
    await chatPage.getByRole("option", { name: "Anthropic" }).click();

    await expect(modelInput).toHaveValue("claude-sonnet-4-5");
    await expect(chatPage.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("Enter key saves provider fields", async ({ chatPage }) => {
    await chatPage.getByRole("button", { name: "Settings" }).click();

    const modelInput = chatPage.getByRole("textbox", { name: "Model", exact: true });
    await modelInput.fill("enter-model");
    await modelInput.press("Enter");

    await chatPage.waitForFunction(
      (expected) =>
        JSON.parse(
          window.localStorage.getItem("deep-search-test-settings") || "{}",
        ).default_model === expected,
      "enter-model",
    );
    await expect(chatPage.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("saving multiple fields at once", async ({ chatPage }) => {
    await chatPage.getByRole("button", { name: "Settings" }).click();

    const modelInput = chatPage.getByRole("textbox", { name: "Model", exact: true });
    await modelInput.fill("multi-model");

    const apiKeyInput = chatPage.getByRole("textbox", { name: "API Key", exact: true });
    await apiKeyInput.fill("sk-multi-key");

    const saveButton = chatPage.getByRole("button", { name: "Save" });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    await chatPage.waitForFunction(
      ([model, key]) => {
        const s = JSON.parse(
          window.localStorage.getItem("deep-search-test-settings") || "{}",
        );
        return s.default_model === model && s.openrouter_api_key === key;
      },
      ["multi-model", "sk-multi-key"],
    );
    await expect(saveButton).toBeDisabled();
  });

  test("provider dropdown shows checkmark for configured providers", async ({ configuredChatPage }) => {
    await configuredChatPage.getByRole("button", { name: "Settings" }).click();

    const providerSelect = configuredChatPage.getByRole("textbox", { name: "Provider" });
    await providerSelect.click();

    const openrouterOption = configuredChatPage.getByRole("option", { name: "OpenRouter" });
    await expect(openrouterOption).toBeVisible();
    await expect(openrouterOption.locator("svg")).toBeVisible();
  });

  test("shows search service fields", async ({ chatPage }) => {
    await chatPage.getByRole("button", { name: "Settings" }).click();

    await expect(chatPage.getByText("Search Services")).toBeVisible();
    await expect(chatPage.getByRole("textbox", { name: "SearXNG URL" })).toBeVisible();
    await expect(chatPage.getByRole("textbox", { name: "Brave Search API Key" })).toBeVisible();
    await expect(chatPage.getByRole("textbox", { name: "Exa API Key" })).toBeVisible();
  });

  test("shows extraction settings fields", async ({ chatPage }) => {
    await chatPage.getByRole("button", { name: "Settings" }).click();

    await expect(chatPage.getByText("Extraction Services")).toBeVisible();
    await expect(chatPage.getByRole("textbox", { name: "Scrape.do API Key" })).toBeVisible();
    await expect(chatPage.getByText("Chrome DevTools MCP", { exact: true })).toBeVisible();
    await expect(chatPage.getByText("Extraction backend", { exact: true })).toBeVisible();
  });

  test("search service fields still auto-save on blur", async ({ chatPage }) => {
    await chatPage.getByRole("button", { name: "Settings" }).click();

    const braveInput = chatPage.getByRole("textbox", { name: "Brave Search API Key" });
    await braveInput.fill("BSA-test-brave");
    await chatPage.getByRole("textbox", { name: "Exa API Key" }).click();

    const stored = await chatPage.evaluate(() =>
      JSON.parse(window.localStorage.getItem("deep-search-test-settings") || "{}"),
    );
    expect(stored.brave_api_key).toBe("BSA-test-brave");
  });

  test("reset all settings clears provider fields", async ({ chatPage }) => {
    await chatPage.getByRole("button", { name: "Settings" }).click();

    const modelInput = chatPage.getByRole("textbox", { name: "Model", exact: true });
    await modelInput.fill("temp-model");

    const saveButton = chatPage.getByRole("button", { name: "Save" });
    await saveButton.click();

    await chatPage.waitForFunction(
      (expected) =>
        JSON.parse(
          window.localStorage.getItem("deep-search-test-settings") || "{}",
        ).default_model === expected,
      "temp-model",
    );

    chatPage.once("dialog", (dialog) => dialog.accept());
    await chatPage.getByRole("button", { name: "Reset All Settings" }).click();
    await chatPage.getByRole("button", { name: "Confirm Reset" }).click();

    await chatPage.waitForFunction(
      (expected) =>
        JSON.parse(
          window.localStorage.getItem("deep-search-test-settings") || "{}",
        ).default_model === expected,
      "openrouter/free",
    );
  });
});
