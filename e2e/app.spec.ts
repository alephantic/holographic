import { expect, test, type Page } from "@playwright/test";

async function openSidebarIfMobile(page: Page) {
  const menu = page.getByRole("button", { name: "Open sidebar" });
  if (await menu.isVisible()) await menu.click();
}

async function chooseMode(page: Page, mode: "Chat" | "Save") {
  await page.getByRole("button", { name: /^Mode:/ }).click();
  await page.getByRole("option", { name: new RegExp(`^${mode}`) }).click();
  await expect(page.getByRole("button", { name: `Mode: ${mode}` })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Begin with either a chat or a thought." })).toBeVisible();
});

test("empty state shows labeled samples and no real entries", async ({ page }) => {
  await openSidebarIfMobile(page);
  const sidebar = page.getByRole("navigation", { name: "Sidebar" });
  await expect(sidebar.getByRole("heading", { name: "Recents" })).toBeVisible();
  await expect(sidebar.getByText("Nothing saved yet.")).toBeVisible();
  await expect(sidebar.getByRole("heading", { name: "Samples" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /^Sample chat:/ })).toHaveCount(1);
  await expect(sidebar.getByRole("button", { name: /^Sample saved:/ })).toHaveCount(2);

  await sidebar.getByRole("button", { name: /^Sample saved: A diagram/ }).click();
  await expect(page.getByText("a built-in example, not stored")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
});

test("saving a thought creates an entry that survives a reload and reopens intact", async ({ page }) => {
  await chooseMode(page, "Save");
  const body = "Keep this thought.\n\nIt has a second paragraph.";
  await page.getByRole("textbox").fill(body);
  await page.keyboard.press("Enter");

  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.locator(".saved-body")).toHaveText(body);
  await expect(page.getByRole("textbox")).toHaveValue("");

  await page.reload();
  await openSidebarIfMobile(page);
  const sidebar = page.getByRole("navigation", { name: "Sidebar" });
  await expect(sidebar.getByRole("heading", { name: "Samples" })).toHaveCount(0);
  const item = sidebar.getByRole("button", { name: "Saved: Keep this thought." });
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.locator(".saved-body")).toHaveText(body);

  // Mode preference is remembered too.
  await expect(page.getByRole("button", { name: "Mode: Save" })).toBeVisible();

  // Delete asks first, then removes the entry and returns to the start.
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Keep", exact: true }).click();
  await expect(page.locator(".saved-body")).toHaveText(body);
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete" }).last().click();
  await expect(page.getByRole("heading", { name: "Begin with either a chat or a thought." })).toBeVisible();
});

test("chat mode without an API key keeps the message and says why there is no reply", async ({ page }) => {
  await chooseMode(page, "Chat");
  await expect(page.getByRole("status")).toContainText("No model connected.");

  await page.getByRole("textbox").fill("Is anyone there?");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.locator(".message-user .message-body")).toHaveText("Is anyone there?");
  await expect(page.locator(".message-note")).toContainText("No model is connected");
  await expect(page.locator(".message-assistant")).toHaveCount(0);

  // The chat is kept and can be reopened.
  await page.reload();
  await openSidebarIfMobile(page);
  await page.getByRole("button", { name: "Chat: Is anyone there?" }).click();
  await expect(page.locator(".message-user .message-body")).toHaveText("Is anyone there?");
});

test("mode menu works from the keyboard", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Mode: Chat" });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mode: Save" })).toBeFocused();
  await expect(page.getByRole("textbox")).toHaveAttribute("placeholder", "Write a thought to keep");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("Shift+Enter adds a line, Enter submits", async ({ page }) => {
  await chooseMode(page, "Save");
  const box = page.getByRole("textbox");
  await box.fill("line one");
  await box.press("Shift+Enter");
  await box.type("line two");
  await expect(box).toHaveValue("line one\nline two");
  await box.press("Enter");
  await expect(page.locator(".saved-body")).toHaveText("line one\nline two");
});
