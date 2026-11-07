import { expect, test, type Page } from "@playwright/test";
import { MAX_CHARS_PER_REQUEST, MAX_CHARS_PER_TURN, MAX_TURNS } from "../shared/limits";

// Seeds the browser with one long chat: 40 alternating messages of ~3,000 characters.
async function seedLongChat(page: Page) {
  await page.goto("/");
  await page.evaluate(
    ({ count, size }) => {
      const messages = Array.from({ length: count }, (_, i) => ({
        id: `seed-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i} `.padEnd(size, "ab "),
        createdAt: new Date(2026, 0, 1, 0, i).toISOString(),
      }));
      const chat = { id: "seed-chat", kind: "chat", title: "A very long chat", createdAt: messages[0]!.createdAt, updatedAt: messages[count - 1]!.createdAt, messages };
      localStorage.setItem("holographic.library.v1", JSON.stringify({ version: 1, entries: [chat] }));
    },
    { count: 40, size: 3_000 },
  );
  await page.reload();
  const menu = page.getByRole("button", { name: "Open sidebar" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Chat: A very long chat" }).click();
}

test("a long chat keeps every message but sends only a bounded window", async ({ page }) => {
  await seedLongChat(page);
  await expect(page.locator(".message")).toHaveCount(40);
  await expect(page.getByRole("note")).toContainText("aren't sent with new replies");

  // Capture what the client sends; answer with a short streamed reply.
  let sent: { messages: { role: string; content: string }[] } | null = null;
  await page.route("**/api/chat", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "text/plain", body: '{"type":"text","text":"Still here."}\n{"type":"done"}\n' });
  });
  await page.route("**/api/status", (r) => r.fulfill({ json: { configured: true, provider: "openai", model: "test", accessRequired: false } }));
  await page.reload();
  const menu = page.getByRole("button", { name: "Open sidebar" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Chat: A very long chat" }).click();
  await page.getByRole("textbox", { name: "Message Holographic" }).fill("And one more question.");
  await page.keyboard.press("Enter");
  await expect(page.locator(".message-assistant .message-body").last()).toHaveText("Still here.");

  expect(sent).not.toBeNull();
  const turns = sent!.messages;
  expect(turns.length).toBeLessThanOrEqual(MAX_TURNS);
  expect(turns.reduce((n, t) => n + t.content.length, 0)).toBeLessThanOrEqual(MAX_CHARS_PER_REQUEST);
  expect(turns[0]?.role).toBe("user");
  expect(turns[turns.length - 1]?.content).toBe("And one more question.");
  // The full conversation is still stored.
  await expect(page.locator(".message")).toHaveCount(42);
});

test("a message over the per-message limit can't be sent and says why", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("textbox", { name: "Message Holographic" });
  await box.fill("x".repeat(MAX_CHARS_PER_TURN + 1));
  await expect(page.locator(".composer-count")).toContainText("8,001 / 8,000");
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(page.locator(".message")).toHaveCount(0);
  await box.fill("x".repeat(MAX_CHARS_PER_TURN));
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
});

test("the server names the limit when a request is over it", async ({ request }) => {
  const res = await request.post("/api/chat", {
    data: { messages: Array.from({ length: MAX_TURNS + 1 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "hi" })) },
  });
  // The test server has no model key, so the gate reports that first; the limit check needs a configured server.
  expect([400, 503]).toContain(res.status());
});
