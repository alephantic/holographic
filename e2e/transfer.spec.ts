import { expect, test, type Page } from "@playwright/test";

async function openSidebarIfMobile(page: Page) {
  const menu = page.getByRole("button", { name: "Open sidebar" });
  if (await menu.isVisible()) await menu.click();
}

async function save(page: Page, text: string) {
  await page.getByRole("textbox").fill(text);
  await page.keyboard.press("Enter");
  await expect(page.locator(".saved-body")).toHaveText(text);
}

test("export downloads the library and import restores it without duplicates", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Mode:/ }).click();
  await page.getByRole("option", { name: /^Save/ }).click();
  await save(page, "First thought to keep.");
  await save(page, "Second thought to keep.");

  await openSidebarIfMobile(page);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^holographic-export-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();
  const text = await (await import("node:fs/promises")).readFile(path!, "utf8");
  const doc = JSON.parse(text);
  expect(doc.format).toBe("holographic-export");
  expect(doc.library.entries).toHaveLength(2);
  expect(doc.library.entries.map((e: { title: string }) => e.title)).toEqual(["Second thought to keep.", "First thought to keep."]);

  // Importing the same file back changes nothing.
  await page.getByLabel("Import file").setInputFiles(path!);
  await expect(page.getByRole("group", { name: "Import preview" })).toContainText("All 2 entries are already here.");
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // Wipe the browser, import, and everything comes back with its timestamps.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await openSidebarIfMobile(page);
  await expect(page.getByText("Nothing saved yet.")).toBeVisible();
  await page.getByLabel("Import file").setInputFiles(path!);
  await expect(page.getByRole("group", { name: "Import preview" })).toContainText("2 entries to add.");
  await page.getByRole("button", { name: "Add 2" }).click();
  await expect(page.getByText("Added 2.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Saved: Second thought to keep." })).toBeVisible();
  await page.getByRole("button", { name: "Saved: First thought to keep." }).click();
  await expect(page.locator(".saved-body")).toHaveText("First thought to keep.");
  await expect(page.locator(".entry-meta time")).toHaveAttribute("datetime", doc.library.entries[1].createdAt);

  // A second import of the same file after restoring adds nothing.
  await openSidebarIfMobile(page);
  await page.getByLabel("Import file").setInputFiles(path!);
  await expect(page.getByRole("group", { name: "Import preview" })).toContainText("already here");
});

test("import rejects a file that isn't an export", async ({ page }) => {
  await page.goto("/");
  await openSidebarIfMobile(page);
  await page.getByLabel("Import file").setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from('{"hello": 1}') });
  await expect(page.getByRole("alert")).toContainText("doesn't look like a Holographic export");
});
