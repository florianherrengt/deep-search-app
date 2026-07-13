import { test, expect } from "../fixtures";
import {
  clickAppTab,
  clickButtonWithText,
  getVisibleBodyText,
  waitForText,
} from "../helpers/chat";

async function addSkill(
  page: import("@playwright/test").Page,
  title: string,
  whenToUse: string,
  content: string,
) {
  await clickButtonWithText(page, "Add skill");

  await page.getByPlaceholder("Skill title").fill(title);
  await page
    .getByPlaceholder("When should the AI load this skill?")
    .fill(whenToUse);
  await page.getByPlaceholder("Skill instructions...").fill(content);

  await clickButtonWithText(page, "Save");
  await waitForText(page, title, 5000);
}

test.describe("Migrated skills", () => {
  test("shows the Skills tab", async ({ chatPage }) => {
    const tabs = await chatPage.locator('[data-testid="app-tab"]').allTextContents();
    expect(tabs).toContain("Skills");
  });

  test("shows empty state when no skills exist", async ({ chatPage }) => {
    await clickAppTab(chatPage, "skills");

    await waitForText(chatPage, "No skills yet", 5000);
  });

  test("adds a skill and shows it in the list", async ({ chatPage }) => {
    await clickAppTab(chatPage, "skills");

    await addSkill(
      chatPage,
      "Expert Presenter",
      "Use when the user needs help with a presentation",
      "You are a presentation expert. Structure content into clear slides with key points.",
    );

    const bodyText = await getVisibleBodyText(chatPage);
    expect(bodyText).toContain("Expert Presenter");
    expect(bodyText).toContain("expert-presenter");
    expect(bodyText).toContain(
      "Use when the user needs help with a presentation",
    );
  });

  test("shows the auto-generated slug while editing", async ({ chatPage }) => {
    await clickAppTab(chatPage, "skills");

    await clickButtonWithText(chatPage, "Add skill");
    await chatPage.getByPlaceholder("Skill title").fill("Data Analysis Wizard");

    await waitForText(chatPage, "slug: data-analysis-wizard", 5000);
  });

  test("deletes a skill", async ({ chatPage }) => {
    await clickAppTab(chatPage, "skills");
    await addSkill(chatPage, "ToDelete", "When to delete", "Delete this skill");

    await chatPage.getByRole("button", { name: "Delete ToDelete" }).click();

    await expect(chatPage.locator("body")).not.toContainText("ToDelete");
  });

  test("edits a skill", async ({ chatPage }) => {
    await clickAppTab(chatPage, "skills");
    await addSkill(chatPage, "Original", "Original when to use", "Original content");

    await chatPage.getByRole("button", { name: "Edit Original" }).click();

    await chatPage.getByPlaceholder("Skill title").fill("Renamed Skill");
    await chatPage
      .getByPlaceholder("When should the AI load this skill?")
      .fill("Updated trigger");
    await chatPage.getByPlaceholder("Skill instructions...").fill("Updated content");

    await clickButtonWithText(chatPage, "Save");

    await waitForText(chatPage, "Renamed Skill", 5000);
    const bodyText = await getVisibleBodyText(chatPage);
    expect(bodyText).toContain("Updated trigger");
    expect(bodyText).toContain("renamed-skill");
    expect(bodyText).not.toContain("Original");
  });

  test("validates required fields", async ({ chatPage }) => {
    await clickAppTab(chatPage, "skills");

    await clickButtonWithText(chatPage, "Add skill");
    await clickButtonWithText(chatPage, "Save");

    await waitForText(chatPage, "Title is required", 5000);
  });

  test("cancels adding a skill", async ({ chatPage }) => {
    await clickAppTab(chatPage, "skills");

    await clickButtonWithText(chatPage, "Add skill");
    await chatPage.getByPlaceholder("Skill title").fill("Cancelled Skill");

    await clickButtonWithText(chatPage, "Cancel");

    const bodyText = await getVisibleBodyText(chatPage);
    expect(bodyText).not.toContain("Cancelled Skill");
  });

  test("persists skills after navigating away and back", async ({ chatPage }) => {
    await clickAppTab(chatPage, "skills");

    await addSkill(chatPage, "Persistent", "Always available", "This skill persists");

    await clickAppTab(chatPage, "main");
    await clickAppTab(chatPage, "skills");

    await waitForText(chatPage, "Persistent", 5000);
    const bodyText = await getVisibleBodyText(chatPage);
    expect(bodyText).toContain("persistent");
  });
});
