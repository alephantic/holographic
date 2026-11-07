import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { STUDIO_ACCESS_KEY, STUDIO_WEB_PORT } from "../playwright.config";

// These run only when HOLOGRAPHIC_TEST_DATABASE_URL points at a real PostgreSQL
// (local Docker in development). The server has a fake model key and an access key.

const base = `http://localhost:${STUDIO_WEB_PORT}`;
const KEY = { "x-holographic-key": STUDIO_ACCESS_KEY };

async function unlock(page: Page) {
  await page.goto(base);
  await page.getByRole("textbox", { name: "Access key" }).fill(STUDIO_ACCESS_KEY);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("form", { name: "Access key" })).toHaveCount(0);
}

async function chooseMode(page: Page, mode: "Chat" | "Save") {
  await page.getByRole("button", { name: /^Mode:/ }).click();
  await page.getByRole("option", { name: new RegExp(`^${mode}`) }).click();
}

async function studioIds(request: APIRequestContext): Promise<string[]> {
  const r = await request.get(`${base}/api/entries`, { headers: KEY });
  expect(r.status()).toBe(200);
  return ((await r.json()).library.entries as { id: string }[]).map((e) => e.id);
}

test.describe.configure({ mode: "serial" });

test("storage routes refuse requests without the access key", async ({ request }) => {
  for (const [method, path] of [
    ["get", "/api/entries"],
    ["get", "/api/export"],
    ["post", "/api/import"],
    ["delete", "/api/entries/anything"],
  ] as const) {
    const r = await request[method](`${base}${path}`, method === "post" ? { data: { entries: [], dryRun: true } } : {});
    expect(r.status(), `${method} ${path}`).toBe(401);
  }
  const status = await (await request.get(`${base}/api/status`)).json();
  expect(status.storage).toEqual({ configured: true });
});

test("a saved thought and a chat are kept in the database and reopen after a reload", async ({ page, request }) => {
  await unlock(page);
  await expect(page.getByRole("status")).toContainText("Replies come from");

  await chooseMode(page, "Save");
  await expect(page.getByRole("status")).toContainText("Saved to the studio");
  await page.getByRole("textbox").fill("A thought kept in Postgres.\n\nSecond line.");
  await page.keyboard.press("Enter");
  await expect(page.locator(".saved-body")).toContainText("A thought kept in Postgres.");

  // Chat: the model is mocked (the server's fake key would fail upstream), storage is real.
  await page.route("**/api/chat", (r) => r.fulfill({ status: 200, contentType: "text/plain", body: '{"type":"text","text":"Kept, too."}\n{"type":"done"}\n' }));
  await chooseMode(page, "Chat");
  await page.getByRole("textbox").fill("Will this be kept?");
  await page.keyboard.press("Enter");
  await expect(page.locator(".message-assistant .message-body")).toHaveText("Kept, too.");
  await page.getByRole("textbox").fill("And a second question.");
  await page.keyboard.press("Enter");
  await expect(page.locator(".message")).toHaveCount(4);

  // Nothing of this went to the browser's own store.
  const local = await page.evaluate(() => localStorage.getItem("holographic.library.v1"));
  expect(JSON.parse(local ?? '{"entries":[]}').entries).toHaveLength(0);

  await page.reload();
  await expect(page.getByRole("button", { name: "Chat: Will this be kept?" })).toBeVisible();
  await page.getByRole("button", { name: "Chat: Will this be kept?" }).click();
  await expect(page.locator(".message .message-body")).toHaveText(["Will this be kept?", "Kept, too.", "And a second question.", "Kept, too."]);
  await page.getByRole("button", { name: "Saved: A thought kept in Postgres." }).click();
  await expect(page.locator(".saved-body")).toHaveText("A thought kept in Postgres.\n\nSecond line.");

  // The rows themselves, via the API with the key.
  const ids = await studioIds(request);
  expect(ids).toHaveLength(2);
});

test("export from the database is the same file the browser understands, and re-import adds nothing", async ({ page, request }) => {
  const res = await request.get(`${base}/api/export`, { headers: KEY });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toMatch(/holographic-export-\d{4}-\d{2}-\d{2}\.json/);
  const doc = await res.json();
  expect(doc.format).toBe("holographic-export");
  expect(doc.library.entries).toHaveLength(2);
  const chat = doc.library.entries.find((e: { kind: string }) => e.kind === "chat");
  expect(chat.messages).toHaveLength(4);
  expect(chat.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);

  const again = await request.post(`${base}/api/import`, { headers: KEY, data: { entries: doc.library.entries, dryRun: true } });
  expect(await again.json()).toEqual({ added: [], skipped: expect.arrayContaining(doc.library.entries.map((e: { id: string }) => e.id)) });

  // The browser's Import of that file against the studio shows "already in the studio".
  await unlock(page);
  await page.getByLabel("Import file").setInputFiles({ name: "studio.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)) });
  await expect(page.getByRole("group", { name: "Import preview" })).toContainText("All 2 entries are already in the studio.");
});

test("Send to studio previews, keeps ids and timestamps, leaves the originals, and is safe to repeat", async ({ page, request }) => {
  await page.goto(base);
  // Seed this browser with two local entries from "before the studio".
  await page.evaluate(() => {
    const at = "2026-02-03T04:05:06.000Z";
    const entries = [
      { id: "local-saved-1", kind: "saved", title: "From before", body: "From before", createdAt: at, updatedAt: at },
      {
        id: "local-chat-1",
        kind: "chat",
        title: "An old chat",
        createdAt: at,
        updatedAt: at,
        messages: [
          { id: "local-chat-1-m0", role: "user", content: "An old chat", createdAt: at },
          { id: "local-chat-1-m1", role: "assistant", content: "An old reply", createdAt: at, note: "Stopped here." },
        ],
      },
    ];
    localStorage.setItem("holographic.library.v1", JSON.stringify({ version: 1, entries }));
  });
  await page.reload();
  await page.getByRole("textbox", { name: "Access key" }).fill(STUDIO_ACCESS_KEY);
  await page.getByRole("button", { name: "Unlock" }).click();

  const send = page.getByRole("button", { name: "Send to studio (2)" });
  await expect(send).toBeVisible();
  await send.click();
  await expect(page.getByRole("group", { name: "Import preview" })).toContainText("2 entries to add.");
  await page.getByRole("button", { name: "Send 2" }).click();
  await expect(page.getByText("Sent 2 to the studio. The originals stay in this browser.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Send to studio/ })).toHaveCount(0);

  // Originals untouched in the browser.
  const local = JSON.parse((await page.evaluate(() => localStorage.getItem("holographic.library.v1")))!);
  expect(local.entries.map((e: { id: string }) => e.id)).toEqual(["local-saved-1", "local-chat-1"]);

  // In the database with ids, timestamps, messages, and the note intact.
  const r = await request.get(`${base}/api/entries/local-chat-1`, { headers: KEY });
  const { entry } = await r.json();
  expect(entry.createdAt).toBe("2026-02-03T04:05:06.000Z");
  expect(entry.messages[1]).toMatchObject({ id: "local-chat-1-m1", content: "An old reply", note: "Stopped here." });
  expect(await studioIds(request)).toEqual(expect.arrayContaining(["local-saved-1", "local-chat-1"]));

  // Repeating the migration is a no-op.
  const again = await request.post(`${base}/api/import`, { headers: KEY, data: { entries: local.entries, dryRun: false } });
  expect(await again.json()).toEqual({ added: [], skipped: ["local-saved-1", "local-chat-1"] });
  expect(await studioIds(request)).toHaveLength(4);
});

test("delete removes an entry and its messages from the database", async ({ page, request }) => {
  await unlock(page);
  await page.getByRole("button", { name: "Chat: An old chat" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete" }).last().click();
  await expect(page.getByRole("button", { name: "Chat: An old chat" })).toHaveCount(0);
  await expect.poll(async () => (await request.get(`${base}/api/entries/local-chat-1`, { headers: KEY })).status()).toBe(404);
  expect(await studioIds(request)).toHaveLength(3);
});

test("the server rejects malformed entries and oversized imports", async ({ request }) => {
  const bad = await request.post(`${base}/api/entries`, { headers: KEY, data: { id: "x", kind: "saved" } });
  expect(bad.status()).toBe(400);
  const entry = { id: "dup-check", kind: "saved", title: "t", body: "b", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
  expect((await request.post(`${base}/api/entries`, { headers: KEY, data: entry })).status()).toBe(201);
  const dup = await request.post(`${base}/api/entries`, { headers: KEY, data: entry });
  expect(dup.status()).toBe(409);
  const missing = await request.post(`${base}/api/entries/nope/messages`, {
    headers: KEY,
    data: { id: "m", role: "user", content: "hi", createdAt: "2026-01-01T00:00:00Z" },
  });
  expect(missing.status()).toBe(404);
  const tooMany = await request.post(`${base}/api/import`, {
    headers: KEY,
    data: { entries: Array.from({ length: 2_001 }, (_, i) => ({ ...entry, id: `bulk-${i}` })), dryRun: true },
  });
  expect(tooMany.status()).toBe(400);
});
